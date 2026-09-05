import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { syncPaymentLinkStatus } from "../sync";
import type { RazorpayConfig } from "../config";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

let merchantId: string;
let customerId: string;
let config: RazorpayConfig;
const createdCaseIds: string[] = [];

function mockLinkFetch(link: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => link,
    }))
  );
}

function linkPayload(linkId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: linkId,
    status: "created",
    amount: 100_000,
    amount_paid: 0,
    currency: "INR",
    reference_id: "RECOVERAI-x",
    short_url: "https://rzp.io/l/x",
    notes: {},
    payments: [],
    ...overrides,
  };
}

async function setupPendingCase(amountAtRisk = 100_000) {
  const txn = await prisma.transaction.create({
    data: {
      merchantId,
      customerId,
      amount: amountAtRisk,
      currency: "INR",
      status: "FAILED",
      failureReason: "card_declined",
    },
  });
  const kase = await prisma.recoveryCase.create({
    data: {
      merchantId,
      customerId,
      scenario: "FAILED_PAYMENT",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      amountAtRisk,
      retryCount: 1,
      merchantApproved: true,
      windowExpiresAt: new Date(Date.now() + 72 * 3_600_000),
      transactionId: txn.id,
    },
  });
  createdCaseIds.push(kase.id);
  await prisma.transaction.update({
    where: { id: txn.id },
    data: { recoveryCaseId: kase.id },
  });
  const linkId = `plink_sync_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const iv = await prisma.recoveryIntervention.create({
    data: {
      recoveryCaseId: kase.id,
      action: "RETRY_PAYMENT",
      status: "AWAITING_PAYMENT",
      result: "PENDING",
      recoveredAmount: 0,
      provider: "razorpay",
      providerReference: linkId,
    },
  });
  return { kase, iv, linkId };
}

describe("syncPaymentLinkStatus", () => {
  beforeAll(async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: "Test Merchant Sync",
        email: `sync-merchant-${Date.now()}@example.com`,
      },
    });
    merchantId = merchant.id;
    const customer = await prisma.customer.create({
      data: {
        merchantId,
        name: "Sync Customer",
        email: `sync-customer-${Date.now()}@example.com`,
      },
    });
    customerId = customer.id;
    config = {
      keyId: "rzp_test_x",
      keySecret: "secret_x",
      webhookSecret: "whsec_x",
      merchantId,
      apiBaseUrl: "https://api.razorpay.com/v1",
    };
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (createdCaseIds.length) {
      await prisma.auditLog.deleteMany({
        where: { recoveryCaseId: { in: createdCaseIds } },
      });
      await prisma.recoveryIntervention.deleteMany({
        where: { recoveryCaseId: { in: createdCaseIds } },
      });
      await prisma.transaction.deleteMany({ where: { merchantId } });
      await prisma.recoveryCase.deleteMany({ where: { merchantId } });
    }
    await prisma.customer.deleteMany({ where: { merchantId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
    await prisma.$disconnect();
  });

  it("14. status=created with nothing paid returns pending and changes nothing", async () => {
    const { kase, iv, linkId } = await setupPendingCase();
    mockLinkFetch(linkPayload(linkId, { status: "created", amount_paid: 0 }));

    const result = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(result.outcome).toBe("pending");

    const stillPending = await prisma.recoveryIntervention.findUnique({ where: { id: iv.id } });
    expect(stillPending!.status).toBe("AWAITING_PAYMENT");
    const kaseAfter = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(kaseAfter!.status).toBe("IN_PROGRESS");
  });

  it("15. paid link with captured payment recovers the case", async () => {
    const { kase, linkId } = await setupPendingCase();
    const payId = `pay_sync_ok_${Date.now()}`;
    mockLinkFetch(
      linkPayload(linkId, {
        status: "paid",
        amount_paid: 100_000,
        payments: [{ id: payId, amount: 100_000, currency: "INR", status: "captured" }],
      })
    );

    const result = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(result.outcome).toBe("recovered");

    const kaseAfter = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(kaseAfter!.status).toBe("RECOVERED");
    const ivs = await prisma.recoveryIntervention.findMany({ where: { recoveryCaseId: kase.id } });
    expect(ivs[0].result).toBe("SUCCESS");
    expect(ivs[0].recoveredAmount).toBe(100_000);
  });

  it("16/17. amount mismatch is rejected and never recovers", async () => {
    const { kase, linkId } = await setupPendingCase();
    mockLinkFetch(
      linkPayload(linkId, {
        status: "paid",
        amount_paid: 50_000,
        payments: [{ id: `pay_sync_mm_${Date.now()}`, amount: 50_000, currency: "INR", status: "captured" }],
      })
    );

    const result = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(result.outcome).toBe("mismatch");

    const kaseAfter = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(kaseAfter!.status).not.toBe("RECOVERED");
  });

  it("currency mismatch via non-INR captured payment is rejected", async () => {
    const { kase, linkId } = await setupPendingCase();
    mockLinkFetch(
      linkPayload(linkId, {
        status: "paid",
        amount_paid: 100_000,
        payments: [{ id: `pay_sync_cur_${Date.now()}`, amount: 100_000, currency: "USD", status: "captured" }],
      })
    );

    const result = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(result.outcome).toBe("mismatch");
    const kaseAfter = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(kaseAfter!.status).not.toBe("RECOVERED");
  });

  it("18. repeated sync after recovery is idempotent", async () => {
    const { kase, linkId } = await setupPendingCase();
    const payId = `pay_sync_idem_${Date.now()}`;
    mockLinkFetch(
      linkPayload(linkId, {
        status: "paid",
        amount_paid: 100_000,
        payments: [{ id: payId, amount: 100_000, currency: "INR", status: "captured" }],
      })
    );

    const first = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(first.outcome).toBe("recovered");
    const second = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(second.outcome).toBe("already_recovered");

    const txns = await prisma.transaction.findMany({ where: { razorpayPaymentId: payId } });
    expect(txns).toHaveLength(1);
  });

  it("21. expired link closes the intervention but never recovers", async () => {
    const { kase, iv, linkId } = await setupPendingCase();
    mockLinkFetch(linkPayload(linkId, { status: "expired" }));

    const result = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(result.outcome).toBe("expired");

    const ivAfter = await prisma.recoveryIntervention.findUnique({ where: { id: iv.id } });
    expect(ivAfter!.status).not.toBe("AWAITING_PAYMENT");
    const kaseAfter = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(kaseAfter!.status).not.toBe("RECOVERED");

    const audit = await prisma.auditLog.findFirst({
      where: { recoveryCaseId: kase.id, event: "RECOVERY_PAYMENT_EXPIRED" },
    });
    expect(audit).not.toBeNull();
  });

  it("cancelled link closes the intervention but never recovers", async () => {
    const { kase, linkId } = await setupPendingCase();
    mockLinkFetch(linkPayload(linkId, { status: "cancelled" }));

    const result = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(result.outcome).toBe("cancelled");
    const kaseAfter = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(kaseAfter!.status).not.toBe("RECOVERED");
  });

  it("real Razorpay paid shape (payment_id, no nested currency) recovers exactly once", async () => {
    const { kase, linkId } = await setupPendingCase();
    const originalTxn = await prisma.transaction.findFirst({
      where: { recoveryCaseId: kase.id },
    });
    expect(originalTxn!.status).toBe("FAILED");

    mockLinkFetch({
      id: linkId,
      amount: 100_000,
      amount_paid: 100_000,
      currency: "INR",
      status: "paid",
      reference_id: "RECOVERAI-x",
      short_url: "https://rzp.io/l/x",
      notes: {},
      payments: [
        {
          amount: 100_000,
          payment_id: "pay_realshape",
          status: "captured",
        },
      ],
    });

    const result = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(result.outcome).toBe("recovered");

    const kaseAfter = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(kaseAfter!.status).toBe("RECOVERED");
    expect(kaseAfter!.resolvedAt).not.toBeNull();

    const ivs = await prisma.recoveryIntervention.findMany({ where: { recoveryCaseId: kase.id } });
    expect(ivs).toHaveLength(1);
    expect(ivs[0].status).toBe("COMPLETED");
    expect(ivs[0].result).toBe("SUCCESS");
    expect(ivs[0].recoveredAmount).toBe(100_000);

    const stillFailed = await prisma.transaction.findUnique({ where: { id: originalTxn!.id } });
    expect(stillFailed!.status).toBe("FAILED");

    const captured = await prisma.transaction.findMany({
      where: { razorpayPaymentId: "pay_realshape" },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe("CAPTURED");

    const success = await prisma.auditLog.findMany({
      where: { recoveryCaseId: kase.id, event: "RECOVERY_SUCCESS" },
    });
    expect(success).toHaveLength(1);

    // Idempotent repeat: no doubles, no new link, no retry consumed.
    const retryCountAfter = (await prisma.recoveryCase.findUnique({ where: { id: kase.id } }))!.retryCount;
    const again = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(again.outcome).toBe("already_recovered");
    const capturedAgain = await prisma.transaction.findMany({
      where: { razorpayPaymentId: "pay_realshape" },
    });
    expect(capturedAgain).toHaveLength(1);
    const successAgain = await prisma.auditLog.findMany({
      where: { recoveryCaseId: kase.id, event: "RECOVERY_SUCCESS" },
    });
    expect(successAgain).toHaveLength(1);
    const kaseAgain = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(kaseAgain!.retryCount).toBe(retryCountAfter);
  });

  it("no pending intervention returns no_pending_payment", async () => {
    const { kase } = await setupPendingCase();
    await prisma.recoveryIntervention.deleteMany({ where: { recoveryCaseId: kase.id } });

    const result = await syncPaymentLinkStatus(prisma, config, kase.id);
    expect(result.outcome).toBe("no_pending_payment");
  });
});
