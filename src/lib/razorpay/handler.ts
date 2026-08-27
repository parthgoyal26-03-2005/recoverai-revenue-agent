import { PrismaClient } from "@/generated/prisma/client";

export type PaymentFailedPayload = {
  payment: {
    id: string;
    order_id?: string;
    amount: number;
    currency: string;
    status: string;
    method?: string;
    error_code?: string;
    error_description?: string;
    error_source?: string;
    error_step?: string;
    error_reason?: string;
    created_at?: number;
    customer_email?: string;
    customer_contact?: string;
  };
};

type HandleResult = {
  ok: boolean;
  status: number;
  error?: string;
  caseId?: string;
  transactionId?: string;
};

export async function handlePaymentFailed(
  prisma: PrismaClient,
  merchantId: string,
  paymentId: string,
  payload: PaymentFailedPayload["payment"],
  eventId: string
): Promise<HandleResult> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
  });
  if (!merchant) {
    return { ok: false, status: 500, error: "Merchant not found." };
  }

  const amount = typeof payload.amount === "number" ? payload.amount : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: "Invalid payment amount." };
  }

  const currency =
    typeof payload.currency === "string" && payload.currency.length > 0
      ? payload.currency
      : "INR";

  const failureReason = [
    payload.error_code,
    payload.error_description,
    payload.error_reason,
  ]
    .filter(Boolean)
    .join(": ") || "Unknown failure";

  let customerId: string;

  const customerEmail =
    typeof payload.customer_email === "string" && payload.customer_email
      ? payload.customer_email
      : null;

  if (customerEmail) {
    const existing = await prisma.customer.findFirst({
      where: { merchantId, email: customerEmail },
    });
    if (existing) {
      customerId = existing.id;
    } else {
      const created = await prisma.customer.create({
        data: {
          merchantId,
          name: customerEmail.split("@")[0],
          email: customerEmail,
          phone:
            typeof payload.customer_contact === "string"
              ? payload.customer_contact
              : null,
        },
      });
      customerId = created.id;
    }
  } else {
    const placeholderEmail = `razorpay-unknown-${merchantId}@recoverai.local`;
    const existing = await prisma.customer.findFirst({
      where: { merchantId, email: placeholderEmail },
    });
    if (existing) {
      customerId = existing.id;
    } else {
      const created = await prisma.customer.create({
        data: {
          merchantId,
          name: "Unknown Razorpay Customer",
          email: placeholderEmail,
        },
      });
      customerId = created.id;
    }
  }

  const transaction = await prisma.transaction.upsert({
    where: { razorpayPaymentId: paymentId },
    update: {
      amount,
      currency,
      status: "FAILED",
      failureReason,
    },
    create: {
      merchantId,
      customerId,
      amount,
      currency,
      status: "FAILED",
      failureReason,
      razorpayPaymentId: paymentId,
    },
  });

  const existingCase = await prisma.recoveryCase.findFirst({
    where: { transactionId: transaction.id },
  });
  if (existingCase) {
    return {
      ok: true,
      status: 200,
      caseId: existingCase.id,
      transactionId: transaction.id,
    };
  }

  const windowHours = 72;
  const now = new Date();
  const recoveryCase = await prisma.recoveryCase.create({
    data: {
      merchantId,
      customerId,
      scenario: "FAILED_PAYMENT",
      status: "DETECTED",
      priority: amount >= 2_500_000 ? "CRITICAL" : amount >= 500_000 ? "HIGH" : amount >= 100_000 ? "MEDIUM" : "LOW",
      amountAtRisk: amount,
      retryCount: 0,
      contactCount: 0,
      windowExpiresAt: new Date(now.getTime() + windowHours * 3_600_000),
      transactionId: transaction.id,
    },
  });

  await prisma.transaction.update({
    where: { id: transaction.id },
    data: { recoveryCaseId: recoveryCase.id },
  });

  await prisma.auditLog.create({
    data: {
      recoveryCaseId: recoveryCase.id,
      event: "PAYMENT_FAILURE_DETECTED",
      actor: "SYSTEM",
      metadata: {
        source: "razorpay",
        eventType: "payment.failed",
        razorpayPaymentId: paymentId,
        razorpayEventId: eventId,
        amount,
        currency,
        failureReason,
      },
    },
  });

  return {
    ok: true,
    status: 200,
    caseId: recoveryCase.id,
    transactionId: transaction.id,
  };
}
