import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  Brain,
  CheckCircle2,
  CircleDot,
  Clock,
  CreditCard,
  FileText,
  Scale,
  User,
  XCircle,
} from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { StatusBadge } from "@/components/status-badge";
import { CaseActions } from "@/components/case-actions";
import { AnalyzeCaseButton } from "@/components/analyze-case-button";
import { ApprovalActions } from "@/components/approval-actions";
import { CheckPaymentButton, PaymentStatusPoller } from "@/components/payment-status-sync";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatINR, timeAgo } from "@/lib/domain/format";
import {
  actionLabel,
  eventLabel,
  interventionResultLabel,
  scenarioLabel,
  shortId,
  statusLabel,
} from "@/lib/domain/present";
import { evaluatePolicy } from "@/lib/policy/engine";
import { policyConfigFromCase } from "@/lib/recovery/orchestrator";
import type { CaseWithRelations } from "@/lib/recovery/store";

export const dynamic = "force-dynamic";

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

type TimelineState = "done" | "current" | "waiting" | "attention" | "blocked";

function TimelineDot({ state }: { state: TimelineState }) {
  const styles: Record<TimelineState, string> = {
    done: "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
    current: "border-[#5B7CFF]/50 bg-[#5B7CFF]/15 text-[#9DB1FF]",
    waiting: "border-white/10 bg-white/[0.04] text-[#6F7A89]",
    attention: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    blocked: "border-red-400/40 bg-red-400/10 text-red-300",
  };
  const Icon =
    state === "done"
      ? CheckCircle2
      : state === "blocked"
        ? XCircle
        : state === "attention"
          ? Bell
          : CircleDot;
  return (
    <span className={`circle flex h-7 w-7 shrink-0 items-center justify-center border ${styles[state]}`}>
      <Icon className="h-3.5 w-3.5" />
    </span>
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

  const pendingPaymentLink = [...interventions]
    .reverse()
    .find(
      (iv) =>
        iv.provider === "razorpay" &&
        iv.status === "AWAITING_PAYMENT" &&
        iv.paymentLinkUrl
    );

  const dueMinutes = scheduledDueMinutes(interventions);

  const awaitingApproval =
    recoveryCase.status === "ESCALATED" &&
    !recoveryCase.merchantApproved &&
    !recoveryCase.merchantRejectedAt;

  const approvalNeeded =
    recoveryCase.amountAtRisk >= config.approvalThresholdPaise;
  const isTerminal = ["RECOVERED", "FAILED", "STOPPED", "REJECTED"].includes(
    recoveryCase.status
  );
  const policyAudit = auditLogs.find((l) =>
    ["CASE_ANALYZED", "POLICY_EVALUATION_ALLOWED", "ACTION_ALLOWED", "ACTION_BLOCKED", "APPROVAL_REQUIRED"].includes(l.event)
  );

  const timeline: {
    icon: typeof Brain;
    title: string;
    body: string;
    time?: string;
    state: TimelineState;
  }[] = [
    {
      icon: FileText,
      title: "Detected",
      body: `${scenarioLabel(recoveryCase.scenario)} · ${formatINR(recoveryCase.amountAtRisk)} at risk`,
      time: timeAgo(recoveryCase.createdAt),
      state: "done",
    },
    {
      icon: Brain,
      title: "AI Diagnosis",
      body: latestDecision
        ? `${latestDecision.diagnosis} → ${actionLabel(latestDecision.recommendedAction)} · ${Math.round(latestDecision.confidence * 100)}% confidence`
        : "No AI analysis yet — run Analyze with AI below.",
      time: latestDecision ? timeAgo(latestDecision.createdAt) : undefined,
      state: latestDecision ? "done" : "current",
    },
    {
      icon: Scale,
      title: "Policy Decision",
      body: evaluation.summaryReason,
      time: policyAudit ? timeAgo(policyAudit.createdAt) : undefined,
      state:
        interventions.length > 0 || policyAudit
          ? evaluation.eligible
            ? "done"
            : "blocked"
          : "waiting",
    },
    {
      icon: User,
      title: "Merchant Approval",
      body: !approvalNeeded
        ? `Below the ${formatINR(config.approvalThresholdPaise)} threshold — no approval needed.`
        : recoveryCase.merchantApproved
          ? "Approved — execution unlocked."
          : recoveryCase.merchantRejectedAt
            ? `Rejected${recoveryCase.rejectionReason ? ` — ${recoveryCase.rejectionReason}` : ""}.`
            : "Waiting for merchant decision.",
      time:
        recoveryCase.merchantApprovedAt
          ? timeAgo(recoveryCase.merchantApprovedAt)
          : recoveryCase.merchantRejectedAt
            ? timeAgo(recoveryCase.merchantRejectedAt)
            : undefined,
      state: !approvalNeeded
        ? "done"
        : recoveryCase.merchantApproved
          ? "done"
          : recoveryCase.merchantRejectedAt
            ? "blocked"
            : "attention",
    },
    {
      icon: CreditCard,
      title: "Recovery Action",
      body: lastExecuted
        ? `${actionLabel(lastExecuted.action)} · ${interventionResultLabel(lastExecuted)}`
        : allowedActions.length > 0
          ? `Ready: ${allowedActions.map(actionLabel).join(", ")}.`
          : "No executable action right now.",
      time: lastExecuted?.executedAt ? timeAgo(lastExecuted.executedAt) : undefined,
      state: lastExecuted
        ? lastExecuted.result === "SUCCESS"
          ? "done"
          : "current"
        : allowedActions.length > 0
          ? "current"
          : "waiting",
    },
    {
      icon: BadgeCheck,
      title: "Result",
      body:
        recoveryCase.status === "RECOVERED"
          ? `Recovered ${formatINR(totalRecovered)}.`
          : totalRecovered > 0
            ? `Partially recovered ${formatINR(totalRecovered)} · ${statusLabel(recoveryCase.status)}.`
            : statusLabel(recoveryCase.status),
      time: recoveryCase.resolvedAt ? timeAgo(recoveryCase.resolvedAt) : undefined,
      state: recoveryCase.status === "RECOVERED"
        ? "done"
        : isTerminal
          ? "blocked"
          : pendingPaymentLink
            ? "current"
            : "waiting",
    },
  ];

  const approvalTone = recoveryCase.merchantRejectedAt
    ? "border-red-400/30 bg-black"
    : recoveryCase.merchantApproved
      ? "border-emerald-400/30 bg-black"
      : "border-amber-400/30 bg-black";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/cases"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#9DB1FF] hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to cases
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-[#F7F9FC]">
                {recoveryCase.customer.name}
              </h1>
              <StatusBadge value={recoveryCase.scenario === "FAILED_PAYMENT" ? recoveryCase.status : recoveryCase.status} dot />
              <StatusBadge value={recoveryCase.priority} />
            </div>
            <p className="mt-1.5 text-sm text-[#A3ADBD]">
              {scenarioLabel(recoveryCase.scenario)} ·{" "}
              <span className="font-semibold text-[#F7F9FC]">{formatINR(recoveryCase.amountAtRisk)}</span>{" "}
              at risk · <span className="font-mono text-[12px] text-[#6F7A89]">{shortId(recoveryCase.id)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 border border-[#1A1A1A] bg-black px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[#6F7A89] uppercase">Recovered</p>
              <p className="text-xl font-semibold text-emerald-300 tabular-nums">{formatINR(totalRecovered)}</p>
            </div>
            <div className="ml-3 border-l border-white/[0.08] pl-3">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[#6F7A89] uppercase">Window</p>
              <p className={`flex items-center gap-1 text-[13px] font-medium ${evaluation.windowExpired ? "text-red-300" : "text-[#F7F9FC]"}`}>
                <Clock className="h-3.5 w-3.5" />{windowStatusLabel(recoveryCase.windowExpiresAt)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {(awaitingApproval || recoveryCase.merchantApproved || recoveryCase.merchantRejectedAt) && (
        <section className={`border p-5 ${approvalTone}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className={`text-[12px] font-bold tracking-[0.08em] uppercase ${recoveryCase.merchantRejectedAt ? "text-red-300" : recoveryCase.merchantApproved ? "text-emerald-300" : "text-amber-300"}`}>
                {recoveryCase.merchantRejectedAt
                  ? "Recovery rejected by merchant"
                  : recoveryCase.merchantApproved
                    ? "Merchant approved · ready to execute"
                    : "Merchant approval required"}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-[#F7F9FC] tabular-nums">
                {formatINR(recoveryCase.amountAtRisk)}{" "}
                <span className="text-sm font-normal text-[#A3ADBD]">at risk</span>
              </p>
              <p className="mt-1 text-[12.5px] text-[#A3ADBD]">
                Approval threshold: {formatINR(config.approvalThresholdPaise)} · money-moving
                actions wait for your decision.
              </p>
            </div>
            <div className="min-w-[260px] flex-1 border border-[#1A1A1A] bg-black p-3.5">
              {latestDecision ? (
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#6F7A89]">Recommended</dt>
                    <dd className="font-semibold text-[#F7F9FC]">{actionLabel(latestDecision.recommendedAction)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#6F7A89]">Confidence</dt>
                    <dd className="font-semibold text-[#F7F9FC] tabular-nums">{Math.round(latestDecision.confidence * 100)}%</dd>
                  </div>
                  <div>
                    <dt className="text-[#6F7A89]">Diagnosis</dt>
                    <dd className="font-mono text-xs text-[#A3ADBD]">{latestDecision.diagnosis}</dd>
                  </div>
                  <div>
                    <dt className="text-[#6F7A89]">Reason</dt>
                    <dd className="text-xs leading-relaxed text-[#A3ADBD]">{latestDecision.reasoning}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-[#A3ADBD]">
                  Run an AI analysis to see the recommendation before approving.
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 border-t border-white/[0.08] pt-4">
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

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Timeline */}
        <Card className="xl:col-span-2">
          <CardHeader title="Recovery timeline" subtitle="Each stage derives from live case, AI, policy, and intervention state." />
          <CardBody>
            <ol className="relative space-y-0">
              {timeline.map((s, i) => (
                <li key={s.title} className="relative flex gap-3.5 pb-6 last:pb-0">
                  {i < timeline.length - 1 && (
                    <span aria-hidden className="absolute top-8 left-[13px] h-[calc(100%-28px)] w-px bg-[#1A1A1A]" />
                  )}
                  <TimelineDot state={s.state} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="flex items-center gap-2 text-[13.5px] font-semibold text-[#F7F9FC]">
                        <s.icon className="h-3.5 w-3.5 text-[#6F7A89]" />
                        {s.title}
                      </p>
                      {s.time && <span className="text-[11.5px] text-[#6F7A89]">{s.time}</span>}
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[#A3ADBD]">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        {/* Summary */}
        <aside className="space-y-4">
          <Card>
            <CardHeader title="Case summary" />
            <CardBody className="pt-4">
              <dl className="space-y-2.5 text-[13px]">
                {[
                  ["Amount at risk", formatINR(recoveryCase.amountAtRisk)],
                  ["Customer", recoveryCase.customer.name],
                  ["Scenario", scenarioLabel(recoveryCase.scenario)],
                  ["Retries", `${recoveryCase.retryCount} used · ${evaluation.retriesRemaining} left`],
                  ["Contacts", `${recoveryCase.contactCount} used · ${evaluation.contactsRemaining} left`],
                  ["AI risk", latestDecision ? latestDecision.riskLevel.charAt(0) + latestDecision.riskLevel.slice(1).toLowerCase() : "Not analyzed"],
                  ["Approval", !approvalNeeded ? "Not required" : recoveryCase.merchantApproved ? "Approved" : recoveryCase.merchantRejectedAt ? "Rejected" : "Required"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[#6F7A89]">{k}</dt>
                    <dd className="text-right font-medium text-[#F7F9FC]">{v}</dd>
                  </div>
                ))}
                {(sourceEvent.failureReason || sourceEvent.cartSummary || sourceEvent.planName) && (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-[#6F7A89]">Source</dt>
                    <dd className="text-right font-mono text-[12px] text-[#A3ADBD]">
                      {sourceEvent.failureReason ?? sourceEvent.cartSummary ?? sourceEvent.planName}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[#6F7A89]">History</dt>
                  <dd className="text-right font-medium text-[#F7F9FC] tabular-nums">
                    {capturedAgg._count._all} paid ({formatINR(capturedAgg._sum.amount ?? 0)}) · {failedCount} failed
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[#6F7A89]">Subscriptions</dt>
                  <dd className="text-right font-medium text-[#F7F9FC] tabular-nums">{activeSubs} active · {pastDueSubs} past due</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Take action" subtitle="Existing controls — policy enforced server-side." />
            <CardBody className="space-y-4 pt-4">
              {!latestDecision && (
                <div className="border border-[#1A1A1A] bg-black p-3 text-[13px] text-[#A3ADBD]">
                  <p className="mb-2">No AI analysis yet for this case.</p>
                  <AnalyzeCaseButton caseId={recoveryCase.id} />
                </div>
              )}
              <div className={`border p-3 text-[13px] leading-relaxed ${evaluation.eligible ? "border-emerald-400/30 bg-black text-emerald-200" : "border-red-400/30 bg-black text-red-200"}`}>
                {evaluation.summaryReason}
              </div>
              <CaseActions
                caseId={recoveryCase.id}
                eligible={evaluation.eligible}
                allowedActions={allowedActions}
                blocked={blocked}
                requiresApproval={evaluation.requiresApproval}
                merchantApproved={recoveryCase.merchantApproved}
                paymentPending={
                  pendingPaymentLink
                    ? {
                        id: pendingPaymentLink.providerReference,
                        url: pendingPaymentLink.paymentLinkUrl,
                      }
                    : null
                }
              />
              {pendingPaymentLink && recoveryCase.status === "IN_PROGRESS" && (
                <div className="border border-emerald-400/25 bg-black p-4">
                  <p className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.06em] text-emerald-300 uppercase">
                    <span className="pulse-dot circle h-1.5 w-1.5 bg-emerald-400" />
                    Awaiting customer payment
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-emerald-100/90">
                    Razorpay Test Mode link for {formatINR(recoveryCase.amountAtRisk)}. The case
                    becomes Recovered automatically once paid.
                  </p>
                  <p className="mt-1 text-[12px] text-[#6F7A89]">
                    Payment status: waiting for confirmation.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                      href={pendingPaymentLink.paymentLinkUrl!}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 bg-[#5B7CFF] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#4A6DF5]"
                    >
                      Open Payment Link <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                    <CheckPaymentButton caseId={recoveryCase.id} />
                  </div>
                  <PaymentStatusPoller caseId={recoveryCase.id} />
                </div>
              )}
            </CardBody>
          </Card>
        </aside>
      </section>

      {/* Interventions + audit */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Interventions" subtitle={`${interventions.length} recorded`} />
          <CardBody className="pt-2">
            {interventions.length === 0 ? (
              <EmptyState title="No interventions yet" body="Executed and scheduled recovery actions will appear here." />
            ) : (
              <ul className="divide-y divide-[#171717]">
                {interventions.map((iv) => (
                  <li key={iv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-[#F7F9FC]">
                        {actionLabel(iv.action)}
                        <StatusBadge value={iv.status} />
                      </p>
                      {iv.notes && <p className="mt-0.5 truncate text-[12px] text-[#6F7A89]">{iv.notes}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-[12px] font-medium text-[#A3ADBD]">{interventionResultLabel(iv)}</p>
                      {iv.recoveredAmount > 0 && (
                        <p className="text-[12px] font-semibold text-emerald-300 tabular-nums">+{formatINR(iv.recoveredAmount)}</p>
                      )}
                      <p className="text-[11.5px] text-[#6F7A89]">
                        {iv.executedAt ? timeAgo(iv.executedAt) : iv.scheduledAt && dueMinutes >= 0 ? `due in ${dueMinutes}m` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Audit trail" subtitle={`${auditLogs.length} events`} />
          <CardBody className="pt-2">
            {auditLogs.length === 0 ? (
              <EmptyState title="No audit entries yet" body="Every action on this case is recorded here." />
            ) : (
              <ol className="max-h-[380px] space-y-0 overflow-y-auto pr-1">
                {auditLogs.map((log) => (
                  <li key={log.id} className="relative flex gap-3 pb-4 last:pb-0">
                    <span aria-hidden className="circle mt-1.5 h-1.5 w-1.5 shrink-0 bg-[#5B7CFF]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-[#F7F9FC]">{eventLabel(log.event)}</p>
                      <p className="text-[11.5px] text-[#6F7A89]">
                        {log.actor.charAt(0) + log.actor.slice(1).toLowerCase().replace("_", " ")} · {timeAgo(log.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </section>

      <details className="border border-[#1A1A1A] bg-black px-5 py-4">
        <summary className="cursor-pointer text-[13px] font-semibold text-[#A3ADBD] hover:text-white">
          Technical details
        </summary>
        <dl className="mt-3 grid grid-cols-1 gap-2 font-mono text-[11.5px] text-[#6F7A89] sm:grid-cols-2">
          <div><dt className="uppercase tracking-wide">Case ID</dt><dd className="break-all text-[#A3ADBD]">{recoveryCase.id}</dd></div>
          {recoveryCase.transactionId && <div><dt className="uppercase tracking-wide">Transaction ID</dt><dd className="break-all text-[#A3ADBD]">{recoveryCase.transactionId}</dd></div>}
          {recoveryCase.checkoutSessionId && <div><dt className="uppercase tracking-wide">Checkout session</dt><dd className="break-all text-[#A3ADBD]">{recoveryCase.checkoutSessionId}</dd></div>}
          {recoveryCase.subscriptionId && <div><dt className="uppercase tracking-wide">Subscription</dt><dd className="break-all text-[#A3ADBD]">{recoveryCase.subscriptionId}</dd></div>}
          {pendingPaymentLink?.providerReference && <div><dt className="uppercase tracking-wide">Provider reference</dt><dd className="break-all text-[#A3ADBD]">{pendingPaymentLink.providerReference}</dd></div>}
          <div><dt className="uppercase tracking-wide">Customer ID</dt><dd className="break-all text-[#A3ADBD]">{recoveryCase.customerId}</dd></div>
        </dl>
      </details>
    </div>
  );
}
