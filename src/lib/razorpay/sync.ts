import { PrismaClient } from "@/generated/prisma/client";
import type { RazorpayConfig } from "./config";
import { fetchPaymentLink } from "./client";
import { confirmRecoveryPayment } from "./handler";

export type SyncOutcome =
  | { outcome: "recovered"; caseId: string; recoveredAmountPaise: number }
  | { outcome: "already_recovered"; caseId: string }
  | { outcome: "pending" }
  | { outcome: "unknown"; linkStatus?: string }
  | { outcome: "mismatch"; error: string }
  | { outcome: "expired" }
  | { outcome: "cancelled" }
  | { outcome: "no_pending_payment"; error: string }
  | { outcome: "not_found"; error: string }
  | { outcome: "error"; error: string };

/**
 * Server-side payment reconciliation fallback.
 *
 * Loads the case, finds its latest active Razorpay AWAITING_PAYMENT
 * intervention, fetches that Payment Link from Razorpay with server
 * credentials, and acts on the authoritative link status:
 *
 * - created (+ nothing paid) → pending, case untouched
 * - paid → amount/currency/capture verified, then the SHARED
 *   confirmRecoveryPayment() (same code as the webhook path)
 * - expired / cancelled → intervention closed as no longer awaiting payment
 *   (never recovered; future retry only if policy allows)
 * - partially_paid → mismatch (links are created with accept_partial=false)
 *
 * Never increments retry counts and never creates payment links.
 */
export async function syncPaymentLinkStatus(
  prisma: PrismaClient,
  config: RazorpayConfig,
  caseId: string
): Promise<SyncOutcome> {
  const kase = await prisma.recoveryCase.findUnique({ where: { id: caseId } });
  if (!kase) {
    return { outcome: "not_found", error: "Recovery case not found." };
  }
  if (kase.merchantId !== config.merchantId) {
    return { outcome: "not_found", error: "Recovery case not found." };
  }
  if (kase.status === "RECOVERED") {
    return { outcome: "already_recovered", caseId: kase.id };
  }

  const intervention = await prisma.recoveryIntervention.findFirst({
    where: {
      recoveryCaseId: kase.id,
      provider: "razorpay",
      status: "AWAITING_PAYMENT",
      result: "PENDING",
    },
    orderBy: { createdAt: "desc" },
  });
  if (!intervention?.providerReference) {
    return { outcome: "no_pending_payment", error: "No payment awaiting confirmation." };
  }

  const fetched = await fetchPaymentLink(config, intervention.providerReference);
  if (!fetched.ok || !fetched.link) {
    return {
      outcome: "error",
      error: fetched.error ?? "Could not reach Razorpay.",
    };
  }
  const link = fetched.link;
  const expectedAmount = kase.amountAtRisk;

  if (link.status === "paid") {
    if (link.amount_paid !== expectedAmount) {
      return {
        outcome: "mismatch",
        error: `Paid amount does not match the recovery amount (expected ${expectedAmount}, got ${link.amount_paid ?? "unknown"}).`,
      };
    }
    const captured =
      link.payments.find(
        (p) =>
          p.status === "captured" &&
          p.amount === expectedAmount &&
          (p.currency ?? "INR") === "INR"
      ) ?? link.payments.find((p) => p.status === "captured");
    if (!captured) {
      return {
        outcome: "mismatch",
        error: "Paid link has no captured payment to confirm.",
      };
    }
    const result = await confirmRecoveryPayment(prisma, config.merchantId, {
      paymentLinkId: link.id,
      paymentId: captured.id,
      amount: captured.amount ?? link.amount_paid,
      currency: captured.currency ?? link.currency ?? "INR",
      paymentStatus: captured.status,
      eventId: `sync-${link.id}-${Date.now()}`,
      eventType: "sync-payment",
      linkNotes: link.notes,
    });
    if (!result.ok) {
      return { outcome: "mismatch", error: result.error ?? "Payment could not be confirmed." };
    }
    if (result.alreadyRecovered) {
      return { outcome: "already_recovered", caseId: kase.id };
    }
    return {
      outcome: "recovered",
      caseId: kase.id,
      recoveredAmountPaise: result.recoveredAmountPaise ?? expectedAmount,
    };
  }

  if (link.status === "created") {
    return { outcome: "pending" };
  }

  if (link.status === "expired" || link.status === "cancelled") {
    const now = new Date();
    await prisma.recoveryIntervention.update({
      where: { id: intervention.id },
      data: {
        status: "COMPLETED",
        result: "FAILURE",
        executedAt: now,
        notes: `Razorpay payment link ${link.status}; no longer awaiting payment.`,
      },
    });
    await prisma.auditLog.create({
      data: {
        recoveryCaseId: kase.id,
        event:
          link.status === "expired"
            ? "RECOVERY_PAYMENT_EXPIRED"
            : "RECOVERY_PAYMENT_CANCELLED",
        actor: "SYSTEM",
        metadata: {
          source: "razorpay",
          eventType: "sync-payment",
          paymentLinkId: link.id,
          linkStatus: link.status,
          expectedAmount,
        },
      },
    });
    return { outcome: link.status };
  }

  if (link.status === "partially_paid") {
    return {
      outcome: "mismatch",
      error: "Partial payment is not accepted for this recovery link.",
    };
  }

  return { outcome: "unknown", linkStatus: link.status };
}
