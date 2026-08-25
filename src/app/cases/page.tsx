import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { StatusBadge } from "@/components/status-badge";
import { formatINR, timeAgo } from "@/lib/domain/format";
import { DEFAULT_POLICY } from "@/lib/domain/types";
import { evaluatePolicy } from "@/lib/policy/engine";

export const dynamic = "force-dynamic";

const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Failed Payment",
  CHECKOUT_ABANDONMENT: "Checkout Abandonment",
  SUBSCRIPTION_FAILURE: "Subscription Failure",
};

const ACTION_LABELS: Record<string, string> = {
  RETRY_PAYMENT: "Retry Payment",
  SCHEDULE_RETRY: "Schedule Retry",
  SEND_REMINDER: "Send Reminder",
  OFFER_ASSISTANCE: "Offer Assistance",
  ESCALATE_TO_MERCHANT: "Escalate",
  STOP_RECOVERY: "Stop Recovery",
};

export default async function CasesPage() {
  const [cases, policyRow] = await Promise.all([
    prisma.recoveryCase.findMany({
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true, email: true } } },
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

  const now = new Date();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Recovery Cases</h1>
        <p className="text-sm text-slate-500">
          All revenue-loss cases handled by the deterministic recovery engine
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-5 py-3 font-medium">Case</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Scenario</th>
                <th className="px-5 py-3 font-medium">Amount at Risk</th>
                <th className="px-5 py-3 font-medium">Retries</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Priority</th>
                <th className="px-5 py-3 font-medium">Available Action</th>
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
                const nextAction = evaluation.allowedActions.find(
                  (a) =>
                    a !== "STOP_RECOVERY" &&
                    a !== "ESCALATE_TO_MERCHANT"
                ) ?? evaluation.allowedActions[0];

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
                    <td className="px-5 py-3 text-slate-600">
                      {c.retryCount}/{config.maxRetries}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge value={c.status} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge value={c.priority} />
                    </td>
                    <td className="max-w-[220px] px-5 py-3">
                      {nextAction ? (
                        <span className="text-xs font-medium text-emerald-700">
                          {ACTION_LABELS[nextAction]}
                        </span>
                      ) : (
                        <span
                          className="block truncate text-xs text-slate-400"
                          title={evaluation.summaryReason}
                        >
                          {evaluation.summaryReason}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">
                      {timeAgo(c.createdAt)}
                    </td>
                  </tr>
                );
              })}
              {cases.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-slate-400">
                    No recovery cases yet.
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
