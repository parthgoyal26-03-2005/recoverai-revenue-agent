import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { StatusBadge } from "@/components/status-badge";
import { CaseActions } from "@/components/case-actions";
import { formatINR, timeAgo } from "@/lib/domain/format";
import { evaluatePolicy } from "@/lib/policy/engine";
import { policyConfigFromCase } from "@/lib/recovery/orchestrator";
import type { CaseWithRelations } from "@/lib/recovery/store";

export const dynamic = "force-dynamic";

const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Failed Payment",
  CHECKOUT_ABANDONMENT: "Checkout Abandonment",
  SUBSCRIPTION_FAILURE: "Subscription Failure",
};

const RESULT_STYLES: Record<string, string> = {
  SUCCESS: "text-emerald-700 font-medium",
  FAILURE: "text-rose-700 font-medium",
  NO_RESPONSE: "text-slate-500",
  APPROVAL_PENDING: "text-amber-700 font-medium",
  BLOCKED_BY_POLICY: "text-slate-500",
};

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
  const [interventions, auditLogs] = await Promise.all([
    prisma.recoveryIntervention.findMany({
      where: { recoveryCaseId: id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { recoveryCaseId: id },
      orderBy: { createdAt: "asc" },
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
      a !== "STOP_RECOVERY" ||
      evaluation.allowedActions.length === 1
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Retries / Contacts</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {recoveryCase.retryCount}/{config.maxRetries} ·{" "}
            {recoveryCase.contactCount}/{config.maxContactAttempts}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Window Expires</p>
          <p
            className={`mt-1 text-lg font-semibold ${
              evaluation.windowExpired ? "text-rose-700" : "text-slate-900"
            }`}
          >
            {evaluation.windowExpired
              ? "Expired"
              : timeAgo(recoveryCase.windowExpiresAt).replace(" ago", " left")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Case Information</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between sm:block">
                <dt className="text-xs text-slate-400">Scenario</dt>
                <dd>{SCENARIO_LABELS[recoveryCase.scenario]}</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-xs text-slate-400">Customer</dt>
                <dd>
                  {recoveryCase.customer.name} ({recoveryCase.customer.email})
                </dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-xs text-slate-400">Created</dt>
                <dd>{timeAgo(recoveryCase.createdAt)}</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-xs text-slate-400">Resolved</dt>
                <dd>
                  {recoveryCase.resolvedAt ? timeAgo(recoveryCase.resolvedAt) : "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Policy Status & Actions
            </h2>
            <p
              className={`mt-2 rounded-lg p-3 text-sm ${
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
                        {iv.action.replace(/_/g, " ")}
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {iv.status.toLowerCase()}
                        </span>
                      </p>
                      <p className="text-xs text-slate-400">{iv.notes}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm ${RESULT_STYLES[iv.result ?? ""] ?? ""}`}>
                        {iv.result?.replace(/_/g, " ") ?? "PENDING"}
                      </p>
                      {iv.recoveredAmount > 0 && (
                        <p className="text-xs font-medium text-emerald-700">
                          +{formatINR(iv.recoveredAmount)}
                        </p>
                      )}
                      <p className="text-xs text-slate-400">
                        {iv.executedAt
                          ? timeAgo(iv.executedAt)
                          : iv.scheduledAt
                            ? `due ${timeAgo(iv.scheduledAt).replace(" ago", "")}`
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
        </section>

        <aside className="space-y-6">
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
                <dt className="text-slate-500">Max contact attempts</dt>
                <dd className="font-medium">
                  {config.maxContactAttempts} ({evaluation.contactsRemaining} left)
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Recovery window</dt>
                <dd className="font-medium">{config.recoveryWindowHours}h</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Approval threshold</dt>
                <dd className="font-medium">
                  {formatINR(config.approvalThresholdPaise)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Merchant approved</dt>
                <dd className="font-medium">
                  {recoveryCase.merchantApproved ? "Yes" : "No"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Audit Timeline</h2>
            <ol className="mt-4 space-y-4">
              {auditLogs.map((log) => (
                <li key={log.id} className="relative border-l-2 border-slate-100 pl-4">
                  <span className="absolute top-1.5 -left-[5px] h-2 w-2 rounded-full bg-emerald-500" />
                  <p className="text-xs font-medium text-slate-800">{log.event}</p>
                  <p className="text-xs text-slate-400">
                    {log.actor.replace(/_/g, " ")} · {timeAgo(log.createdAt)}
                  </p>
                </li>
              ))}
              {auditLogs.length === 0 && (
                <li className="text-sm text-slate-400">No audit entries yet.</li>
              )}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
