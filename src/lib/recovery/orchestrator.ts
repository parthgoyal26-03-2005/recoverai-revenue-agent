import { DEFAULT_POLICY, type ActionType, type PolicyConfig, type PolicyEvaluation } from "@/lib/domain/types";
import { evaluatePolicy } from "@/lib/policy/engine";
import { simulateOutcome } from "@/lib/simulation/outcomes";
import { getRecoveryProvider } from "@/lib/recovery/providers";
import type { RecoveryExecutionResult } from "@/lib/recovery/providers/types";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CaseUpdateData,
  CaseWithRelations,
  NewInterventionData,
  RecoveryStore,
} from "@/lib/recovery/store";

export function policyConfigFromCase(
  recoveryCase: CaseWithRelations
): PolicyConfig {
  const p = recoveryCase.merchant.policy;
  if (!p) return DEFAULT_POLICY;
  return {
    maxRetries: p.maxRetries,
    maxContactAttempts: p.maxContactAttempts,
    recoveryWindowHours: p.recoveryWindowHours,
    approvalThresholdPaise: p.approvalThreshold,
  };
}

export const TERMINAL_CASE_STATUSES = ["RECOVERED", "FAILED", "STOPPED", "REJECTED"];

const PROGRESS_ACTION_TYPES = [
  "RETRY_PAYMENT",
  "SCHEDULE_RETRY",
  "SEND_REMINDER",
  "OFFER_ASSISTANCE",
];

export type EvaluateResult = {
  found: boolean;
  caseId?: string;
  scenario?: string;
  amountAtRiskPaise?: number;
  caseStatus?: string;
  policy?: PolicyEvaluation;
  config?: PolicyConfig;
};

export async function evaluateCase(
  store: RecoveryStore,
  caseId: string,
  opts?: { persistAudit?: boolean; now?: Date }
): Promise<EvaluateResult> {
  const recoveryCase = await store.getCase(caseId);
  if (!recoveryCase) return { found: false };

  const config = policyConfigFromCase(recoveryCase);
  const policy = evaluatePolicy(
    {
      scenario: recoveryCase.scenario,
      amountAtRiskPaise: recoveryCase.amountAtRisk,
      retryCount: recoveryCase.retryCount,
      contactCount: recoveryCase.contactCount,
      windowExpiresAt: recoveryCase.windowExpiresAt,
      merchantApproved: recoveryCase.merchantApproved,
      now: opts?.now,
    },
    config
  );

  if (opts?.persistAudit) {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "CASE_ANALYZED",
      actor: "POLICY_ENGINE",
      metadata: {
        scenario: recoveryCase.scenario,
        amountAtRisk: recoveryCase.amountAtRisk,
        eligible: policy.eligible,
        allowedActions: policy.allowedActions,
        reason: policy.summaryReason,
      },
    });
  }

  return {
    found: true,
    caseId: recoveryCase.id,
    scenario: recoveryCase.scenario,
    amountAtRiskPaise: recoveryCase.amountAtRisk,
    caseStatus: recoveryCase.status,
    policy,
    config,
  };
}

export type ExecuteOutcome =
  | {
      ok: true;
      action: ActionType;
      caseStatus: string;
      recoveredAmountPaise: number;
      outcome: RecoveryExecutionResult;
      messages: string[];
      policy: PolicyEvaluation;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message?: string;
      policy?: PolicyEvaluation;
      paymentLinkId?: string;
      paymentLinkUrl?: string;
    };

function auditMetadata(
  recoveryCase: CaseWithRelations,
  extra: Record<string, unknown>
): Prisma.InputJsonObject {
  return {
    scenario: recoveryCase.scenario,
    amountAtRisk: recoveryCase.amountAtRisk,
    ...extra,
  };
}

