import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { StatusBadge } from "@/components/status-badge";
import { CaseActions } from "@/components/case-actions";
import { AnalyzeCaseButton } from "@/components/analyze-case-button";
import { ApprovalActions } from "@/components/approval-actions";
import { formatINR, timeAgo } from "@/lib/domain/format";
import { evaluatePolicy } from "@/lib/policy/engine";
import { policyConfigFromCase } from "@/lib/recovery/orchestrator";
import type { CaseWithRelations } from "@/lib/recovery/store";

export const dynamic = "force-dynamic";

const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Payment failed",
  CHECKOUT_ABANDONMENT: "Checkout abandoned",
  SUBSCRIPTION_FAILURE: "Subscription payment failed",
};

function humanize(value: string) {
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function windowStatusLabel(expiresAt: Date): string {
  const nowMs = Date.now();
  if (nowMs > expiresAt.getTime()) {
    return `expired (${Math.abs(Math.floor((nowMs - expiresAt.getTime()) / 3_600_000))}h ago)`;
  }
  return `expires ${timeAgo(expiresAt).replace(" ago", "")}`;
}

function scheduledDueMinutes(interventions: { scheduledAt: Date | null }[]): number {
  const nowMs = Date.now();
  let min = -1;
  for (const iv of interventions) {
    if (!iv.scheduledAt) continue;
    const mins = Math.max(0, Math.round((iv.scheduledAt.getTime() - nowMs) / 60_000));
    min = min === -1 ? mins : Math.min(min, mins);
  }
  return min;
}

function SectionHeading({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
        {step}
      </span>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const baseCase = await prisma.recoveryCase.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      merchant: {
        select: {
          id: true,
          name: true,
          policy: {
            select: {
              maxRetries: true,
              maxContactAttempts: true,
              recoveryWindowHours: true,
              approvalThreshold: true,
            },
          },
        },
      },
    },
  });

  if (!baseCase) notFound();
  const recoveryCase = baseCase as CaseWithRelations;

  const [interventions, auditLogs, latestDecision, capturedAgg, failedCount] =
    await Promise.all([
      prisma.recoveryIntervention.findMany({
        where: { recoveryCaseId: id },
        orderBy: { createdAt: "asc" },
      }),
      prisma.auditLog.findMany({
        where: { recoveryCaseId: id },
        orderBy: { createdAt: "asc" },
      }),
      prisma.aIDecision.findFirst({
        where: { recoveryCaseId: id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.transaction.aggregate({
        where: { customerId: recoveryCase.customerId, status: "CAPTURED" },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.transaction.count({
        where: { customerId: recoveryCase.customerId, status: "FAILED" },
      }),
    ]);

  const [sourceEvent, activeSubs, pastDueSubs] = await Promise.all([
    (async (): Promise<{
      failureReason?: string;
      cartSummary?: string;
      planName?: string;
    }> => {
      if (recoveryCase.transactionId) {
        const r = await prisma.transaction.findUnique({
          where: { id: recoveryCase.transactionId },
          select: { failureReason: true },
        });
        return { failureReason: r?.failureReason ?? undefined };
      }
      if (recoveryCase.checkoutSessionId) {
        const r = await prisma.checkoutSession.findUnique({
          where: { id: recoveryCase.checkoutSessionId },
          select: { cartSummary: true },
        });
        return { cartSummary: r?.cartSummary ?? undefined };
      }
      if (recoveryCase.subscriptionId) {
        const r = await prisma.subscription.findUnique({
          where: { id: recoveryCase.subscriptionId },
          select: { planName: true },
        });
        return { planName: r?.planName ?? undefined };
      }
      return {};
    })(),
    prisma.subscription.count({
      where: { customerId: recoveryCase.customerId, status: "ACTIVE" },
    }),
    prisma.subscription.count({
      where: { customerId: recoveryCase.customerId, status: "PAST_DUE" },
    }),
  ]);

  const config = policyConfigFromCase(recoveryCase);
  const evaluation = evaluatePolicy(
    {
      scenario: recoveryCase.scenario,
      amountAtRiskPaise: recoveryCase.amountAtRisk,
      retryCount: recoveryCase.retryCount,
      contactCount: recoveryCase.contactCount,
      windowExpiresAt: recoveryCase.windowExpiresAt,
      merchantApproved: recoveryCase.merchantApproved,
    },
    config
  );

  const allowedActions = evaluation.allowedActions.filter(
    (a) =>
      (a !== "STOP_RECOVERY" || evaluation.allowedActions.length === 1) &&
      !(a === "ESCALATE_TO_MERCHANT" && recoveryCase.status === "ESCALATED")
  );
  const blocked = evaluation.permissions
    .filter(
      (p) =>
        !p.allowed &&
        p.action !== "STOP_RECOVERY" &&
        !p.reason.startsWith("Not applicable")
    )
    .map((p) => ({ action: p.action, reason: p.reason }));

  const totalRecovered = interventions.reduce(
    (sum, iv) => sum + iv.recoveredAmount,
    0
  );

  const lastExecuted = [...interventions]
    .reverse()
    .find((iv) => iv.executedAt != null);

  const dueMinutes = scheduledDueMinutes(interventions);

  const awaitingApproval =
    recoveryCase.status === "ESCALATED" &&
    !recoveryCase.merchantApproved &&
    !recoveryCase.merchantRejectedAt;

  const progressStages = [
    {
      label: "AI Analyzed",
      done: latestDecision != null,
    },
    {
      label: "Approval Required",
      done: awaitingApproval || recoveryCase.merchantApproved,
    },
    {
      label: recoveryCase.merchantRejectedAt ? "Rejected" : "Merchant Approved",
      done: recoveryCase.merchantApproved || !!recoveryCase.merchantRejectedAt,
      tone: recoveryCase.merchantRejectedAt ? ("failed" as const) : undefined,
    },
    {
      label: "Ready to Execute",
      done:
        recoveryCase.merchantApproved &&
        evaluation.eligible,
    },
    {
      label: "Executed",
      done: interventions.some((iv) => iv.executedAt != null),
    },
    {
      label:
        ["RECOVERED", "FAILED", "STOPPED", "REJECTED"].includes(recoveryCase.status)
          ? humanize(recoveryCase.status)
          : "Outcome",
      done: ["RECOVERED", "FAILED", "STOPPED", "REJECTED"].includes(
        recoveryCase.status
      ),
      tone: (["FAILED", "STOPPED", "REJECTED"].includes(recoveryCase.status)
        ? "failed"
        : "success") as "failed" | "success",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/cases" className="text-sm text-emerald-700 hover:text-emerald-800">
          ← Back to cases
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            Recovery Case{" "}
            <span className="font-mono text-base text-slate-500">
              …{recoveryCase.id.slice(-8)}
            </span>
          </h1>
          <StatusBadge value={recoveryCase.status} />
          <StatusBadge value={recoveryCase.priority} />
        </div>
      </div>

      {(awaitingApproval || recoveryCase.merchantApproved || recoveryCase.merchantRejectedAt) && (
        <section
          className={`rounded-xl border-2 p-5 shadow-sm ${
            recoveryCase.merchantRejectedAt
              ? "border-rose-300 bg-rose-50"
              : recoveryCase.merchantApproved
                ? "border-emerald-300 bg-emerald-50"
                : "border-amber-300 bg-amber-50"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p
                className={`text-sm font-bold tracking-wide uppercase ${
                  recoveryCase.merchantRejectedAt
                    ? "text-rose-800"
                    : recoveryCase.merchantApproved
                      ? "text-emerald-800"
                      : "text-amber-800"
                }`}
              >
                {recoveryCase.merchantRejectedAt
                  ? "Recovery Rejected By Merchant"
                  : recoveryCase.merchantApproved
                    ? "Merchant Approved · Ready to Execute"
                    : "Merchant Approval Required"}
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatINR(recoveryCase.amountAtRisk)}{" "}
                <span className="text-sm font-normal text-slate-500">at risk</span>
              </p>
              <p className="text-xs text-slate-500">
                Approval threshold: {formatINR(config.approvalThresholdPaise)} · this
                case exceeds it, so money-moving actions wait for your decision.
              </p>
            </div>
            <div className="min-w-[260px] flex-1 rounded-lg bg-white p-3 shadow-sm">
              {latestDecision ? (
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Recommended action</dt>
                    <dd className="font-mono font-semibold text-slate-900">
                      {latestDecision.recommendedAction}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Confidence</dt>
                    <dd className="font-semibold text-slate-900">
                      {Math.round(latestDecision.confidence * 100)}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Diagnosis</dt>
                    <dd className="font-mono text-xs text-slate-700">
                      {latestDecision.diagnosis}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Reason</dt>
                    <dd className="text-xs text-slate-600">{latestDecision.reasoning}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-slate-500">
                  Run an AI analysis to see the recommendation before approving.
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 border-t border-slate-200 pt-4">
            <ApprovalActions
              caseId={recoveryCase.id}
              requiresApproval={awaitingApproval}
              approved={recoveryCase.merchantApproved}
              approvedAt={recoveryCase.merchantApprovedAt?.toISOString() ?? null}
              rejected={!!recoveryCase.merchantRejectedAt}
              rejectionReason={recoveryCase.rejectionReason}
            />
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
          {progressStages.map((stage, i) => (
            <li key={stage.label} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="text-slate-300">→</span>}
              <span
                className={`rounded-full px-2.5 py-1 font-medium ${
                  stage.done
                    ? stage.tone === "failed"
                      ? "bg-rose-600 text-white"
                      : stage.tone === "success"
                        ? "bg-emerald-600 text-white"
                        : "bg-emerald-100 text-emerald-800"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {stage.label}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionHeading step={1} title="Problem" />
            <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <p className="text-base font-medium text-slate-800">
                {SCENARIO_LABELS[recoveryCase.scenario]}
              </p>
              <p className="text-2xl font-bold text-rose-700">
                {formatINR(recoveryCase.amountAtRisk)}
                <span className="ml-2 text-xs font-normal text-slate-400">at risk</span>
              </p>
              {sourceEvent?.failureReason && (
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                  {sourceEvent.failureReason}
                </span>
              )}
              {sourceEvent?.cartSummary && (
                <span className="text-sm text-slate-500">{sourceEvent.cartSummary}</span>
              )}
              {sourceEvent?.planName && (
                <span className="text-sm text-slate-500">{sourceEvent.planName}</span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionHeading step={2} title="Context" />
            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-400">Customer</dt>
                <dd className="font-medium text-slate-900">{recoveryCase.customer.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Successful payments</dt>
                <dd className="font-medium text-emerald-700">
                  {capturedAgg._count._all} ({formatINR(capturedAgg._sum.amount ?? 0)})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Failed payments</dt>
                <dd className="font-medium text-rose-700">{failedCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Subscriptions</dt>
                <dd className="font-medium text-slate-900">
                  {activeSubs} active · {pastDueSubs} past due
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Previous attempts</dt>
                <dd className="font-medium text-slate-900">
                  {recoveryCase.retryCount} retries · {recoveryCase.contactCount} contacts
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Recovery window</dt>
                <dd className={`font-medium ${evaluation.windowExpired ? "text-rose-700" : "text-slate-900"}`}>
                  {evaluation.windowExpired
                    ? windowStatusLabel(recoveryCase.windowExpiresAt)
                    : `${evaluation.retriesRemaining} retries left · ${windowStatusLabel(recoveryCase.windowExpiresAt)}`}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-violet-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionHeading step={3} title="AI Reasoning" />
              {latestDecision && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    latestDecision.provider.includes("mock")
                      ? "bg-amber-100 text-amber-700"
                      : "bg-violet-100 text-violet-700"
                  }`}
                >
                  {latestDecision.provider.includes("mock")
                    ? "Demo / Mock AI Mode"
                    : `${latestDecision.provider} · ${latestDecision.model}`}
                </span>
              )}
            </div>
            {latestDecision ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-400">Diagnosis</dt>
                  <dd className="font-mono text-xs font-semibold text-slate-900">
                    {latestDecision.diagnosis}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Risk</dt>
                  <dd><StatusBadge value={latestDecision.riskLevel} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Recommendation</dt>
                  <dd className="font-semibold text-emerald-700">
                    {humanize(latestDecision.recommendedAction)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Confidence</dt>
                  <dd className="font-semibold text-slate-900">
                    {Math.round(latestDecision.confidence * 100)}%
                  </dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="text-xs text-slate-400">Reasoning</dt>
                  <dd className="mt-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                    {latestDecision.reasoning}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
                No AI analysis yet for this case.
                <AnalyzeCaseButton caseId={recoveryCase.id} />
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionHeading step={4} title="Policy Decision" />
            <p
              className={`mt-3 rounded-lg p-3 text-sm ${
                evaluation.eligible
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-rose-50 text-rose-800"
              }`}
            >
              {evaluation.summaryReason}
            </p>
            <div className="mt-4">
              <CaseActions
                caseId={recoveryCase.id}
                eligible={evaluation.eligible}
                allowedActions={allowedActions}
                blocked={blocked}
                requiresApproval={evaluation.requiresApproval}
                merchantApproved={recoveryCase.merchantApproved}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionHeading step={5} title="Action & Result" />
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-400">Last action executed</p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {lastExecuted
                    ? `${humanize(lastExecuted.action)} · ${lastExecuted.result?.replace(/_/g, " ") ?? "pending"}`
                    : "No actions executed yet"}
                </p>
                {lastExecuted?.notes && (
                  <p className="mt-0.5 text-xs text-slate-400">{lastExecuted.notes}</p>
                )}
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-400">Result</p>
                <p
                  className={`mt-1 text-lg font-bold ${
                    totalRecovered > 0 ? "text-emerald-700" : "text-slate-700"
                  }`}
                >
                  {recoveryCase.status === "RECOVERED"
                    ? `Recovered ${formatINR(totalRecovered)}`
                    : totalRecovered > 0
                      ? `Partially recovered ${formatINR(totalRecovered)}`
                      : humanize(recoveryCase.status)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <SectionHeading step={6} title="Audit Trail" />
            </div>
            <ol className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-800">{log.event}</p>
                    <p className="truncate text-xs text-slate-400">
                      {log.actor.replace(/_/g, " ")} · {timeAgo(log.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
              {auditLogs.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-slate-400">
                  No audit entries yet.
                </li>
              )}
            </ol>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Amount at Risk</p>
              <p className="mt-1 text-lg font-semibold text-rose-700">
                {formatINR(recoveryCase.amountAtRisk)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Recovered</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">
                {formatINR(totalRecovered)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Recovery Policy (deterministic)
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Max retries</dt>
                <dd className="font-medium">
                  {config.maxRetries} ({evaluation.retriesRemaining} left)
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Max contacts</dt>
                <dd className="font-medium">
                  {config.maxContactAttempts} ({evaluation.contactsRemaining} left)
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Window</dt>
                <dd className="font-medium">{config.recoveryWindowHours}h</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Approval threshold</dt>
                <dd className="font-medium">{formatINR(config.approvalThresholdPaise)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Merchant approved</dt>
                <dd className="font-medium">
                  {recoveryCase.merchantApproved ? "Yes" : "No"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900">
              Intervention History
            </h2>
            <ul className="divide-y divide-slate-100">
              {interventions.map((iv) => (
                <li key={iv.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {humanize(iv.action)}
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {iv.status.toLowerCase()}
                        </span>
                      </p>
                      <p className="text-xs text-slate-400">{iv.notes}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-slate-600">
                        {iv.result?.replace(/_/g, " ") ?? "PENDING"}
                      </p>
                      {iv.recoveredAmount > 0 && (
                        <p className="text-xs font-semibold text-emerald-700">
                          +{formatINR(iv.recoveredAmount)}
                        </p>
                      )}
                      <p className="text-xs text-slate-400">
                        {iv.executedAt
                          ? timeAgo(iv.executedAt)
                          : iv.scheduledAt && dueMinutes >= 0
                            ? `due in ${dueMinutes}m`
                            : ""}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
              {interventions.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-slate-400">
                  No interventions yet.
                </li>
              )}
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}
