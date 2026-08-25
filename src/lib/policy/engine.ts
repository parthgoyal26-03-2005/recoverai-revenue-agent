import {
  PROGRESS_ACTIONS,
  RECOVERY_ACTIONS,
  type ActionPermission,
  type ActionType,
  type PolicyConfig,
  type PolicyContext,
  type PolicyEvaluation,
} from "@/lib/domain/types";

export function isWindowExpired(ctx: PolicyContext): boolean {
  const now = ctx.now ?? new Date();
  return now.getTime() > ctx.windowExpiresAt.getTime();
}

function expiredEvaluation(
  ctx: PolicyContext,
  windowHours: number
): PolicyEvaluation {
  const permissions: ActionPermission[] = RECOVERY_ACTIONS.map((action) => ({
    action,
    allowed: action === "STOP_RECOVERY",
    reason:
      action === "STOP_RECOVERY"
        ? "Recovery window has expired; recovery must stop."
        : `Blocked: recovery window of ${windowHours}h has expired.`,
  }));
  return {
    eligible: false,
    stopRequired: true,
    escalateRequired: false,
    windowExpired: true,
    retriesRemaining: 0,
    contactsRemaining: 0,
    requiresApproval: false,
    permissions,
    allowedActions: ["STOP_RECOVERY"],
    summaryReason: `Blocked: recovery window of ${windowHours}h has expired. Recovery stopped.`,
  };
}

export function evaluatePolicy(
  ctx: PolicyContext,
  config: PolicyConfig
): PolicyEvaluation {
  if (isWindowExpired(ctx)) {
    return expiredEvaluation(ctx, config.recoveryWindowHours);
  }

  const retriesRemaining = Math.max(0, config.maxRetries - ctx.retryCount);
  const contactsRemaining = Math.max(
    0,
    config.maxContactAttempts - ctx.contactCount
  );
  const retriesExhausted = retriesRemaining === 0;
  const contactsExhausted = contactsRemaining === 0;
  const requiresApproval =
    ctx.amountAtRiskPaise >= config.approvalThresholdPaise &&
    !ctx.merchantApproved;

  const permissions: ActionPermission[] = [];
  const perm = (action: ActionType, allowed: boolean, reason: string) =>
    permissions.push({ action, allowed, reason });

  switch (ctx.scenario) {
    case "FAILED_PAYMENT": {
      perm(
        "RETRY_PAYMENT",
        retriesRemaining > 0 && !requiresApproval,
        !retriesRemaining
          ? "Retry blocked: maximum retry limit reached."
          : requiresApproval
            ? "Retry blocked: high-value case requires merchant approval."
            : `Retry allowed (attempt ${ctx.retryCount + 1} of ${config.maxRetries}).`
      );
      perm(
        "SCHEDULE_RETRY",
        retriesRemaining > 0 && !requiresApproval,
        !retriesRemaining
          ? "Schedule blocked: maximum retry limit reached."
          : requiresApproval
            ? "Schedule blocked: high-value case requires merchant approval."
            : `Schedule allowed (attempt ${ctx.retryCount + 1} of ${config.maxRetries}).`
      );
      perm(
        "SEND_REMINDER",
        false,
        "Not applicable: failed payments are retried, not reminded."
      );
      perm(
        "OFFER_ASSISTANCE",
        false,
        "Not applicable for failed payments in current policy."
      );
      perm(
        "ESCALATE_TO_MERCHANT",
        requiresApproval || retriesExhausted,
        requiresApproval
          ? "Escalation required: amount at or above approval threshold."
          : retriesExhausted
            ? "Escalation possible: retry limit reached."
            : "Escalation not required while retries remain."
      );
      break;
    }

    case "CHECKOUT_ABANDONMENT": {
      perm(
        "SEND_REMINDER",
        contactsRemaining > 0,
        !contactsRemaining
          ? "Reminder blocked: maximum contact attempts reached."
          : `Reminder allowed (contact ${ctx.contactCount + 1} of ${config.maxContactAttempts}).`
      );
      perm(
        "OFFER_ASSISTANCE",
        contactsRemaining > 0,
        !contactsRemaining
          ? "Assistance blocked: maximum contact attempts reached."
          : `Assistance allowed (contact ${ctx.contactCount + 1} of ${config.maxContactAttempts}).`
      );
      perm("RETRY_PAYMENT", false, "Not applicable: no payment attempt exists yet.");
      perm(
        "SCHEDULE_RETRY",
        false,
        "Not applicable: no payment attempt exists yet."
      );
      perm(
        "ESCALATE_TO_MERCHANT",
        false,
        "Not applicable: checkout abandonment does not require merchant approval."
      );
      break;
    }

    case "SUBSCRIPTION_FAILURE": {
      perm(
        "RETRY_PAYMENT",
        false,
        "Use SCHEDULE_RETRY: subscription mandates retry on schedule."
      );
      perm(
        "SCHEDULE_RETRY",
        retriesRemaining > 0 && !requiresApproval,
        !retriesRemaining
          ? "Schedule blocked: maximum retry limit reached."
          : requiresApproval
            ? "Schedule blocked: high-value case requires merchant approval."
            : `Schedule allowed (retry ${ctx.retryCount + 1} of ${config.maxRetries}).`
      );
      perm(
        "SEND_REMINDER",
        false,
        "Not applicable: subscription failures are retried automatically."
      );
      perm(
        "OFFER_ASSISTANCE",
        false,
        "Not applicable: subscription failures are retried automatically."
      );
      perm(
        "ESCALATE_TO_MERCHANT",
        requiresApproval || retriesExhausted,
        requiresApproval
          ? "Escalation required: amount at or above approval threshold."
          : retriesExhausted
            ? "Escalation available: retry limit reached."
            : "Escalation not required while retries remain."
      );
      break;
    }
  }

  const stopRequired =
    (ctx.scenario === "FAILED_PAYMENT" && retriesExhausted) ||
    (ctx.scenario === "CHECKOUT_ABANDONMENT" && contactsExhausted) ||
    (ctx.scenario === "SUBSCRIPTION_FAILURE" && retriesExhausted && !requiresApproval);

  perm(
    "STOP_RECOVERY",
    true,
    "Merchant or system may stop recovery at any time."
  );

  const allowedActions = permissions
    .filter((p) => p.allowed)
    .map((p) => p.action);

  const eligible = allowedActions.some((a) => PROGRESS_ACTIONS.includes(a));

  let summaryReason: string;
  if (stopRequired && !eligible) {
    summaryReason = "Limits reached; recovery must stop.";
  } else if (requiresApproval && !eligible) {
    summaryReason =
      "High-value case: merchant approval is required before further recovery.";
  } else if (!eligible) {
    summaryReason = "No progress actions are currently allowed by policy.";
  } else {
    summaryReason = `Case is eligible for recovery. Allowed: ${allowedActions.join(", ")}.`;
  }

  return {
    eligible,
    stopRequired,
    escalateRequired: requiresApproval || (ctx.scenario === "SUBSCRIPTION_FAILURE" && retriesExhausted),
    windowExpired: false,
    retriesRemaining,
    contactsRemaining,
    requiresApproval,
    permissions,
    allowedActions,
    summaryReason,
  };
}