export async function executeCaseAction(
  store: RecoveryStore,
  caseId: string,
  requestedAction: ActionType,
  opts?: { now?: Date; rng?: () => number }
): Promise<ExecuteOutcome> {
  const now = opts?.now ?? new Date();
  const recoveryCase = await store.getCase(caseId);
  if (!recoveryCase) {
    return { ok: false, status: 404, error: "Recovery case not found." };
  }

  if (TERMINAL_CASE_STATUSES.includes(recoveryCase.status)) {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "ACTION_BLOCKED",
      actor: "POLICY_ENGINE",
      metadata: auditMetadata(recoveryCase, {
        action: requestedAction,
        reason: `Case is ${recoveryCase.status}; no further recovery actions are possible.`,
      }),
    });
    return {
      ok: false,
      status: 409,
      error: "BLOCKED_BY_POLICY",
      message: `Case is ${recoveryCase.status}; no further recovery actions are possible.`,
    };
  }

  const config = policyConfigFromCase(recoveryCase);
  const policy = evaluatePolicy(
    {
      scenario: recoveryCase.scenario,
      amountAtRiskPaise: recoveryCase.amountAtRisk,
      retryCount: recoveryCase.retryCount,
      contactCount: recoveryCase.contactCount,
      windowExpiresAt: recoveryCase.windowExpiresAt,
      merchantApproved: recoveryCase.merchantApproved,
      now,
    },
    config
  );

  const permission = policy.permissions.find(
    (p) => p.action === requestedAction
  );

  if (!permission || !permission.allowed) {
    const reason =
      permission?.reason ??
      `${requestedAction} is not a valid action for this case.`;
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event:
        policy.requiresApproval && PROGRESS_ACTION_TYPES.includes(requestedAction)
          ? "APPROVAL_REQUIRED"
          : "ACTION_BLOCKED",
      actor: "POLICY_ENGINE",
      metadata: auditMetadata(recoveryCase, {
        action: requestedAction,
        reason,
        allowedActions: policy.allowedActions,
      }),
    });
    return {
      ok: false,
      status: 409,
      error: "BLOCKED_BY_POLICY",
      message: reason,
      policy,
    };
  }

  const messages: string[] = [];
  const isRetryAction =
    requestedAction === "RETRY_PAYMENT" || requestedAction === "SCHEDULE_RETRY";
  const attemptNumber = isRetryAction
    ? recoveryCase.retryCount + 1
    : recoveryCase.contactCount + 1;

  const provider = getRecoveryProvider();
  const isRazorpayRetry =
    provider.name === "razorpay" &&
    requestedAction === "RETRY_PAYMENT" &&
    recoveryCase.scenario === "FAILED_PAYMENT";

  // Single outstanding payment rule: at most one active Razorpay recovery
  // payment per case. Never trust the UI alone — enforce server-side.
  // Reusing the pending link consumes no retry and creates no duplicates.
  if (isRazorpayRetry) {
    const pending = await store.findPendingRazorpayIntervention(recoveryCase.id);
    if (pending?.paymentLinkUrl) {
      return {
        ok: false,
        status: 409,
        error: "PAYMENT_ALREADY_PENDING",
        message: "A recovery payment is already awaiting customer payment.",
        policy,
        paymentLinkId: pending.providerReference ?? undefined,
        paymentLinkUrl: pending.paymentLinkUrl ?? undefined,
      };
    }
  }

  let created: { id: string } | null = null;
  if (isRazorpayRetry) {
    created = await store.createIntervention({
      recoveryCaseId: recoveryCase.id,
      action: requestedAction,
      status: "PENDING",
      result: "PENDING",
      scheduledAt: null,
      executedAt: null,
      recoveredAmount: 0,
      notes: null,
      provider: "razorpay",
    });
  }

  const outcome = await provider.executeAction({
    recoveryCase,
    action: requestedAction,
    attemptNumber,
    now,
    rng: opts?.rng,
    interventionId: isRazorpayRetry ? created!.id : undefined,
  });

  // Provider failure (no payment link was created) is NOT a customer retry:
  // it must not consume retry/contact budget. Only a successfully initiated
  // recovery payment counts as an attempt.
  const razorpayLinkFailed = isRazorpayRetry && !outcome.paymentLink;
  const providerErrorNotes = razorpayLinkFailed
    ? `Provider error: ${outcome.notes ?? "Payment link could not be created."}`
    : outcome.notes;

  if (isRazorpayRetry) {
    const interStatus =
      outcome.status === "PENDING"
        ? "AWAITING_PAYMENT"
        : outcome.status === "SCHEDULED"
          ? "SCHEDULED"
          : "COMPLETED";
    await store.updateIntervention(created!.id, {
      status: interStatus,
      result: outcome.result,
      executedAt: outcome.status === "SCHEDULED" ? null : now,
      recoveredAmount: 0,
      notes: providerErrorNotes,
      provider: "razorpay",
      providerReference: outcome.paymentLink?.id ?? null,
      paymentLinkUrl: outcome.paymentLink?.url ?? null,
    });
  } else {
    const executedNow = outcome.status === "SCHEDULED" ? null : now;
    const intervention: NewInterventionData = {
      recoveryCaseId: recoveryCase.id,
      action: requestedAction,
      status: outcome.status,
      result:
        outcome.status === "SCHEDULED"
          ? null
          : (outcome.result as NewInterventionData["result"]),
      scheduledAt: outcome.scheduledAt ?? null,
      executedAt: executedNow,
      recoveredAmount: outcome.recoveredAmountPaise,
      notes: outcome.notes,
    };
    created = await store.createIntervention(intervention);
  }

  await store.createAuditLog({
    recoveryCaseId: recoveryCase.id,
    event: `INTERVENTION_${requestedAction}`,
    actor: "SYSTEM",
    metadata: auditMetadata(recoveryCase, {
      action: requestedAction,
      attemptNumber,
      interventionId: created!.id,
      notes: outcome.notes,
    }),
  });
  await store.createAuditLog({
    recoveryCaseId: recoveryCase.id,
    event: "INTERVENTION_EXECUTED",
    actor: "SYSTEM",
    metadata: auditMetadata(recoveryCase, {
      action: requestedAction,
      attemptNumber,
      result: outcome.result,
      recoveredAmount: outcome.recoveredAmountPaise,
      ...(outcome.errorCode ? { providerError: outcome.errorCode } : {}),
    }),
  });

  if (isRazorpayRetry && outcome.paymentLink) {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "RECOVERY_PAYMENT_CREATED",
      actor: "SYSTEM",
      metadata: auditMetadata(recoveryCase, {
        action: requestedAction,
        attemptNumber,
        interventionId: created!.id,
        paymentLinkId: outcome.paymentLink.id,
        paymentLinkUrl: outcome.paymentLink.url,
        provider: "razorpay",
      }),
    });
  }

  let retryCount = recoveryCase.retryCount;
  let contactCount = recoveryCase.contactCount;
  if (isRetryAction && !razorpayLinkFailed) retryCount += 1;
  if (
    requestedAction === "SEND_REMINDER" ||
    requestedAction === "OFFER_ASSISTANCE"
  ) {
    contactCount += 1;
  }

  let status: CaseUpdateData["status"];
  let resolvedAt: Date | null = null;

  if (outcome.status === "PENDING") {
    status = "IN_PROGRESS";
  } else if (requestedAction === "ESCALATE_TO_MERCHANT") {
    status = "ESCALATED";
    resolvedAt = null;
  } else if (requestedAction === "STOP_RECOVERY") {
    status = "STOPPED";
    resolvedAt = now;
  } else if (
    outcome.status === "COMPLETED" &&
    outcome.result === "SUCCESS"
  ) {
    status = "RECOVERED";
    resolvedAt = now;
  } else {
    const nextPolicy = evaluatePolicy(
      {
        scenario: recoveryCase.scenario,
        amountAtRiskPaise: recoveryCase.amountAtRisk,
        retryCount,
        contactCount,
        windowExpiresAt: recoveryCase.windowExpiresAt,
        merchantApproved: recoveryCase.merchantApproved,
        now,
      },
      config
    );
    if (!nextPolicy.eligible) {
      if (
        nextPolicy.escalateRequired &&
        !nextPolicy.stopRequired &&
        recoveryCase.scenario === "SUBSCRIPTION_FAILURE"
      ) {
        status = "ESCALATED";
        messages.push("Retry limit reached; case escalated to merchant.");
      } else if (nextPolicy.stopRequired) {
        status = "STOPPED";
        resolvedAt = now;
      } else {
        status = "IN_PROGRESS";
      }
    } else {
      status = "IN_PROGRESS";
    }
  }

  await store.updateCase(recoveryCase.id, {
    status,
    resolvedAt,
    retryCount,
    contactCount,
  });

  if (outcome.status === "COMPLETED" && outcome.result === "SUCCESS") {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "RECOVERY_SUCCESS",
      actor: "SYSTEM",
      metadata: auditMetadata(recoveryCase, {
        action: requestedAction,
        attemptNumber,
        recoveredAmount: outcome.recoveredAmountPaise,
      }),
    });
    messages.push(
      `Recovery succeeded: recovered ₹${(outcome.recoveredAmountPaise / 100).toLocaleString("en-IN")}.`
    );
  } else if (outcome.status === "SCHEDULED") {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "ACTION_ALLOWED",
      actor: "POLICY_ENGINE",
      metadata: auditMetadata(recoveryCase, {
        action: requestedAction,
        scheduledAt: outcome.scheduledAt?.toISOString(),
      }),
    });
    messages.push(`Retry scheduled for ${outcome.scheduledAt?.toISOString()}.`);
  } else if (status === "STOPPED") {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "CASE_STOPPED",
      actor: "POLICY_ENGINE",
      metadata: auditMetadata(recoveryCase, {
        action: requestedAction,
        reason:
          outcome.result === "FAILURE"
            ? "Limits reached after failed attempt."
            : "Recovery stopped.",
      }),
    });
    messages.push("Recovery stopped: limits reached.");
  }

  if (isRazorpayRetry && outcome.paymentLink) {
    messages.push(
      `Payment link created. Share ${outcome.paymentLink.url} with the customer to complete payment. The case is now awaiting customer payment.`
    );
  }

  if (razorpayLinkFailed) {
    // No customer attempt occurred: say so plainly. Never the generic
    // "Attempt did not recover revenue" wording, and no RECOVERY_FAILED
    // audit (that event implies a failed customer attempt).
    if (outcome.errorCode === "RAZORPAY_TEST_LINK_LIMIT_REACHED") {
      messages.push(
        "Razorpay Test Mode Payment Link limit reached. This Razorpay test account allows up to 30 Payment Links. Contact Razorpay Support for additional test links or use RecoverAI Simulation Mode for the demo."
      );
      messages.push(
        "Recovery payment could not be created because the Razorpay Test Mode link limit has been reached. No retry was consumed."
      );
    } else {
      messages.push(
        "Recovery payment could not be created because of a provider error. No retry was consumed."
      );
    }
  } else if (outcome.status === "COMPLETED" && outcome.result !== "SUCCESS" && status !== "STOPPED") {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "RECOVERY_FAILED",
      actor: "SYSTEM",
      metadata: auditMetadata(recoveryCase, {
        action: requestedAction,
        attemptNumber,
        result: outcome.result,
        recoveredAmount: 0,
      }),
    });
    messages.push("Attempt did not recover revenue; zero revenue recorded.");
  }

  if (status === "ESCALATED" && requestedAction === "ESCALATE_TO_MERCHANT") {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "CASE_ESCALATED",
      actor: "POLICY_ENGINE",
      metadata: auditMetadata(recoveryCase, {
        reason: "Merchant approval required.",
      }),
    });
    messages.push("Case escalated to merchant for approval.");
  }

  return {
    ok: true,
    action: requestedAction,
    caseStatus: status as string,
    recoveredAmountPaise: outcome.recoveredAmountPaise,
    outcome,
    messages,
    policy,
  };
}

