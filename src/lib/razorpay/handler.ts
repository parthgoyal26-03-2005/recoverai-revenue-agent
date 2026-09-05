import { PrismaClient } from "@/generated/prisma/client";

export type PaymentLinkPaidPayload = {
  payment_link: {
    id: string;
    amount?: number;
    currency?: string;
    reference_id?: string;
    notes?: Record<string, unknown>;
  };
  payment: {
    id: string;
    amount?: number;
    currency?: string;
    order_id?: string;
    status?: string;
    email?: string;
    created_at?: number;
  };
};

export type PaymentLinkPaidResult = {
  ok: boolean;
  status: number;
  error?: string;
  caseId?: string;
};

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

export type ConfirmRecoveryPaymentInput = {
  paymentLinkId: string;
  paymentId: string;
  amount?: number;
  currency?: string;
  /** Razorpay payment status — must be "captured" to confirm. */
  paymentStatus?: string;
  eventId: string;
  eventType: string;
  /** Payment-link notes, when available (ownership cross-check). */
  linkNotes?: Record<string, unknown>;
};

export type ConfirmRecoveryPaymentResult = {
  ok: boolean;
  status: number;
  error?: string;
  caseId?: string;
  recoveredAmountPaise?: number;
  alreadyRecovered?: boolean;
};

/**
 * Shared idempotent recovery-payment confirmation.
 *
 * Used by BOTH the `payment_link.paid` webhook and the explicit
 * payment-status sync endpoint — there is exactly one implementation of
 * recovery-completion logic. Only server-verified Razorpay information may
 * mark a case recovered; browser claims never reach this function.
 *
 * Safe to call repeatedly: already-recovered cases return success without
 * touching amounts, transactions, or audit logs.
 */
