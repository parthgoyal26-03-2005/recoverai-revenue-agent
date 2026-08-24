import Link from "next/link";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { formatINR, timeAgo } from "@/lib/domain/format";
import { getDashboardMetrics, getRecentCases } from "@/lib/analytics/metrics";

export const dynamic = "force-dynamic";

const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Failed Payments",
  CHECKOUT_ABANDONMENT: "Checkout Abandonments",
  SUBSCRIPTION_FAILURE: "Subscription Failures",
};

export default async function DashboardPage() {
  const [metrics, recentCases] = await Promise.all([
    getDashboardMetrics(),
    getRecentCases(8),
  ]);

  const maxScenarioAtRisk = Math.max(
    ...metrics.byScenario.map((s) => s.atRiskPaise),
    1
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Revenue recovery overview across all scenarios
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Revenue at Risk"
          value={formatINR(metrics.totalAtRiskPaise)}
          sub={`${metrics.totalCases} recovery cases`}
          tone="negative"
        />
        <MetricCard
          title="Recovered Revenue"
          value={formatINR(metrics.recoveredPaise)}
          sub={`${metrics.recoveredCases} cases recovered`}
          tone="positive"
        />
        <MetricCard
          title="Recovery Rate"
          value={`${metrics.recoveryRatePct}%`}
          sub="of total at-risk revenue"
        />
        <MetricCard
          title="Active Cases"
          value={String(metrics.activeCases)}
          sub={`${metrics.escalatedCases} escalated · ${metrics.stoppedCases} stopped`}
          tone="warning"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Recovery Overview by Scenario
          </h2>
          <div className="mt-4 space-y-4">
            {metrics.byScenario.map((s) => (
              <div key={s.scenario}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">
                    {SCENARIO_LABELS[s.scenario] ?? s.scenario}
                  </span>
                  <span className="text-slate-500">
                    {formatINR(s.recoveredPaise)} recovered of{" "}
                    {formatINR(s.atRiskPaise)} at risk · {s.cases} cases
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{
                      width: `${Math.min(100, (s.atRiskPaise / maxScenarioAtRisk) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {metrics.byScenario.length === 0 && (
              <p className="text-sm text-slate-400">No data yet.</p>
            )}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
            {[
              { label: "Recovered", value: metrics.recoveredCases, cls: "text-emerald-700" },
              { label: "Failed", value: metrics.failedCases, cls: "text-rose-700" },
              { label: "Escalated", value: metrics.escalatedCases, cls: "text-amber-700" },
              { label: "Stopped", value: metrics.stoppedCases, cls: "text-slate-600" },
            ].map((item) => (
              <div key={item.label}>
                <p className={`text-xl font-semibold ${item.cls}`}>{item.value}</p>
                <p className="text-xs text-slate-500">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">AI Insights</h2>
          <p className="mt-1 text-xs text-slate-400">
            Coming soon — the AI agent will surface patterns and recommendations here.
          </p>
          <ul className="mt-4 space-y-3 text-sm text-slate-400">
            <li className="rounded-lg bg-slate-50 p-3">
              Failure pattern analysis across payment scenarios
            </li>
            <li className="rounded-lg bg-slate-50 p-3">
              Recommended policy adjustments from recovery outcomes
            </li>
            <li className="rounded-lg bg-slate-50 p-3">
              High-value cases that need your attention
            </li>
          </ul>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Recent Recovery Cases
          </h2>
          <Link
            href="/cases"
            className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-5 py-3 font-medium">Case</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Scenario</th>
                <th className="px-5 py-3 font-medium">Amount at Risk</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Priority</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentCases.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">
                    {c.id.slice(-8)}
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
                    <StatusBadge value={c.priority} />
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-400">
                    {timeAgo(c.createdAt)}
                  </td>
                </tr>
              ))}
              {recentCases.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    No recovery cases yet. Run the seed script to populate demo data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
