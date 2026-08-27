import { prisma } from "@/lib/db/prisma";
import type { ScenarioType } from "@/generated/prisma/client";
import { DEFAULT_POLICY } from "@/lib/domain/types";
import { evaluatePolicy } from "@/lib/policy/engine";

export const ACTIVE_CASE_STATUSES = [
  "DETECTED",
  "DIAGNOSED",
  "IN_PROGRESS",
  "ESCALATED",
] as const;

export const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Failed Payments",
  CHECKOUT_ABANDONMENT: "Checkout Abandonments",
  SUBSCRIPTION_FAILURE: "Failed Subscriptions",
};

export function computeRecoveryRate(
  recoveredPaise: number,
  totalAtRiskPaise: number
): number {
  if (totalAtRiskPaise <= 0) return 0;
  return Number(((recoveredPaise / totalAtRiskPaise) * 100).toFixed(1));
}

export type ScenarioRowInput = {
  scenario: string;
  cases: number;
  amountAtRiskPaise: number;
  recoveredPaise: number;
  failedAttempts: number;
  escalations: number;
};

export type ScenarioAnalytics = ScenarioRowInput & {
  recoveryRatePct: number;
};

export function computeScenarioAnalytics(
  rows: ScenarioRowInput[]
): ScenarioAnalytics[] {
  return rows.map((row) => ({
    ...row,
    recoveryRatePct: computeRecoveryRate(row.recoveredPaise, row.amountAtRiskPaise),
  }));
}

export type FunnelInput = {
  atRiskPaise: number;
  casesAnalyzed: number;
  casesEligible: number;
  actionsExecuted: number;
  recoveredCases: number;
  recoveredPaise: number;
};

export type FunnelStage = {
  label: string;
  value: string;
  sub?: string;
};

export function computeFunnelStages(input: FunnelInput): FunnelStage[] {
  return [
    {
      label: "Revenue At Risk",
      value: formatRupeesShort(input.atRiskPaise),
      sub: `${input.casesAnalyzed} cases detected & analyzed`,
    },
    {
      label: "Cases Analyzed",
      value: String(input.casesAnalyzed),
    },
    {
      label: "Cases Eligible",
      value: String(input.casesEligible),
      sub: `${Math.max(0, input.casesAnalyzed - input.casesEligible)} outside policy or already resolved`,
    },
    {
      label: "Actions Executed",
      value: String(input.actionsExecuted),
      sub: "retries, reminders & escalations",
    },
    {
      label: "Cases Recovered",
      value: String(input.recoveredCases),
      sub: `${formatRupeesShort(input.recoveredPaise)} recovered`,
    },
  ];
}

export function formatRupeesShort(paise: number): string {
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(paise / 100);
}

export type ApprovalAttentionInput = {
  status: string;
  amountAtRisk: number;
  merchantApproved: boolean;
  merchantRejectedAt?: Date | null;
};

export function computeApprovalAttention(
  rows: ApprovalAttentionInput[]
): { cases: number; amountPaise: number } {
  const pending = rows.filter(
    (r) => r.status === "ESCALATED" && !r.merchantApproved && !r.merchantRejectedAt
  );
  return {
    cases: pending.length,
    amountPaise: pending.reduce((s, r) => s + r.amountAtRisk, 0),
  };
}

export type CaseRowAction = {
  label: string;
  cta: string;
  tone: "approval" | "ready" | "scheduled" | "recovered" | "failed" | "rejected" | "stopped" | "view";
};

export function getCaseRowAction(input: {
  status: string;
  merchantApproved: boolean;
  merchantRejectedAt?: Date | null;
  windowExpiresAt: Date;
  hasScheduledIntervention: boolean;
  allowedProgressAction: boolean;
}): CaseRowAction {
  const now = Date.now();
  if (input.status === "RECOVERED") {
    return { label: "Recovered", cta: "View", tone: "recovered" };
  }
  if (input.status === "FAILED") {
    return { label: "Failed", cta: "View", tone: "failed" };
  }
  if (input.status === "STOPPED") {
    return { label: "Stopped", cta: "View", tone: "stopped" };
  }
  if (input.status === "REJECTED" || input.merchantRejectedAt) {
    return { label: "Rejected by merchant", cta: "View", tone: "rejected" };
  }
  if (now > input.windowExpiresAt.getTime()) {
    return { label: "Window expired", cta: "View", tone: "view" };
  }
  if (
    input.status === "ESCALATED" && !input.merchantApproved
  ) {
    return { label: "Approval Required", cta: "Review", tone: "approval" };
  }
  if (input.hasScheduledIntervention) {
    return { label: "Scheduled", cta: "View", tone: "scheduled" };
  }
  if (input.allowedProgressAction) {
    return {
      label: input.merchantApproved ? "Approved · Ready to Execute" : "Ready to Execute",
      cta: "Execute",
      tone: "ready",
    };
  }
  return { label: "In Progress", cta: "View", tone: "view" };
}

