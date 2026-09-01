import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { handlePaymentLinkPaid } from "../handler";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

let merchantId: string;
let customerId: string;
const createdCaseIds: string[] = [];

async function setupRecoveryCase(amountAtRisk = 100_000) {
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
      contactCount: 0,
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

  const iv = await prisma.recoveryIntervention.create({
    data: {
      recoveryCaseId: kase.id,
      action: "RETRY_PAYMENT",
      status: "AWAITING_PAYMENT",
      result: "PENDING",
      recoveredAmount: 0,
      provider: "razorpay",
      providerReference: `plink_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
    },
  });

  return { kase, iv };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePayment(paymentId: string, amount: number, currency = "INR"): any {
  return { id: paymentId, amount, currency, status: "captured" };
}

describe("handlePaymentLinkPaid (Phase 2 integration)", () => {
  beforeAll(async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: "Test Merchant PaymentLink",
        email: `paylink-merchant-${Date.now()}@example.com`,
      },
    });
    merchantId = merchant.id;
    const customer = await prisma.customer.create({
      data: {
        merchantId,
        name: "PaymentLink Customer",
        email: `paylink-customer-${Date.now()}@example.com`,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
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

  it("verified payment marks intervention SUCCESS, case RECOVERED, adds CAPTURED txn + audits", async () => {
    const { kase, iv } = await setupRecoveryCase(100_000);
    const payment = makePayment(`pay_rp_test1_${Date.now()}`, 100_000);

    const result = await handlePaymentLinkPaid(
      prisma,
      merchantId,
      iv.providerReference,
      payment,
      `evt_rp_test1_${Date.now()}`
    );

    expect(result.ok).toBe(true);
    expect(result.caseId).toBe(kase.id);

    const updated = await prisma.recoveryIntervention.findUnique({
      where: { id: iv.id },
    });
    expect(updated!.result).toBe("SUCCESS");
    expect(updated!.status).toBe("COMPLETED");
    expect(updated!.recoveredAmount).toBe(100_000);

    const recoveredCase = await prisma.recoveryCase.findUnique({
      where: { id: kase.id },
    });
    expect(recoveredCase!.status).toBe("RECOVERED");
    expect(recoveredCase!.resolvedAt).not.toBeNull();

    const captured = await prisma.transaction.findMany({
      where: { razorpayPaymentId: payment.id },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe("CAPTURED");
    expect(captured[0].amount).toBe(100_000);

    const confirmed = await prisma.auditLog.findFirst({
      where: { recoveryCaseId: kase.id, event: "RECOVERY_PAYMENT_CONFIRMED" },
    });
    const success = await prisma.auditLog.findFirst({
      where: { recoveryCaseId: kase.id, event: "RECOVERY_SUCCESS" },
    });
    expect(confirmed).not.toBeNull();
    expect(success).not.toBeNull();
  });

  it("amount mismatch does NOT recover and records RECOVERY_PAYMENT_AMOUNT_MISMATCH", async () => {
    const { kase, iv } = await setupRecoveryCase(100_000);
    const payment = makePayment(`pay_mismatch_${Date.now()}`, 99_999);

    const result = await handlePaymentLinkPaid(
      prisma,
      merchantId,
      iv.providerReference,
      payment,
      `evt_mismatch_${Date.now()}`
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);

    const recoveredCase = await prisma.recoveryCase.findUnique({
      where: { id: kase.id },
    });
    expect(recoveredCase!.status).not.toBe("RECOVERED");

    const mismatch = await prisma.auditLog.findFirst({
      where: { recoveryCaseId: kase.id, event: "RECOVERY_PAYMENT_AMOUNT_MISMATCH" },
    });
    expect(mismatch).not.toBeNull();
    const meta = mismatch!.metadata as Record<string, unknown>;
    expect(meta.expectedAmount).toBe(100_000);
    expect(meta.actualAmount).toBe(99_999);

    const successAudit = await prisma.auditLog.findFirst({
      where: { recoveryCaseId: kase.id, event: "RECOVERY_SUCCESS" },
    });
    expect(successAudit).toBeNull();
  });

  it("currency mismatch does NOT recover", async () => {
    const { kase, iv } = await setupRecoveryCase(100_000);
    const payment = makePayment(`pay_cur_${Date.now()}`, 100_000, "USD");

    const result = await handlePaymentLinkPaid(
      prisma,
      merchantId,
      iv.providerReference,
      payment,
      `evt_cur_${Date.now()}`
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);

    const recoveredCase = await prisma.recoveryCase.findUnique({
      where: { id: kase.id },
    });
    expect(recoveredCase!.status).not.toBe("RECOVERED");
  });

  it("is idempotent: second confirmed event does not double-credit recovery", async () => {
    const { kase, iv } = await setupRecoveryCase(100_000);
    const p1 = makePayment(`pay_idem_a_${Date.now()}`, 100_000);
    const p2 = makePayment(`pay_idem_b_${Date.now()}`, 100_000);

    const r1 = await handlePaymentLinkPaid(
      prisma, merchantId, iv.providerReference, p1, `evt_idem_a_${Date.now()}`
    );
    expect(r1.ok).toBe(true);

    const r2 = await handlePaymentLinkPaid(
      prisma, merchantId, iv.providerReference, p2, `evt_idem_b_${Date.now()}`
    );
    expect(r2.ok).toBe(true);
    expect(r2.caseId).toBe(kase.id);

    const captured = await prisma.transaction.findMany({
      where: { razorpayPaymentId: p1.id },
    });
    expect(captured).toHaveLength(1);

    const capturedSecond = await prisma.transaction.findMany({
      where: { razorpayPaymentId: p2.id },
    });
    expect(capturedSecond).toHaveLength(0);

    const updated = await prisma.recoveryIntervention.findUnique({
      where: { id: iv.id },
    });
    expect(updated!.recoveredAmount).toBe(100_000);

    const successAudits = await prisma.auditLog.findMany({
      where: { recoveryCaseId: kase.id, event: "RECOVERY_SUCCESS" },
    });
    expect(successAudits).toHaveLength(1);
  });

  it("unknown payment link returns 404 and does not create recovery", async () => {
    const result = await handlePaymentLinkPaid(
      prisma,
      merchantId,
      "plink_does_not_exist",
      makePayment(`pay_404_${Date.now()}`, 100_000),
      `evt_404_${Date.now()}`
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});
