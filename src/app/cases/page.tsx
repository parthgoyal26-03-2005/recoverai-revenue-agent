import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { StatusBadge } from "@/components/status-badge";
import { formatINR, timeAgo } from "@/lib/domain/format";
import { DEFAULT_POLICY } from "@/lib/domain/types";
import { evaluatePolicy } from "@/lib/policy/engine";
import {
  computeApprovalAttention,
  getCaseRowAction,
  type CaseRowAction,
} from "@/lib/analytics/metrics";

export const dynamic = "force-dynamic";

const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Failed Payment",
  CHECKOUT_ABANDONMENT: "Checkout Abandonment",
  SUBSCRIPTION_FAILURE: "Subscription Failure",
};

const ROW_TONE_STYLES: Record<CaseRowAction["tone"], string> = {
  approval: "bg-amber-100 text-amber-800 font-semibold",
  ready: "bg-emerald-100 text-emerald-800 font-semibold",
  scheduled: "bg-blue-100 text-blue-700",
  recovered: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  rejected: "bg-rose-100 text-rose-800",
  stopped: "bg-slate-200 text-slate-600",
  view: "bg-slate-100 text-slate-600",
};

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const showApprovalsOnly = filter === "approval";

  const [cases, policyRow] = await Promise.all([
    prisma.recoveryCase.findMany({
      where: showApprovalsOnly
        ? { status: "ESCALATED", merchantApproved: false, merchantRejectedAt: null }
        : undefined,
      orderBy: [{ merchantRejectedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      include: {
        customer: { select: { name: true, email: true } },
        interventions: {
          where: { status: "SCHEDULED" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma.recoveryPolicy.findFirst(),
  ]);

  const config = policyRow
    ? {
        ...DEFAULT_POLICY,
        maxRetries: policyRow.maxRetries,
        maxContactAttempts: policyRow.maxContactAttempts,
        recoveryWindowHours: policyRow.recoveryWindowHours,
        approvalThresholdPaise: policyRow.approvalThreshold,
      }
    : DEFAULT_POLICY;

  const allForAttention = showApprovalsOnly
    ? []
    : await prisma.recoveryCase.findMany({
        where: { status: "ESCALATED" },
        select: {
          status: true,
          amountAtRisk: true,
          merchantApproved: true,
          merchantRejectedAt: true,
        },
      });
  const attention = computeApprovalAttention(allForAttention);

  const now = new Date();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Recovery Cases</h1>
          <p className="text-sm text-slate-500">
            All revenue-loss cases handled by the deterministic recovery engine
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/cases"
            className={`rounded-lg px-3 py-1.5 font-medium ${
              !showApprovalsOnly
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            All
          </Link>
          <Link
            href="/cases?filter=approval"
            className={`rounded-lg px-3 py-1.5 font-medium ${
              showApprovalsOnly
                ? "bg-amber-500 text-white"
                : "border border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
            }`}
          >
            Needs Approval{attention.cases > 0 ? ` (${attention.cases})` : ""}
          </Link>
        </div>
      </div>

      {!showApprovalsOnly && attention.cases > 0 && (
        <Link
          href="/cases?filter=approval"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 hover:bg-amber-100"
        >
          <div>
            <p className="text-sm font-bold text-amber-900">Requires Your Attention</p>
            <p className="text-xs text-amber-700">
              High-value recoveries are waiting for your approval.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xl font-bold text-amber-900">{attention.cases} cases</p>
              <p className="text-xs text-amber-700">{formatINR(attention.amountPaise)}</p>
            </div>
            <span className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white">
              Review Approvals →
            </span>
          </div>
        </Link>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-5 py-3 font-medium">Case</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Scenario</th>
                <th className="px-5 py-3 font-medium">Amount at Risk</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Next Step</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
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
                const rowAction = getCaseRowAction({
                  status: c.status,
                  merchantApproved: c.merchantApproved,
                  merchantRejectedAt: c.merchantRejectedAt,
                  windowExpiresAt: c.windowExpiresAt,
                  hasScheduledIntervention: c.interventions.length > 0,
                  allowedProgressAction: evaluation.allowedActions.some(
                    (a) =>
                      a === "RETRY_PAYMENT" ||
                      a === "SCHEDULE_RETRY" ||
                      a === "SEND_REMINDER" ||
                      a === "OFFER_ASSISTANCE"
                  ),
                });

                return (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-5 py-3 font-mono text-xs">
                      <Link
                        href={`/cases/${c.id}`}
                        className="text-emerald-700 hover:text-emerald-800"
                      >
                        {c.id.slice(-8)}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{c.customer.name}</p>
                      <p className="text-xs text-slate-400">{c.customer.email}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {SCENARIO_LABELS[c.scenario] ?? c.scenario}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {formatINR(c.amountAtRisk)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge value={c.status} />
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs ${ROW_TONE_STYLES[rowAction.tone]}`}
                      >
                        {rowAction.label}
                      </span>
                      <Link
                        href={`/cases/${c.id}`}
                        className="ml-2 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                      >
                        [{rowAction.cta}]
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">
                      {timeAgo(c.createdAt)}
                    </td>
                  </tr>
                );
              })}
              {cases.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    {showApprovalsOnly
                      ? "No cases are waiting for your approval."
                      : "No recovery cases yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
