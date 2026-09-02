import Link from "next/link";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { BatchRunner } from "@/components/batch-runner";
import { DemoControls } from "@/components/demo-controls";
import { formatINR, timeAgo } from "@/lib/domain/format";
import {
  getDashboardData,
  SCENARIO_LABELS,
} from "@/lib/analytics/metrics";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  RETRY_PAYMENT: "Retry Payment",
  SCHEDULE_RETRY: "Schedule Retry",
  SEND_REMINDER: "Send Reminder",
  OFFER_ASSISTANCE: "Offer Assistance",
  ESCALATE_TO_MERCHANT: "Escalate",
  STOP_RECOVERY: "Stop Recovery",
};

function currentAiProviderLabel() {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (selected === "gemini" && process.env.GEMINI_API_KEY) return { label: "Gemini", mock: false };
  if (selected === "groq" && process.env.GROQ_API_KEY) return { label: "Groq", mock: false };
  if (!selected && process.env.GEMINI_API_KEY) return { label: "Gemini", mock: false };
  if (!selected && process.env.GROQ_API_KEY) return { label: "Groq", mock: false };
  if (selected === "gemini") return { label: "Gemini", mock: false };
  if (selected === "groq") return { label: "Groq", mock: false };
  return { label: "Mock", mock: true };
}

