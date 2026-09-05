import { formatINR } from "@/lib/domain/format";

/** Short merchant-facing case reference. Full id stays in URL/tooltip. */
export function shortId(id: string): string {
  const tail = id.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return `Case #${tail || "—"}`;
}

export function humanizeEnum(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const STATUS_LABELS: Record<string, string> = {
  DETECTED: "Detected",
  DIAGNOSED: "AI analyzed",
  IN_PROGRESS: "In progress",
  RECOVERED: "Recovered",
  FAILED: "Failed",
  ESCALATED: "Approval needed",
  STOPPED: "Stopped",
  REJECTED: "Rejected",
  AWAITING_PAYMENT: "Awaiting payment",
  PENDING: "Pending",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  SUCCESS: "Success",
  FAILURE: "Failed",
};

const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Failed payment",
  CHECKOUT_ABANDONMENT: "Checkout abandonment",
  SUBSCRIPTION_FAILURE: "Subscription failure",
};

const ACTION_LABELS: Record<string, string> = {
  RETRY_PAYMENT: "Retry payment",
  SCHEDULE_RETRY: "Schedule retry",
  SEND_REMINDER: "Send reminder",
  OFFER_ASSISTANCE: "Offer assistance",
  ESCALATE_TO_MERCHANT: "Merchant review",
  STOP_RECOVERY: "Stop recovery",
};

const EVENT_LABELS: Record<string, string> = {
  CASE_CREATED: "Case detected",
  PAYMENT_FAILURE_DETECTED: "Payment failure detected",
  AI_ANALYSIS_COMPLETED: "AI analysis completed",
  AI_DIAGNOSIS_COMPLETED: "AI diagnosis completed",
  CASE_ANALYZED: "Policy evaluation",
  POLICY_EVALUATION_ALLOWED: "Policy: allowed",
  ACTION_ALLOWED: "Action allowed",
  ACTION_BLOCKED: "Action blocked",
  APPROVAL_REQUIRED: "Approval required",
  CASE_ESCALATED: "Escalated for approval",
  APPROVAL_GRANTED: "Merchant approved",
  APPROVAL_REJECTED: "Merchant rejected",
  INTERVENTION_EXECUTED: "Intervention executed",
  INTERVENTION_SCHEDULED: "Intervention scheduled",
  INTERVENTION_RETRY_PAYMENT: "Payment retry",
  INTERVENTION_SCHEDULE_RETRY: "Retry scheduled",
  INTERVENTION_SEND_REMINDER: "Reminder sent",
  INTERVENTION_OFFER_ASSISTANCE: "Assistance offered",
  INTERVENTION_ESCALATE_TO_MERCHANT: "Sent for merchant review",
  INTERVENTION_STOP_RECOVERY: "Recovery stopped",
  RECOVERY_PAYMENT_CREATED: "Payment link created",
  RECOVERY_PAYMENT_CONFIRMED: "Recovery payment confirmed",
  RECOVERY_PAYMENT_AMOUNT_MISMATCH: "Payment amount mismatch",
  RECOVERY_SUCCESS: "Revenue recovered",
  RECOVERY_FAILED: "Recovery attempt failed",
  CASE_STOPPED: "Recovery stopped",
  POLICY_LIMIT_STOP: "Policy limit reached",
  POLICY_WINDOW_EXPIRED: "Recovery window expired",
};

export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? humanizeEnum(value);
}

/**
 * Human-facing intervention result. Razorpay interventions whose notes carry
 * a "Provider error" prefix record a PROVIDER failure (e.g. Test Mode link
 * quota) — never label those Completed/Failed as if the customer payment
 * failed.
 */
export function interventionResultLabel(iv: {
  provider?: string | null;
  result?: string | null;
  notes?: string | null;
}): string {
  if (
    iv.provider === "razorpay" &&
    typeof iv.notes === "string" &&
    iv.notes.startsWith("Provider error")
  ) {
    return "Provider error";
  }
  return iv.result ? statusLabel(iv.result) : "Pending";
}

export function scenarioLabel(value: string): string {
  return SCENARIO_LABELS[value] ?? humanizeEnum(value);
}

export function actionLabel(value: string): string {
  return ACTION_LABELS[value] ?? humanizeEnum(value);
}

export function eventLabel(value: string): string {
  if (EVENT_LABELS[value]) return EVENT_LABELS[value];
  if (value.startsWith("INTERVENTION_")) {
    return actionLabel(value.replace("INTERVENTION_", ""));
  }
  return humanizeEnum(value);
}

/** Compact KPI money: ₹1.24L style, with full value available for tooltip. */
export function formatLakhINR(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(2)}L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(1)}K`;
  return formatINR(paise);
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

export function formatPct(n: number): string {
  return `${n}%`;
}
