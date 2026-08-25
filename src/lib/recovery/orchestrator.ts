import { DEFAULT_POLICY, type ActionType, type PolicyConfig, type PolicyEvaluation } from "@/lib/domain/types";
import { evaluatePolicy } from "@/lib/policy/engine";
import { simulateOutcome } from "@/lib/simulation/outcomes";
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

export const TERMINAL_CASE_STATUSES = ["RECOVERED", "FAILED", "STOPPED"];

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
      outcome: ReturnType<typeof simulateOutcome>;
      messages: string[];
      policy: PolicyEvaluation;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message?: string;
      policy?: PolicyEvaluation;
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
      event: "ACTION_BLOCKED",
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

  const outcome = simulateOutcome({
    caseId: recoveryCase.id,
    scenario: recoveryCase.scenario,
    action: requestedAction,
    attemptNumber,
    amountAtRiskPaise: recoveryCase.amountAtRisk,
    now,
    rng: opts?.rng,
  });

  const executedNow =
    outcome.status === "SCHEDULED" ? null : now;
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

  const created = await store.createIntervention(intervention);

  await store.createAuditLog({
    recoveryCaseId: recoveryCase.id,
    event: `INTERVENTION_${requestedAction}`,
    actor: "SYSTEM",
    metadata: auditMetadata(recoveryCase, {
      action: requestedAction,
      attemptNumber,
      interventionId: created.id,
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
    }),
  });

  let retryCount = recoveryCase.retryCount;
  let contactCount = recoveryCase.contactCount;
  if (isRetryAction) retryCount += 1;
  if (
    requestedAction === "SEND_REMINDER" ||
    requestedAction === "OFFER_ASSISTANCE"
  ) {
    contactCount += 1;
  }

  let status: CaseUpdateData["status"];
  let resolvedAt: Date | null = null;

  if (requestedAction === "ESCALATE_TO_MERCHANT") {
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

  if (outcome.status === "COMPLETED" && outcome.result !== "SUCCESS" && status !== "STOPPED") {
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
): Promise<{ ok: boolean; error?: string }> {
  const recoveryCase = await store.getCase(caseId);
  if (!recoveryCase) return { ok: false, error: "Recovery case not found." };
  if (recoveryCase.merchantApproved) {
    return { ok: false, error: "Case is already approved." };
  }
  const now = opts?.now ?? new Date();
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