export type AiDecisionRowInput = {
  confidence: number;
  policyAllowed: boolean | undefined;
  recommendedAction: string;
  requiresMerchantAttention: boolean;
};

export type AiPerformanceStats = {
  analysesPerformed: number;
  acceptedCount: number;
  blockedByPolicyCount: number;
  approvalRequiredCount: number;
  avgConfidencePct: number;
};

export function computeAiPerformance(rows: AiDecisionRowInput[]): AiPerformanceStats {
  if (rows.length === 0) {
    return {
      analysesPerformed: 0,
      acceptedCount: 0,
      blockedByPolicyCount: 0,
      approvalRequiredCount: 0,
      avgConfidencePct: 0,
    };
  }
  const withPolicyVerdict = rows.filter((r) => r.policyAllowed !== undefined);
  return {
    analysesPerformed: rows.length,
    acceptedCount: withPolicyVerdict.filter((r) => r.policyAllowed).length,
    blockedByPolicyCount: withPolicyVerdict.filter((r) => !r.policyAllowed).length,
    approvalRequiredCount: rows.filter(
      (r) => r.requiresMerchantAttention || r.recommendedAction === "ESCALATE_TO_MERCHANT"
    ).length,
    avgConfidencePct:
      Math.round((rows.reduce((s, r) => s + r.confidence, 0) / rows.length) * 100),
  };
}

export type PolicySafetyEventInput = {
  event: string;
  blockReason?: string;
};

export type PolicySafetyStats = {
  allowed: number;
  blocked: number;
  approvalRequired: number;
  stopped: number;
  terminalPrevented: number;
};

const TERMINAL_BLOCK_PATTERN = /no further recovery actions/i;

export function computePolicySafety(events: PolicySafetyEventInput[]): PolicySafetyStats {
  let allowed = 0;
  let blocked = 0;
  let approvalRequired = 0;
  let stopped = 0;
  let terminalPrevented = 0;

  for (const e of events) {
    switch (e.event) {
      case "ACTION_ALLOWED":
        allowed += 1;
        break;
      case "ACTION_BLOCKED":
        blocked += 1;
        if (e.blockReason && TERMINAL_BLOCK_PATTERN.test(e.blockReason)) {
          terminalPrevented += 1;
        }
        break;
      case "APPROVAL_REQUIRED":
      case "CASE_ESCALATED":
        approvalRequired += 1;
        break;
      case "CASE_STOPPED":
      case "POLICY_LIMIT_STOP":
      case "POLICY_WINDOW_EXPIRED":
        stopped += 1;
        break;
    }
  }

  return { allowed, blocked, approvalRequired, stopped, terminalPrevented };
}

export type BatchSummary = {
  totalCases: number;
  executed: number;
  recovered: number;
  failed: number;
  blocked: number;
  approvalRequired: number;
  stopped: number;
  escalated: number;
  scheduled: number;
  revenueAtRiskPaise: number;
  revenueRecoveredPaise: number;
  recoveryRatePct: number;
};

export function summarizeBatchResults(
  results: {
    status: "executed" | "blocked" | "approval_required";
    caseStatusAfter: string;
    recoveredAmountPaise: number;
    actionType: string;
  }[],
  startingAtRiskPaise = 0
): BatchSummary {
  const summary: BatchSummary = {
    totalCases: results.length,
    executed: 0,
    recovered: 0,
    failed: 0,
    blocked: 0,
    approvalRequired: 0,
    stopped: 0,
    escalated: 0,
    scheduled: 0,
    revenueAtRiskPaise: startingAtRiskPaise,
    revenueRecoveredPaise: 0,
    recoveryRatePct: 0,
  };

  for (const r of results) {
    if (r.status === "blocked") summary.blocked += 1;
    else if (r.status === "approval_required") summary.approvalRequired += 1;
    else {
      summary.executed += 1;
      if (r.actionType === "SCHEDULE_RETRY") summary.scheduled += 1;
    }

    if (r.caseStatusAfter === "RECOVERED") {
      summary.recovered += 1;
      summary.revenueRecoveredPaise += r.recoveredAmountPaise;
    } else if (r.caseStatusAfter === "STOPPED") summary.stopped += 1;
    else if (r.caseStatusAfter === "ESCALATED") summary.escalated += 1;
    else if (r.caseStatusAfter === "FAILED") summary.failed += 1;
  }

  summary.recoveryRatePct = computeRecoveryRate(
    summary.revenueRecoveredPaise,
    summary.revenueAtRiskPaise
  );
  return summary;
}