export async function approveCase(
  store: RecoveryStore,
  caseId: string,
  opts?: { now?: Date }
): Promise<{
  ok: boolean;
  error?: string;
  approvedAt?: string;
  windowReopened?: boolean;
  newWindowExpiresAt?: string;
}> {
  const recoveryCase = await store.getCase(caseId);
  if (!recoveryCase) return { ok: false, error: "Recovery case not found." };
  if (recoveryCase.merchantRejectedAt) {
    return { ok: false, error: "Case was rejected by the merchant." };
  }
  if (recoveryCase.merchantApproved) {
    return { ok: false, error: "Case is already approved." };
  }
  if (TERMINAL_CASE_STATUSES.includes(recoveryCase.status)) {
    return {
      ok: false,
      error: `Case is ${recoveryCase.status}; approval is no longer possible.`,
    };
  }

  const now = opts?.now ?? new Date();
  const config = policyConfigFromCase(recoveryCase);
  const expired = now.getTime() > recoveryCase.windowExpiresAt.getTime();

  if (!expired) {
    await store.updateCase(recoveryCase.id, {
      merchantApproved: true,
      merchantApprovedAt: now,
    });
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "APPROVAL_GRANTED",
      actor: "MERCHANT",
      metadata: auditMetadata(recoveryCase, {
        approvedAt: now.toISOString(),
      }),
    });
    return { ok: true, approvedAt: now.toISOString() };
  }

  // Window expired. Ordinary (non-approval-required) cases stay expired.
  const needsApproval =
    recoveryCase.amountAtRisk >= config.approvalThresholdPaise &&
    !recoveryCase.merchantApproved;
  if (!needsApproval) {
    return {
      ok: false,
      error: "Recovery window has expired; approval is no longer possible.",
    };
  }

  // Approval-required case: allow approval only if retry/contact limits are
  // still available. Probe policy as if approved inside a fresh window.
  const newWindowExpiresAt = new Date(
    now.getTime() + config.recoveryWindowHours * 3_600_000
  );
  const probe = evaluatePolicy(
    {
      scenario: recoveryCase.scenario,
      amountAtRiskPaise: recoveryCase.amountAtRisk,
      retryCount: recoveryCase.retryCount,
      contactCount: recoveryCase.contactCount,
      windowExpiresAt: newWindowExpiresAt,
      merchantApproved: true,
      now,
    },
    config
  );
  if (probe.stopRequired) {
    return {
      ok: false,
      error: "Recovery limits have been reached; approval is no longer possible.",
    };
  }

  const previousWindowExpiresAt = recoveryCase.windowExpiresAt;
  await store.updateCase(recoveryCase.id, {
    merchantApproved: true,
    merchantApprovedAt: now,
    windowExpiresAt: newWindowExpiresAt,
  });
  await store.createAuditLog({
    recoveryCaseId: recoveryCase.id,
    event: "APPROVAL_GRANTED",
    actor: "MERCHANT",
    metadata: auditMetadata(recoveryCase, {
      approvedAt: now.toISOString(),
      newWindowExpiresAt: newWindowExpiresAt.toISOString(),
    }),
  });
  await store.createAuditLog({
    recoveryCaseId: recoveryCase.id,
    event: "RECOVERY_WINDOW_REOPENED",
    actor: "POLICY_ENGINE",
    metadata: auditMetadata(recoveryCase, {
      previousWindowExpiresAt: previousWindowExpiresAt.toISOString(),
      newWindowExpiresAt: newWindowExpiresAt.toISOString(),
      recoveryWindowHours: config.recoveryWindowHours,
    }),
  });
  return {
    ok: true,
    approvedAt: now.toISOString(),
    windowReopened: true,
    newWindowExpiresAt: newWindowExpiresAt.toISOString(),
  };
}

