import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { dispatchRazorpayEvent } from "../dispatch";
import type { RazorpayConfig } from "../config";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

let merchantId: string;
let customerId: string;
let config: RazorpayConfig;
const createdCaseIds: string[] = [];

describe("dispatchRazorpayEvent lifecycle", () => {
  beforeAll(async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: "Test Merchant Dispatch",
        email: `dispatch-merchant-${Date.now()}@example.com`,
      },
    });
    merchantId = merchant.id;
    const customer = await prisma.customer.create({
      data: {
        merchantId,
        name: "Dispatch Customer",
        email: `dispatch-customer-${Date.now()}@example.com`,
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
    await prisma.razorpayWebhookEvent.deleteMany({
      where: { eventId: { startsWith: "evt_dispatch_" } },
    });
    await prisma.customer.deleteMany({ where: { merchantId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
    await prisma.$disconnect();
  });

  it("13. handler failure marks event FAILED with non-2xx (not falsely PROCESSED)", async () => {
    const key = `evt_dispatch_fail_${Date.now()}`;
    const result = await dispatchRazorpayEvent(prisma, config, {
      dedupeKey: key,
      eventType: "payment.failed",
      payload: {
        payment: {
          entity: { id: `pay_bad_${Date.now()}`, amount: -5, currency: "INR", status: "failed" },
        },
      },
    });

    expect(result.httpStatus).toBe(400);
    const row = await prisma.razorpayWebhookEvent.findUnique({ where: { eventId: key } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("FAILED");
    expect(row!.errorMessage).toBeTruthy();
  });

  it("12. FAILED event can be retried safely and then succeeds", async () => {
    const key = `evt_dispatch_retry_${Date.now()}`;
    const payId = `pay_retry_${Date.now()}`;

    const first = await dispatchRazorpayEvent(prisma, config, {
      dedupeKey: key,
      eventType: "payment.failed",
      payload: { payment: { entity: { id: payId, amount: -5, currency: "INR", status: "failed" } } },
    });
    expect(first.httpStatus).toBe(400);

    const second = await dispatchRazorpayEvent(prisma, config, {
      dedupeKey: key,
      eventType: "payment.failed",
      payload: { payment: { entity: { id: payId, amount: 250_000, currency: "INR", status: "failed", error_code: "card_declined" } } },
    });
    expect(second.httpStatus).toBe(200);
    const body = second.body as { caseId?: string };
    expect(body.caseId).toBeTruthy();
    createdCaseIds.push(body.caseId!);

    const row = await prisma.razorpayWebhookEvent.findUnique({ where: { eventId: key } });
    expect(row!.status).toBe("PROCESSED");
    expect(row!.errorMessage).toBeNull();
  });

  it("already PROCESSED events return already_processed without side effects", async () => {
    const key = `evt_dispatch_dup_${Date.now()}`;
    const payId = `pay_dup_${Date.now()}`;
    const payload = {
      payment: { entity: { id: payId, amount: 100_000, currency: "INR", status: "failed" } },
    };

    const first = await dispatchRazorpayEvent(prisma, config, {
      dedupeKey: key,
      eventType: "payment.failed",
      payload,
    });
    expect(first.httpStatus).toBe(200);
    createdCaseIds.push((first.body as { caseId: string }).caseId);
    const countBefore = await prisma.recoveryCase.count({ where: { merchantId } });

    const second = await dispatchRazorpayEvent(prisma, config, {
      dedupeKey: key,
      eventType: "payment.failed",
      payload,
    });
    expect(second.httpStatus).toBe(200);
    expect((second.body as { status?: string }).status).toBe("already_processed");
    const countAfter = await prisma.recoveryCase.count({ where: { merchantId } });
    expect(countAfter).toBe(countBefore);
  });

  it("payment_link.paid success marks PROCESSED and recovers the case", async () => {
    const linkId = `plink_dispatch_${Date.now()}`;
    const payId = `pay_dispatch_${Date.now()}`;
    const txn = await prisma.transaction.create({
      data: { merchantId, customerId, amount: 100_000, currency: "INR", status: "FAILED", failureReason: "card_declined" },
    });
    const kase = await prisma.recoveryCase.create({
      data: {
        merchantId,
        customerId,
        scenario: "FAILED_PAYMENT",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        amountAtRisk: 100_000,
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
    await prisma.recoveryIntervention.create({
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

    const key = `evt_dispatch_paid_${Date.now()}`;
    const result = await dispatchRazorpayEvent(prisma, config, {
      dedupeKey: key,
      eventType: "payment_link.paid",
      payload: {
        payment_link: { entity: { id: linkId } },
        payment: { entity: { id: payId, amount: 100_000, currency: "INR", status: "captured" } },
      },
    });
    expect(result.httpStatus).toBe(200);

    const row = await prisma.razorpayWebhookEvent.findUnique({ where: { eventId: key } });
    expect(row!.status).toBe("PROCESSED");
    const updated = await prisma.recoveryCase.findUnique({ where: { id: kase.id } });
    expect(updated!.status).toBe("RECOVERED");
  });

  it("unknown events are recorded and ignored", async () => {
    const key = `evt_dispatch_unknown_${Date.now()}`;
    const result = await dispatchRazorpayEvent(prisma, config, {
      dedupeKey: key,
      eventType: "payment.refunded",
      payload: {},
    });
    expect(result.httpStatus).toBe(200);
    expect((result.body as { status?: string }).status).toBe("event_ignored");
  });
});