function policyConfigFrom(policyRow: {
  maxRetries: number;
  maxContactAttempts: number;
  recoveryWindowHours: number;
  approvalThreshold: number;
} | null) {
  if (!policyRow) return DEFAULT_POLICY;
  return {
    maxRetries: policyRow.maxRetries,
    maxContactAttempts: policyRow.maxContactAttempts,
    recoveryWindowHours: policyRow.recoveryWindowHours,
    approvalThresholdPaise: policyRow.approvalThreshold,
  };
}

async function getScenarioRows() {
  const [scenarioGroups, interventionRows] = await Promise.all([
    prisma.recoveryCase.groupBy({
      by: ["scenario"],
      _count: { _all: true },
      _sum: { amountAtRisk: true },
    }),
    prisma.recoveryIntervention.findMany({
      select: {
        result: true,
        action: true,
        recoveredAmount: true,
        recoveryCase: { select: { scenario: true } },
      },
    }),
  ]);

  const escalationsByScenario = new Map<string, number>();
  const failedByScenarioMap = new Map<string, number>();
  const recoveredByScenarioMap = new Map<string, number>();
  for (const iv of interventionRows) {
    const scenario = iv.recoveryCase.scenario as string;
    if (iv.result === "FAILURE") {
      failedByScenarioMap.set(scenario, (failedByScenarioMap.get(scenario) ?? 0) + 1);
    }
    if (iv.action === "ESCALATE_TO_MERCHANT") {
      escalationsByScenario.set(scenario, (escalationsByScenario.get(scenario) ?? 0) + 1);
    }
    if (iv.result === "SUCCESS") {
      recoveredByScenarioMap.set(
        scenario,
        (recoveredByScenarioMap.get(scenario) ?? 0) + iv.recoveredAmount
      );
    }
  }

  return scenarioGroups.map((g) =>
    computeScenarioAnalytics([
      {
        scenario: g.scenario as string,
        cases: g._count._all,
        amountAtRiskPaise: g._sum.amountAtRisk ?? 0,
        recoveredPaise: recoveredByScenarioMap.get(g.scenario as string) ?? 0,
        failedAttempts: failedByScenarioMap.get(g.scenario as string) ?? 0,
        escalations: escalationsByScenario.get(g.scenario as string) ?? 0,
      },
    ])[0]
  );
}

