import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createHmac } from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { verifyWebhookSignature, generateWebhookSignature } from "../webhook";
import { handlePaymentFailed } from "../handler";
import { getRazorpayConfig, maskKeyId } from "../config";
import { testRazorpayConnection } from "../client";

const TEST_WEBHOOK_SECRET = "whsec_test1234567890abcdef";

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function makePaymentFailedPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: "pay_testRZ12345",
          order_id: "order_testRZ67890",
          amount: 804800,
          currency: "INR",
          status: "failed",
          method: "card",
          error_code: "card_declined",
          error_description: "Your card was declined.",
          error_source: "gateway",
          error_step: "payment_authorization",
          error_reason: "insufficient_funds",
          created_at: 1724000000,
          ...overrides,
        },
      },
    },
  };
}

describe("Razorpay webhook signature", () => {
  it("valid signature passes", () => {
    const body = '{"event":"payment.failed"}';
    const sig = signBody(body, TEST_WEBHOOK_SECRET);
    expect(verifyWebhookSignature(body, sig, TEST_WEBHOOK_SECRET)).toBe(true);
  });

  it("invalid signature rejected", () => {
    const body = '{"event":"payment.failed"}';
    expect(verifyWebhookSignature(body, "deadbeef00000000", TEST_WEBHOOK_SECRET)).toBe(false);
  });

  it("null signature rejected", () => {
    expect(verifyWebhookSignature("body", null, TEST_WEBHOOK_SECRET)).toBe(false);
  });

  it("wrong secret rejected", () => {
    const body = '{"event":"payment.failed"}';
    const sig = signBody(body, TEST_WEBHOOK_SECRET);
    expect(verifyWebhookSignature(body, sig, "wrong_secret")).toBe(false);
  });

  it("generateWebhookSignature produces valid HMAC", () => {
    const body = '{"test":true}';
    const sig = generateWebhookSignature(body, TEST_WEBHOOK_SECRET);
    expect(sig).toBe(signBody(body, TEST_WEBHOOK_SECRET));
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Razorpay config", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns null when credentials missing", () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_MERCHANT_ID;
    expect(getRazorpayConfig()).toBeNull();
  });

  it("returns config when all set", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
    process.env.RAZORPAY_KEY_SECRET = "secret_xyz";
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";
    process.env.RAZORPAY_MERCHANT_ID = "merchant_1";
    const config = getRazorpayConfig();
    expect(config).not.toBeNull();
    expect(config!.keyId).toBe("rzp_test_abc123");
    expect(config!.apiBaseUrl).toBe("https://api.razorpay.com/v1");
  });

  it("uses custom API base URL", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
    process.env.RAZORPAY_KEY_SECRET = "secret_xyz";
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";
    process.env.RAZORPAY_MERCHANT_ID = "merchant_1";
    process.env.RAZORPAY_API_BASE_URL = "https://custom.api.test/v1";
    const config = getRazorpayConfig();
    expect(config!.apiBaseUrl).toBe("https://custom.api.test/v1");
  });

  it("maskKeyId hides middle characters", () => {
    expect(maskKeyId("rzp_test_abcdefghij")).toBe("rzp_tes****ghij");
    expect(maskKeyId("rzp_test_short")).toBe("rzp_tes****hort");
  });

  it("secrets never appear in API response shape", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_topsecret";
    process.env.RAZORPAY_KEY_SECRET = "secret_never_expose";
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_never_expose";
    process.env.RAZORPAY_MERCHANT_ID = "merchant_1";
    const config = getRazorpayConfig();
    const responseShape = {
      connected: true,
      mode: "test",
      keyId: maskKeyId(config!.keyId),
    };
    const serialized = JSON.stringify(responseShape);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("topsecret");
    expect(serialized).not.toContain("whsec");
  });
});

describe("Razorpay test connection", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns not configured when env vars missing", async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_MERCHANT_ID;
    const result = await testRazorpayConnection();
    expect(result.connected).toBe(false);
    expect(result.reason).toMatch(/not configured/i);
  });
});