export async function rejectCase(
  store: RecoveryStore,
  caseId: string,
  reason: string,
  opts?: { now?: Date }
): Promise<{ ok: boolean; error?: string }> {
  const recoveryCase = await store.getCase(caseId);
  if (!recoveryCase) return { ok: false, error: "Recovery case not found." };
  if (recoveryCase.merchantRejectedAt) {
    return { ok: false, error: "Case was already rejected." };
  }
  if (TERMINAL_CASE_STATUSES.includes(recoveryCase.status)) {
    return {
      ok: false,
      error: `Case is ${recoveryCase.status}; rejection is no longer possible.`,
    };
  }

  const now = opts?.now ?? new Date();
  await store.updateCase(recoveryCase.id, {
    merchantRejectedAt: now,
    rejectionReason: reason,
    status: "REJECTED",
    resolvedAt: now,
  });
  await store.createAuditLog({
    recoveryCaseId: recoveryCase.id,
    event: "APPROVAL_REJECTED",
    actor: "MERCHANT",
    metadata: auditMetadata(recoveryCase, {
      reason,
      rejectedAt: now.toISOString(),
    }),
  });
  return { ok: true };
}

async function resolveScheduledIntervention(
  store: RecoveryStore,
  due: Awaited<ReturnType<RecoveryStore["findDueScheduledInterventions"]>>[number],
  opts?: { rng?: () => number }
): Promise<void> {
  const recoveryCase = due.recoveryCase;
  const now = new Date();
  const attemptNumber = recoveryCase.retryCount + 1;
  const outcome = simulateOutcome({
    caseId: recoveryCase.id,
    scenario: recoveryCase.scenario,
    action: "RETRY_PAYMENT",
    attemptNumber,
    amountAtRiskPaise: recoveryCase.amountAtRisk,
    now,
    rng: opts?.rng
      ? () => opts.rng!()
      : undefined,
  });

  await store.updateIntervention(due.id, {
    status: "COMPLETED",
    result: outcome.result,
    executedAt: now,
    recoveredAmount: outcome.recoveredAmountPaise,
    notes: outcome.notes,
  });

  const config = policyConfigFromCase(recoveryCase);
  const retryCount = recoveryCase.retryCount + 1;
  const success = outcome.result === "SUCCESS";

  const nextPolicy = evaluatePolicy(
    {
      scenario: recoveryCase.scenario,
      amountAtRiskPaise: recoveryCase.amountAtRisk,
      retryCount,
      contactCount: recoveryCase.contactCount,
      windowExpiresAt: recoveryCase.windowExpiresAt,
      merchantApproved: recoveryCase.merchantApproved,
      now,
    },
    config
  );

  let status: CaseUpdateData["status"];
  let resolvedAt: Date | null = null;
  if (success) {
    status = "RECOVERED";
    resolvedAt = now;
  } else if (nextPolicy.stopRequired) {
    status = "STOPPED";
    resolvedAt = now;
  } else if (
    recoveryCase.scenario === "SUBSCRIPTION_FAILURE" &&
    !nextPolicy.eligible &&
    nextPolicy.escalateRequired
  ) {
    status = "ESCALATED";
  } else {
    status = "IN_PROGRESS";
  }

  await store.updateCase(recoveryCase.id, {
    status,
    resolvedAt,
    retryCount,
  });

  await store.createAuditLog({
    recoveryCaseId: recoveryCase.id,
    event: "INTERVENTION_EXECUTED",
    actor: "SYSTEM",
    metadata: {
      scenario: recoveryCase.scenario,
      amountAtRisk: recoveryCase.amountAtRisk,
      action: "RETRY_PAYMENT",
      attemptNumber,
      result: outcome.result,
      recoveredAmount: outcome.recoveredAmountPaise,
      source: "scheduled_run",
    },
  });

  if (success) {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "RECOVERY_SUCCESS",
      actor: "SYSTEM",
      metadata: {
        scenario: recoveryCase.scenario,
        amountAtRisk: recoveryCase.amountAtRisk,
        action: "RETRY_PAYMENT",
        attemptNumber,
        recoveredAmount: outcome.recoveredAmountPaise,
      },
    });
  } else if (status === "STOPPED") {
    await store.createAuditLog({
      recoveryCaseId: recoveryCase.id,
      event: "CASE_STOPPED",
      actor: "POLICY_ENGINE",
      metadata: {
        scenario: recoveryCase.scenario,
        amountAtRisk: recoveryCase.amountAtRisk,
        reason: "Limits reached after scheduled retry.",
      },
    });
  }
}