export async function getDashboardData() {
  const now = new Date();

  const [
    caseAgg,
    statusGroups,
    recoveredAgg,
    escalatedCases,
    interventionActionGroups,
    activeCases,
    policyRow,
    aiAggregate,
    aiProviderGroups,
    aiAuditLogs,
    safetyAuditLogs,
    recentRecoveriesRaw,
    topInterventions,
    activityLogs,
  ] = await Promise.all([
    prisma.recoveryCase.aggregate({
      _count: { _all: true },
      _sum: { amountAtRisk: true },
    }),
    prisma.recoveryCase.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.recoveryIntervention.aggregate({
      where: { result: "SUCCESS" },
      _sum: { recoveredAmount: true },
    }),
    prisma.recoveryCase.findMany({
      where: { status: "ESCALATED" },
      select: {
        status: true,
        amountAtRisk: true,
        merchantApproved: true,
        merchantRejectedAt: true,
      },
    }),
    prisma.recoveryIntervention.groupBy({
      by: ["action"],
      where: { action: { not: "STOP_RECOVERY" } },
      _count: { _all: true },
    }),
    prisma.recoveryCase.findMany({
      where: { status: { in: [...ACTIVE_CASE_STATUSES] } },
      select: {
        id: true,
        scenario: true,
        amountAtRisk: true,
        retryCount: true,
        contactCount: true,
        windowExpiresAt: true,
        merchantApproved: true,
        transactionId: true,
        checkoutSessionId: true,
        subscriptionId: true,
      },
    }),
    prisma.recoveryPolicy.findFirst(),
    prisma.aIDecision.aggregate({
      _count: { _all: true },
      _avg: { confidence: true },
    }),
    prisma.aIDecision.groupBy({ by: ["provider"], _count: { _all: true } }),
    prisma.auditLog.findMany({
      where: { event: "AI_ANALYSIS_COMPLETED", actor: "AI" },
      select: { metadata: true, recoveryCaseId: true },
      take: 1000,
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.findMany({
      where: {
        event: {
          in: [
            "ACTION_ALLOWED",
            "ACTION_BLOCKED",
            "APPROVAL_REQUIRED",
            "CASE_ESCALATED",
            "CASE_STOPPED",
            "POLICY_LIMIT_STOP",
            "POLICY_WINDOW_EXPIRED",
          ],
        },
      },
      select: { event: true, metadata: true },
      take: 2000,
      orderBy: { createdAt: "desc" },
    }),
    prisma.recoveryIntervention.findMany({
      where: { result: "SUCCESS", recoveredAmount: { gt: 0 } },
      orderBy: { executedAt: "desc" },
      take: 6,
      include: {
        recoveryCase: {
          include: {
            customer: { select: { name: true } },
            aiDecisions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { confidence: true },
            },
          },
        },
      },
    }),
    prisma.recoveryIntervention.groupBy({
      by: ["recoveryCaseId"],
      where: { result: "SUCCESS" },
      _sum: { recoveredAmount: true },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        recoveryCase: {
          select: { customer: { select: { name: true } }, id: true },
        },
      },
    }),
  ]);

  const countOf = (status: string) =>
    statusGroups.find((g) => g.status === status)?._count._all ?? 0;

  const activeCasesCount =
    countOf("DETECTED") +
    countOf("DIAGNOSED") +
    countOf("IN_PROGRESS") +
    countOf("ESCALATED");

  const recoveredPaise = recoveredAgg._sum.recoveredAmount ?? 0;
  const totalAtRiskPaise = caseAgg._sum.amountAtRisk ?? 0;
  const totalCases = caseAgg._count._all;

  const approvalAttention = computeApprovalAttention(escalatedCases);

  const config = policyConfigFrom(policyRow);
  const progressedCaseIds = new Set<string>();

  const progressInterventions = await prisma.recoveryIntervention.findMany({
    where: { action: { not: "STOP_RECOVERY" } },
    select: { recoveryCaseId: true },
    distinct: ["recoveryCaseId"],
  });
  for (const row of progressInterventions) progressedCaseIds.add(row.recoveryCaseId);

  let currentlyEligible = 0;
  for (const c of activeCases) {
    if (progressedCaseIds.has(c.id)) continue;
    const evaluation = evaluatePolicy(
      {
        scenario: c.scenario,
        amountAtRiskPaise: c.amountAtRisk,
        retryCount: c.retryCount,
        contactCount: c.contactCount,
        windowExpiresAt: c.windowExpiresAt,
        merchantApproved: c.merchantApproved,
        now,
      },
      config
    );
    if (evaluation.eligible) currentlyEligible += 1;
  }
  const eligibleCases = progressedCaseIds.size + currentlyEligible;

  const actionsExecuted = interventionActionGroups.reduce(
    (sum, g) => sum + g._count._all,
    0
  );

  const recoveredCasesCount = countOf("RECOVERED");

  const funnel = computeFunnelStages({
    atRiskPaise: totalAtRiskPaise,
    casesAnalyzed: totalCases,
    casesEligible: eligibleCases,
    actionsExecuted,
    recoveredCases: recoveredCasesCount,
    recoveredPaise,
  });

  const scenarioAnalytics = await getScenarioRows();

  const aiDecisionsForPerf = await prisma.aIDecision.findMany({
    select: {
      recoveryCaseId: true,
      confidence: true,
      recommendedAction: true,
      requiresMerchantAttention: true,
    },
    take: 1000,
    orderBy: { createdAt: "desc" },
  });
  const policyAllowedByCase = new Map<string, boolean>();
  for (const log of aiAuditLogs) {
    const meta = log.metadata as { policyAllowed?: boolean };
    if (meta && typeof meta.policyAllowed === "boolean") {
      if (!policyAllowedByCase.has(log.recoveryCaseId)) {
        policyAllowedByCase.set(log.recoveryCaseId, meta.policyAllowed);
      }
    }
  }
  const aiPerformance = computeAiPerformance(
    aiDecisionsForPerf.map((d) => ({
      confidence: d.confidence,
      policyAllowed: policyAllowedByCase.get(d.recoveryCaseId),
      recommendedAction: d.recommendedAction,
      requiresMerchantAttention: d.requiresMerchantAttention,
    }))
  );

  const providerBreakdown = aiProviderGroups.map((g) => ({
    provider: g.provider,
    count: g._count._all,
  }));

  const policySafety = computePolicySafety(
    safetyAuditLogs.map((log) => ({
      event: log.event,
      blockReason:
        (log.metadata as { reason?: string } | null)?.reason ?? undefined,
    }))
  );

  const recentRecoveries = recentRecoveriesRaw.map((iv) => ({
    id: iv.id,
    customerName: iv.recoveryCase.customer.name,
    caseId: iv.recoveryCase.id,
    scenario: iv.recoveryCase.scenario as ScenarioType,
    amountAtRiskPaise: iv.recoveryCase.amountAtRisk,
    action: iv.action,
    recoveredPaise: iv.recoveredAmount,
    confidence: iv.recoveryCase.aiDecisions[0]?.confidence ?? null,
    status: iv.recoveryCase.status,
    executedAt: iv.executedAt ?? iv.createdAt,
  }));

  const caseIds = topInterventions.map((t) => t.recoveryCaseId);
  const topCases = await prisma.recoveryCase.findMany({
    where: { id: { in: caseIds.length ? caseIds : ["none"] } },
    include: { customer: { select: { name: true } } },
  });
  const perCustomer = new Map<
    string,
    { name: string; cases: number; atRiskPaise: number; recoveredPaise: number }
  >();
  for (const t of topInterventions) {
    const kase = topCases.find((c) => c.id === t.recoveryCaseId);
    if (!kase) continue;
    const entry = perCustomer.get(kase.customerId) ?? {
      name: kase.customer.name,
      cases: 0,
      atRiskPaise: 0,
      recoveredPaise: 0,
    };
    entry.cases += 1;
    entry.atRiskPaise += kase.amountAtRisk;
    entry.recoveredPaise += t._sum.recoveredAmount ?? 0;
    perCustomer.set(kase.customerId, entry);
  }
  const topCustomers = [...perCustomer.entries()]
    .map(([customerId, v]) => ({
      customerId,
      ...v,
      recoveryRatePct: computeRecoveryRate(v.recoveredPaise, v.atRiskPaise),
    }))
    .sort((a, b) => b.recoveredPaise - a.recoveredPaise)
    .slice(0, 5);

  const activity = activityLogs.map((log) => ({
    id: log.id,
    event: log.event,
    actor: log.actor,
    customerName: log.recoveryCase?.customer?.name ?? "Unknown",
    caseId: log.recoveryCaseId,
    createdAt: log.createdAt,
  }));

  return {
    hero: {
      totalAtRiskPaise,
      recoveredPaise,
      recoveryRatePct: computeRecoveryRate(recoveredPaise, totalAtRiskPaise),
      activeCases: activeCasesCount,
      recoveredCases: recoveredCasesCount,
      escalatedCases: countOf("ESCALATED"),
      stoppedCases: countOf("STOPPED"),
      awaitingApprovalPaise: approvalAttention.amountPaise,
      awaitingApprovalCases: approvalAttention.cases,
      totalCases,
    },
    approvalAttention,
    funnel,
    scenarioAnalytics,
    aiPerformance: {
      ...aiPerformance,
      avgConfidencePct:
        aiAggregate._avg.confidence != null
          ? Math.round(aiAggregate._avg.confidence * 100)
          : aiPerformance.avgConfidencePct,
      providers: providerBreakdown,
    },
    policySafety,
    recentRecoveries,
    topCustomers,
    activity,
    beforeAfter: {
      beforeAtRiskPaise: totalAtRiskPaise - recoveredPaise,
      beforeUnrecoveredCases: Math.max(
        0,
        totalCases - recoveredCasesCount
      ),
      afterRecoveredPaise: recoveredPaise,
      afterRatePct: computeRecoveryRate(recoveredPaise, totalAtRiskPaise),
      afterAutoRecoveredCases: recoveredCasesCount,
    },
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