describe("handlePaymentFailed (integration)", () => {
  const connectionString = process.env.DATABASE_URL!;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  let merchantId: string;

  beforeAll(async () => {
    const merchant = await prisma.merchant.create({
      data: { name: "Test Merchant Webhook", email: `test-merchant-${Date.now()}@example.com` },
    });
    merchantId = merchant.id;

    await prisma.customer.create({
      data: {
        merchantId,
        name: "Webhook Test Customer",
        email: `webhook-customer-${Date.now()}@example.com`,
        phone: "+919800000000",
      },
    });
  });

  afterAll(async () => {
    const caseIds = (
      await prisma.recoveryCase.findMany({ where: { merchantId }, select: { id: true } })
    ).map((c) => c.id);
    if (caseIds.length) {
      await prisma.auditLog.deleteMany({ where: { recoveryCaseId: { in: caseIds } } });
    }
    await prisma.recoveryCase.deleteMany({ where: { merchantId } });
    await prisma.transaction.deleteMany({ where: { merchantId } });
    await prisma.customer.deleteMany({ where: { merchantId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
    await prisma.$disconnect();
  });

  it("creates Transaction + RecoveryCase + AuditLog on payment.failed", async () => {
    const paymentId = `pay_integ_${Date.now()}_1`;
    const eventId = `evt_integ_${Date.now()}_1`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: 500000, currency: "INR" });

    const result = await handlePaymentFailed(
      prisma,
      merchantId,
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      eventId
    );

    expect(result.ok).toBe(true);
    expect(result.caseId).toBeDefined();
    expect(result.transactionId).toBeDefined();

    const txn = await prisma.transaction.findUnique({ where: { id: result.transactionId! } });
    expect(txn).not.toBeNull();
    expect(txn!.razorpayPaymentId).toBe(paymentId);
    expect(txn!.amount).toBe(500000);
    expect(txn!.currency).toBe("INR");
    expect(txn!.status).toBe("FAILED");

    const recoveryCase = await prisma.recoveryCase.findUnique({ where: { id: result.caseId! } });
    expect(recoveryCase).not.toBeNull();
    expect(recoveryCase!.scenario).toBe("FAILED_PAYMENT");
    expect(recoveryCase!.status).toBe("DETECTED");
    expect(recoveryCase!.amountAtRisk).toBe(500000);
    expect(recoveryCase!.transactionId).toBe(result.transactionId);

    const audit = await prisma.auditLog.findFirst({
      where: { recoveryCaseId: result.caseId!, event: "PAYMENT_FAILURE_DETECTED" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actor).toBe("SYSTEM");
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta.source).toBe("razorpay");
    expect(meta.razorpayPaymentId).toBe(paymentId);
    expect(meta.amount).toBe(500000);
    expect(meta.currency).toBe("INR");
  });

  it("correct Razorpay amount mapping (paise preserved)", async () => {
    const paymentId = `pay_integ_${Date.now()}_2`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: 804800 });

    const result = await handlePaymentFailed(
      prisma,
      merchantId,
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_2`
    );

    expect(result.ok).toBe(true);
    const txn = await prisma.transaction.findUnique({ where: { id: result.transactionId! } });
    expect(txn!.amount).toBe(804800);
    const rc = await prisma.recoveryCase.findUnique({ where: { id: result.caseId! } });
    expect(rc!.amountAtRisk).toBe(804800);
  });

  it("correct currency mapping", async () => {
    const paymentId = `pay_integ_${Date.now()}_3`;
    const payload = makePaymentFailedPayload({ id: paymentId, currency: "INR", amount: 10000 });

    const result = await handlePaymentFailed(
      prisma,
      merchantId,
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_3`
    );

    const txn = await prisma.transaction.findUnique({ where: { id: result.transactionId! } });
    expect(txn!.currency).toBe("INR");
  });

  it("correct failure reason mapping", async () => {
    const paymentId = `pay_integ_${Date.now()}_4`;
    const payload = makePaymentFailedPayload({
      id: paymentId,
      error_code: "card_declined",
      error_description: "Your card was declined.",
      error_reason: "insufficient_funds",
      amount: 10000,
    });

    const result = await handlePaymentFailed(
      prisma,
      merchantId,
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_4`
    );

    const txn = await prisma.transaction.findUnique({ where: { id: result.transactionId! } });
    expect(txn!.failureReason).toContain("card_declined");
    expect(txn!.failureReason).toContain("Your card was declined.");
    expect(txn!.failureReason).toContain("insufficient_funds");
  });

  it("duplicate payment ID does not create duplicate Transaction", async () => {
    const paymentId = `pay_integ_${Date.now()}_5`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: 25000 });

    const r1 = await handlePaymentFailed(
      prisma, merchantId, paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_5a`
    );
    expect(r1.ok).toBe(true);

    const r2 = await handlePaymentFailed(
      prisma, merchantId, paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_5b`
    );
    expect(r2.ok).toBe(true);
    expect(r2.transactionId).toBe(r1.transactionId);

    const txns = await prisma.transaction.findMany({
      where: { razorpayPaymentId: paymentId },
    });
    expect(txns).toHaveLength(1);
  });

  it("duplicate event does not create duplicate RecoveryCase", async () => {
    const paymentId = `pay_integ_${Date.now()}_6`;
    const eventId = `evt_integ_${Date.now()}_6`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: 30000 });

    const r1 = await handlePaymentFailed(
      prisma, merchantId, paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      eventId
    );
    expect(r1.ok).toBe(true);
    expect(r1.caseId).toBeDefined();

    const r2 = await handlePaymentFailed(
      prisma, merchantId, paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      eventId
    );
    expect(r2.ok).toBe(true);
    expect(r2.caseId).toBe(r1.caseId);
  });

  it("merchant mapping failure handled safely", async () => {
    const paymentId = `pay_integ_${Date.now()}_7`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: 10000 });

    const result = await handlePaymentFailed(
      prisma,
      "nonexistent_merchant_id",
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_7`
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("invalid payload rejected (bad amount)", async () => {
    const paymentId = `pay_integ_${Date.now()}_8`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: -100 });

    const result = await handlePaymentFailed(
      prisma,
      merchantId,
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_8`
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("no recovery action is automatically executed", async () => {
    const paymentId = `pay_integ_${Date.now()}_9`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: 40000 });

    const result = await handlePaymentFailed(
      prisma,
      merchantId,
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_9`
    );

    expect(result.ok).toBe(true);
    const rc = await prisma.recoveryCase.findUnique({ where: { id: result.caseId! } });
    expect(rc!.retryCount).toBe(0);
    expect(rc!.contactCount).toBe(0);

    const interventions = await prisma.recoveryIntervention.findMany({
      where: { recoveryCaseId: result.caseId! },
    });
    expect(interventions).toHaveLength(0);
  });

  it("no merchant approval is automatically granted", async () => {
    const paymentId = `pay_integ_${Date.now()}_10`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: 6000000 });

    const result = await handlePaymentFailed(
      prisma,
      merchantId,
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      `evt_integ_${Date.now()}_10`
    );

    expect(result.ok).toBe(true);
    const rc = await prisma.recoveryCase.findUnique({ where: { id: result.caseId! } });
    expect(rc!.merchantApproved).toBe(false);
    expect(rc!.merchantApprovedAt).toBeNull();
  });

  it("audit event created with correct structure", async () => {
    const paymentId = `pay_integ_${Date.now()}_11`;
    const eventId = `evt_integ_${Date.now()}_11`;
    const payload = makePaymentFailedPayload({ id: paymentId, amount: 75000 });

    const result = await handlePaymentFailed(
      prisma,
      merchantId,
      paymentId,
      payload.payload.payment.entity as Parameters<typeof handlePaymentFailed>[3],
      eventId
    );

    expect(result.ok).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { recoveryCaseId: result.caseId!, event: "PAYMENT_FAILURE_DETECTED" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actor).toBe("SYSTEM");
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta.source).toBe("razorpay");
    expect(meta.eventType).toBe("payment.failed");
    expect(meta.razorpayEventId).toBe(eventId);
  });
});