export async function processDueActions(
  store: RecoveryStore,
  opts?: { now?: Date; rng?: () => number }
): Promise<{ processed: number }> {
  const now = opts?.now ?? new Date();
  const due = await store.findDueScheduledInterventions(now);
  for (const item of due) {
    await resolveScheduledIntervention(store, item, opts);
  }
  return { processed: due.length };
}

export type BatchCaseResult = {
  caseId: string;
  status: "executed" | "blocked" | "approval_required";
  actionType: string;
  caseStatusAfter: string;
  recoveredAmountPaise: number;
};

export type BatchRunSummary = {
  processedCases: number;
  results: BatchCaseResult[];
  revenueAtRiskPaise: number;
};

const BATCH_PROGRESS_ACTIONS = [
  "RETRY_PAYMENT",
  "SCHEDULE_RETRY",
  "SEND_REMINDER",
  "OFFER_ASSISTANCE",
];

export async function runRecoveryBatch(
  store: RecoveryStore,
  opts?: { now?: Date; rng?: () => number; maxCases?: number; onProgress?: (processed: number, total: number, last: BatchCaseResult) => void }
): Promise<BatchRunSummary> {
  const activeCases = await store.findActiveCases(opts?.maxCases ?? 200);
  const results: BatchCaseResult[] = [];
  let revenueAtRiskPaise = 0;

  for (let i = 0; i < activeCases.length; i++) {
    const kase = activeCases[i];
    let result: BatchCaseResult = {
      caseId: kase.id,
      status: "blocked",
      actionType: "NONE",
      caseStatusAfter: kase.status,
      recoveredAmountPaise: 0,
    };

    const evaluation = await evaluateCase(store, kase.id, { now: opts?.now });
    if (!evaluation.found || !evaluation.policy) {
      results.push(result);
      opts?.onProgress?.(i + 1, activeCases.length, result);
      continue;
    }

    const policy = evaluation.policy;
    const progressAction = policy.allowedActions.find(
      (a) => BATCH_PROGRESS_ACTIONS.includes(a)
    );

    if (policy.requiresApproval) {
      const escalateAllowed = policy.allowedActions.includes("ESCALATE_TO_MERCHANT");
      if (escalateAllowed && !kase.merchantApproved) {
        const outcome = await executeCaseAction(store, kase.id, "ESCALATE_TO_MERCHANT", opts);
        result = {
          caseId: kase.id,
          status: outcome.ok ? "executed" : "blocked",
          actionType: "ESCALATE_TO_MERCHANT",
          caseStatusAfter: outcome.ok ? outcome.caseStatus : kase.status,
          recoveredAmountPaise: outcome.ok ? outcome.recoveredAmountPaise : 0,
        };
        if (outcome.ok) result.status = "approval_required";
      } else {
        result.status = "approval_required";
      }
    } else if (progressAction) {
      const outcome = await executeCaseAction(store, kase.id, progressAction, opts);
      result = {
        caseId: kase.id,
        status: outcome.ok ? "executed" : "blocked",
        actionType: progressAction,
        caseStatusAfter: outcome.ok ? outcome.caseStatus : kase.status,
        recoveredAmountPaise: outcome.ok ? outcome.recoveredAmountPaise : 0,
      };
    } else if (policy.stopRequired && policy.allowedActions.includes("STOP_RECOVERY")) {
      const outcome = await executeCaseAction(store, kase.id, "STOP_RECOVERY", opts);
      result = {
        caseId: kase.id,
        status: outcome.ok ? "executed" : "blocked",
        actionType: "STOP_RECOVERY",
        caseStatusAfter: outcome.ok ? outcome.caseStatus : kase.status,
        recoveredAmountPaise: 0,
      };
    }

    revenueAtRiskPaise += kase.amountAtRisk;
    results.push(result);
    opts?.onProgress?.(results.length, activeCases.length, result);
  }

  return { processedCases: results.length, results, revenueAtRiskPaise };
}