export async function confirmRecoveryPayment(
  prisma: PrismaClient,
  merchantId: string,
  input: ConfirmRecoveryPaymentInput
): Promise<ConfirmRecoveryPaymentResult> {
  const { paymentLinkId, paymentId, eventId, eventType } = input;

  // 1. Find the intervention that owns this payment link.
  const intervention = await prisma.recoveryIntervention.findFirst({
    where: {
      provider: "razorpay",
      providerReference: paymentLinkId,
    },
    include: { recoveryCase: true },
  });
  if (!intervention) {
    return {
      ok: false,
      status: 404,
      error: "No recovery intervention found for this payment link.",
    };
  }

  // 2-3. Verify merchant ownership and the recovery case.
  const recoveryCase = intervention.recoveryCase;
  if (recoveryCase.merchantId !== merchantId) {
    return {
      ok: false,
      status: 404,
      error: "Payment link does not belong to this merchant.",
    };
  }

  // Idempotency: already recovered → success without side effects.
  if (intervention.result === "SUCCESS" || recoveryCase.status === "RECOVERED") {
    return {
      ok: true,
      status: 200,
      caseId: recoveryCase.id,
      recoveredAmountPaise: intervention.recoveredAmount,
      alreadyRecovered: true,
    };
  }

  // 4-6. Validate amount, currency, capture state, and link ownership.
  const amount = typeof input.amount === "number" ? input.amount : NaN;
  const currency =
    typeof input.currency === "string" && input.currency.length > 0
      ? input.currency
      : "INR";

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: "Invalid payment amount." };
  }

  if (input.paymentStatus !== "captured") {
    return {
      ok: false,
      status: 400,
      error: "Payment is not captured; recovery cannot be confirmed.",
    };
  }

  const notesCaseId = input.linkNotes?.recoverai_case_id;
  if (
    typeof notesCaseId === "string" &&
    notesCaseId.length > 0 &&
    notesCaseId !== recoveryCase.id
  ) {
    await prisma.auditLog.create({
      data: {
        recoveryCaseId: recoveryCase.id,
        event: "RECOVERY_PAYMENT_AMOUNT_MISMATCH",
        actor: "SYSTEM",
        metadata: {
          source: "razorpay",
          eventType,
          razorpayEventId: eventId,
          paymentLinkId,
          expectedAmount: recoveryCase.amountAtRisk,
          actualAmount: amount,
          currency,
          reason: "payment link ownership mismatch",
        },
      },
    });
    return {
      ok: false,
      status: 400,
      error: "Payment link does not belong to this recovery case.",
    };
  }

  if (amount !== recoveryCase.amountAtRisk || currency !== "INR") {
    await prisma.auditLog.create({
      data: {
        recoveryCaseId: recoveryCase.id,
        event: "RECOVERY_PAYMENT_AMOUNT_MISMATCH",
        actor: "SYSTEM",
        metadata: {
          source: "razorpay",
          eventType,
          razorpayEventId: eventId,
          paymentLinkId,
          expectedAmount: recoveryCase.amountAtRisk,
          actualAmount: amount,
          currency,
        },
      },
    });
    return {
      ok: false,
      status: 400,
      error: "Payment amount does not match the recovery amount.",
    };
  }

  // 7-8. Preserve the original FAILED transaction; record the successful
  // recovery payment as a separate CAPTURED transaction (deduped by id).
  const existingTx = await prisma.transaction.findUnique({
    where: { razorpayPaymentId: paymentId },
  });
  if (!existingTx) {
    await prisma.transaction.create({
      data: {
        merchantId,
        customerId: recoveryCase.customerId,
        amount,
        currency,
        status: "CAPTURED",
        razorpayPaymentId: paymentId,
      },
    });
  }

  // 9-12. Mark intervention SUCCESS (exactly once) and case RECOVERED.
  const now = new Date();
  await prisma.recoveryIntervention.update({
    where: { id: intervention.id },
    data: {
      status: "COMPLETED",
      result: "SUCCESS",
      recoveredAmount: amount,
      executedAt: now,
      notes: `Customer paid via Razorpay payment link ${paymentLinkId}.`,
    },
  });

  await prisma.recoveryCase.update({
    where: { id: recoveryCase.id },
    data: { status: "RECOVERED", resolvedAt: now },
  });

  // 13-14. Success audits, created exactly once per (link, payment).
  // Guard covers partial-failure retries where state was committed but the
  // process died before/without audit rows.
  const priorConfirmations = await prisma.auditLog.findMany({
    where: { recoveryCaseId: recoveryCase.id, event: "RECOVERY_PAYMENT_CONFIRMED" },
    select: { metadata: true },
  });
  const alreadyAudited = priorConfirmations.some((a) => {
    const meta = a.metadata as Record<string, unknown> | null;
    return (
      meta?.paymentLinkId === paymentLinkId && meta?.paymentId === paymentId
    );
  });
  if (!alreadyAudited) {
    await prisma.auditLog.create({
      data: {
        recoveryCaseId: recoveryCase.id,
        event: "RECOVERY_PAYMENT_CONFIRMED",
        actor: "SYSTEM",
        metadata: {
          source: "razorpay",
          eventType,
          razorpayEventId: eventId,
          paymentLinkId,
          paymentId,
          amount,
          currency,
        },
      },
    });
    await prisma.auditLog.create({
      data: {
        recoveryCaseId: recoveryCase.id,
        event: "RECOVERY_SUCCESS",
        actor: "SYSTEM",
        metadata: {
          source: "razorpay",
          paymentLinkId,
          paymentId,
          action: "RETRY_PAYMENT",
          recoveredAmount: amount,
          amountAtRisk: recoveryCase.amountAtRisk,
        },
      },
    });
  }

  return {
    ok: true,
    status: 200,
    caseId: recoveryCase.id,
    recoveredAmountPaise: amount,
  };
}

export async function handlePaymentLinkPaid(
  prisma: PrismaClient,
  merchantId: string,
  paymentLinkId: string,
  payment: PaymentLinkPaidPayload["payment"],
  eventId: string
): Promise<PaymentLinkPaidResult> {
  const result = await confirmRecoveryPayment(prisma, merchantId, {
    paymentLinkId,
    paymentId: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    paymentStatus: payment.status,
    eventId,
    eventType: "payment_link.paid",
  });
  return {
    ok: result.ok,
    status: result.status,
    error: result.error,
    caseId: result.caseId,
  };
}
