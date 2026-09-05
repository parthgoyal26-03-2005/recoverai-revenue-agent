import { PrismaClient } from "@/generated/prisma/client";
import type { RazorpayConfig } from "./config";
import {
  handlePaymentFailed,
  handlePaymentLinkPaid,
  type PaymentFailedPayload,
  type PaymentLinkPaidPayload,
} from "./handler";

export type DispatchInput = {
  dedupeKey: string;
  eventType: string | null;
  payload: Record<string, unknown> | null;
};

export type DispatchResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

async function markEvent(
  prisma: PrismaClient,
  eventId: string,
  data: { status: "PROCESSED" | "FAILED"; errorMessage?: string | null }
): Promise<void> {
  await prisma.razorpayWebhookEvent.update({
    where: { eventId },
    data: { status: data.status, errorMessage: data.errorMessage ?? null },
  });
}

/**
 * Webhook event lifecycle with correct success semantics.
 *
 * - Existing PROCESSED event → `already_processed` (idempotent, no rework).
 * - Existing FAILED event → safe retry of processing.
 * - New event → reserve the idempotency key FIRST (so concurrent deliveries
 *   collapse onto one processor), run the handler, and mark PROCESSED only
 *   after the handler successfully commits. Handler failures and unexpected
 *   exceptions mark the event FAILED and return non-2xx so Razorpay retries.
 *
 * Unique event-id idempotency is never weakened: the reservation row carries
 * a unique key, and a lost create-race returns `already_processed`.
 */
export async function dispatchRazorpayEvent(
  prisma: PrismaClient,
  config: RazorpayConfig,
  input: DispatchInput
): Promise<DispatchResult> {
  const { dedupeKey, eventType, payload } = input;

  const existing = await prisma.razorpayWebhookEvent.findUnique({
    where: { eventId: dedupeKey },
  });
  if (existing && existing.status === "PROCESSED") {
    return { httpStatus: 200, body: { ok: true, status: "already_processed" } };
  }
  const isRetry = existing != null;

  if (!isRetry) {
    try {
      // Reservation, NOT success: overwritten with the real outcome below.
      await prisma.razorpayWebhookEvent.create({
        data: {
          eventId: dedupeKey,
          eventType: eventType ?? "unknown",
          status: "FAILED",
          errorMessage: "processing",
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { httpStatus: 200, body: { ok: true, status: "already_processed" } };
      }
      throw error;
    }
  }

  const fail = async (
    message: string,
    httpStatus: number
  ): Promise<DispatchResult> => {
    await markEvent(prisma, dedupeKey, { status: "FAILED", errorMessage: message });
    return { httpStatus, body: { error: message } };
  };

  const succeed = async (body: Record<string, unknown>): Promise<DispatchResult> => {
    await markEvent(prisma, dedupeKey, { status: "PROCESSED", errorMessage: null });
    return { httpStatus: 200, body };
  };

  try {
    if (eventType === "payment.failed") {
      const paymentWrap = asRecord(payload?.payment);
      const paymentEntityRaw = asRecord(paymentWrap?.entity);
      if (!paymentEntityRaw) {
        return fail("Missing payment entity in payload.", 400);
      }
      const paymentId =
        typeof paymentEntityRaw.id === "string" ? paymentEntityRaw.id : null;
      if (!paymentId) {
        return fail("Missing payment ID.", 400);
      }

      const result = await handlePaymentFailed(
        prisma,
        config.merchantId,
        paymentId,
        paymentEntityRaw as PaymentFailedPayload["payment"],
        dedupeKey
      );
      if (!result.ok) {
        return fail(result.error ?? "Payment handling failed.", result.status);
      }
      return succeed({
        ok: true,
        caseId: result.caseId,
        transactionId: result.transactionId,
      });
    }

    if (eventType === "payment_link.paid") {
      const paymentLinkWrap = asRecord(payload?.payment_link);
      const paymentLinkEntity = asRecord(paymentLinkWrap?.entity);
      const paymentWrap = asRecord(payload?.payment);
      const paymentEntityRaw = asRecord(paymentWrap?.entity);

      if (!paymentLinkEntity) {
        return fail("Missing payment_link entity in payload.", 400);
      }
      if (!paymentEntityRaw) {
        return fail("Missing payment entity in payload.", 400);
      }
      const paymentLinkId =
        typeof paymentLinkEntity.id === "string" ? paymentLinkEntity.id : null;
      const paymentId =
        typeof paymentEntityRaw.id === "string" ? paymentEntityRaw.id : null;
      if (!paymentLinkId || !paymentId) {
        return fail("Missing payment link or payment ID.", 400);
      }

      const result = await handlePaymentLinkPaid(
        prisma,
        config.merchantId,
        paymentLinkId,
        paymentEntityRaw as PaymentLinkPaidPayload["payment"],
        dedupeKey
      );
      if (!result.ok) {
        return fail(result.error ?? "Payment handling failed.", result.status);
      }
      return succeed({ ok: true, caseId: result.caseId });
    }

    return succeed({ ok: true, status: "event_ignored" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Webhook processing failed.";
    // Never leak stack internals beyond the message.
    return fail(message.slice(0, 500), 500);
  }
}