function currentRecoveryLabel(): { label: string; isRazorpay: boolean } {
  const selected = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (selected === "razorpay") return { label: "Razorpay Test Mode", isRazorpay: true };
  return { label: "Simulation Mode", isRazorpay: false };
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  const provider = currentAiProviderLabel();
  const recovery = currentRecoveryLabel();
  const maxScenarioRecovered = Math.max(
    ...data.scenarioAnalytics.map((s) => s.amountAtRiskPaise),
    1
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Revenue Recovery Command Center
          </h1>
          <p className="text-sm text-slate-500">
            RecoverAI finds revenue at risk, understands why, recovers it safely,
            and measures every rupee.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase ${
              provider.mock
                ? "bg-amber-100 text-amber-800"
                : "bg-violet-100 text-violet-700"
            }`}
          >
            AI: {provider.mock ? "Mock / Demo" : provider.label}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase ${
              recovery.isRazorpay
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            Recovery: {recovery.label}
          </span>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          title="Revenue at Risk"
          value={formatINR(data.hero.totalAtRiskPaise)}
          sub={`${data.hero.totalCases} cases tracked`}
          tone="negative"
        />
        <MetricCard
          title="Revenue Recovered"
          value={formatINR(data.hero.recoveredPaise)}
          sub={`${data.hero.recoveredCases} cases recovered`}
          tone="positive"
        />
        <MetricCard
          title="Recovery Rate"
          value={`${data.hero.recoveryRatePct}%`}
          sub="of all at-risk revenue"
        />
        <MetricCard
          title="Active Recovery Cases"
          value={String(data.hero.activeCases)}
          sub={`${data.hero.awaitingApprovalCases} awaiting approval (${formatINR(data.hero.awaitingApprovalPaise)})`}
          tone="warning"
        />
        <MetricCard title="Cases Recovered" value={String(data.hero.recoveredCases)} tone="positive" />
        <MetricCard title="Cases Escalated" value={String(data.hero.escalatedCases)} tone="warning" />
        <MetricCard title="Cases Stopped" value={String(data.hero.stoppedCases)} />
        <MetricCard
          title="Amount Awaiting Approval"
          value={formatINR(data.hero.awaitingApprovalPaise)}
          tone="warning"
        />
      </section>

      <section className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">The Recovery Story</h2>
          <p className="mt-1 text-xs text-slate-400">Live values from the database</p>
          <div className="mt-6 space-y-6">
            <div className="rounded-lg border border-rose-100 bg-rose-50 p-4">
              <p className="text-xs font-semibold tracking-wide text-rose-600 uppercase">
                Before RecoverAI
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xl font-semibold text-rose-700">
                    {formatINR(data.beforeAfter.beforeAtRiskPaise)}
                  </p>
                  <p className="text-xs text-rose-500">revenue still at risk</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-rose-700">
                    {data.beforeAfter.beforeUnrecoveredCases}
                  </p>
                  <p className="text-xs text-rose-500">unrecovered cases</p>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-emerald-500">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
              </svg>
            </div>

            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase">
                With RecoverAI
              </p>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xl font-semibold text-emerald-700">
                    {formatINR(data.beforeAfter.afterRecoveredPaise)}
                  </p>
                  <p className="text-xs text-emerald-600">revenue recovered</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-emerald-700">
                    {data.beforeAfter.afterRatePct}%
                  </p>
                  <p className="text-xs text-emerald-600">recovery rate</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-emerald-700">
                    {data.beforeAfter.afterAutoRecoveredCases}
                  </p>
                  <p className="text-xs text-emerald-600">auto-recovered cases</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
          <h2 className="text-sm font-semibold text-slate-900">Recovery Funnel</h2>
          <ol className="mt-4 space-y-2.5">
            {data.funnel.map((stage, i) => (
              <li key={stage.label} className="relative rounded-lg bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-slate-700">{stage.label}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-slate-900">{stage.value}</span>
                    {stage.sub && (
                      <p className="text-xs text-slate-400">{stage.sub}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {data.hero.awaitingApprovalCases > 0 && (
        <Link
          href="/cases?filter=approval"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 shadow-sm hover:bg-amber-100"
        >
          <div>
            <p className="text-sm font-bold tracking-wide text-amber-900 uppercase">
              Requires Your Attention
            </p>
            <p className="text-xs text-amber-700">
              High-value recoveries are waiting for your approval.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xl font-bold text-amber-900">
                {data.hero.awaitingApprovalCases} cases
              </p>
              <p className="text-xs text-amber-700">
                {formatINR(data.hero.awaitingApprovalPaise)}
              </p>
            </div>
            <span className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white">
              Review Approvals →
            </span>
          </div>
        </Link>
      )}

      <BatchRunner />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Recovery by Scenario</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {data.scenarioAnalytics.map((s) => (
            <div key={s.scenario} className="rounded-lg border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-800">
                {SCENARIO_LABELS[s.scenario] ?? s.scenario}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(100, (s.recoveredPaise / maxScenarioRecovered) * 100)}%` }}
                />
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Cases</dt>
                  <dd className="font-medium text-slate-900">{s.cases}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">At risk</dt>
                  <dd className="font-medium text-slate-900">{formatINR(s.amountAtRiskPaise)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Recovered</dt>
                  <dd className="font-medium text-emerald-700">{formatINR(s.recoveredPaise)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Recovery rate</dt>
                  <dd className="font-medium text-slate-900">{s.recoveryRatePct}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Failed attempts</dt>
                  <dd className="font-medium text-rose-700">{s.failedAttempts}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Escalations</dt>
                  <dd className="font-medium text-amber-700">{s.escalations}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">AI Performance</h2>
            {!provider.mock && (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                {provider.label}
              </span>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xl font-semibold text-slate-900">{data.aiPerformance.analysesPerformed}</p>
              <p className="text-xs text-slate-500">AI analyses performed</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-emerald-700">{data.aiPerformance.acceptedCount}</p>
              <p className="text-xs text-slate-500">recommendations accepted</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-rose-700">{data.aiPerformance.blockedByPolicyCount}</p>
              <p className="text-xs text-slate-500">blocked by policy</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-amber-700">{data.aiPerformance.approvalRequiredCount}</p>
              <p className="text-xs text-slate-500">requiring approval</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-slate-900">{data.aiPerformance.avgConfidencePct}%</p>
              <p className="text-xs text-slate-500">avg confidence</p>
            </div>
          </div>
          {data.aiPerformance.providers.length > 0 && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
              Providers used:{" "}
              {data.aiPerformance.providers.map((p) => `${p.provider} (${p.count})`).join(" · ")}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">AI Safety &amp; Policy Controls</h2>
          <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-slate-50 py-3 text-xs font-medium text-slate-600">
            <span className="rounded-md bg-white px-2 py-1 shadow-sm">AI recommends</span>
            <span aria-hidden>→</span>
            <span className="rounded-md bg-white px-2 py-1 shadow-sm">Policy validates</span>
            <span aria-hidden>→</span>
            <span className="rounded-md bg-emerald-600 px-2 py-1 text-white shadow-sm">Allowed</span>
            <span className="rounded-md bg-amber-500 px-2 py-1 text-white shadow-sm">Approval</span>
            <span className="rounded-md bg-rose-600 px-2 py-1 text-white shadow-sm">Blocked</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xl font-semibold text-emerald-700">{data.policySafety.allowed}</p>
              <p className="text-xs text-slate-500">actions allowed</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-rose-700">{data.policySafety.blocked}</p>
              <p className="text-xs text-slate-500">actions blocked</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-amber-700">{data.policySafety.approvalRequired}</p>
              <p className="text-xs text-slate-500">approval required</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-slate-700">{data.policySafety.stopped}</p>
              <p className="text-xs text-slate-500">recoveries stopped</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-slate-700">{data.policySafety.terminalPrevented}</p>
              <p className="text-xs text-slate-500">terminal executions prevented</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900">
          Recent Recoveries
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Scenario</th>
                <th className="px-5 py-3 font-medium">Amount at Risk</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Recovered</th>
                <th className="px-5 py-3 font-medium">AI Confidence</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.recentRecoveries.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">
                    <Link href={`/cases/${r.caseId}`} className="hover:text-emerald-700">
                      {r.customerName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{SCENARIO_LABELS[r.scenario] ?? r.scenario}</td>
                  <td className="px-5 py-3 text-slate-900">{formatINR(r.amountAtRiskPaise)}</td>
                  <td className="px-5 py-3 text-slate-600">{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td className="px-5 py-3 font-semibold text-emerald-700">{formatINR(r.recoveredPaise)}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}
                  </td>
                  <td className="px-5 py-3"><StatusBadge value={r.status} /></td>
                  <td className="px-5 py-3 text-xs text-slate-400">{timeAgo(r.executedAt)}</td>
                </tr>
              ))}
              {data.recentRecoveries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                    No successful recoveries yet — run a recovery batch to create some.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Top Recovered Customers</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                <th className="py-2 font-medium">Customer</th>
                <th className="py-2 font-medium">Cases</th>
                <th className="py-2 font-medium">At Risk</th>
                <th className="py-2 font-medium">Recovered</th>
                <th className="py-2 font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.topCustomers.map((c) => (
                <tr key={c.customerId} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 font-medium text-slate-800">{c.name}</td>
                  <td className="py-2 text-slate-600">{c.cases}</td>
                  <td className="py-2 text-slate-600">{formatINR(c.atRiskPaise)}</td>
                  <td className="py-2 font-medium text-emerald-700">{formatINR(c.recoveredPaise)}</td>
                  <td className="py-2 text-slate-600">{c.recoveryRatePct}%</td>
                </tr>
              ))}
              {data.topCustomers.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-slate-400">No recoveries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Activity Timeline</h2>
          <ol className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1">
            {data.activity.map((log) => (
              <li key={log.id} className="relative border-l-2 border-slate-100 pl-4">
                <span className="absolute top-1.5 -left-[5px] h-2 w-2 rounded-full bg-emerald-500" />
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-medium text-slate-800">{log.event}</p>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(log.createdAt)}</span>
                </div>
                <p className="truncate text-xs text-slate-400">
                  {log.actor.replace(/_/g, " ")} ·{" "}
                  <Link href={`/cases/${log.caseId}`} className="hover:text-emerald-700">
                    {log.customerName}
                  </Link>
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <DemoControls devMode={process.env.NODE_ENV !== "production"} />
    </div>
  );
}
