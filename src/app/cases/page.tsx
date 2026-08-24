import { StatusBadge } from "@/components/status-badge";
import { formatINR, timeAgo } from "@/lib/domain/format";
import { getAllCases } from "@/lib/analytics/metrics";

export const dynamic = "force-dynamic";

const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Failed Payment",
  CHECKOUT_ABANDONMENT: "Checkout Abandonment",
  SUBSCRIPTION_FAILURE: "Subscription Failure",
};

export default async function CasesPage() {
  const cases = await getAllCases();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Recovery Cases</h1>
        <p className="text-sm text-slate-500">
          All revenue-loss cases being handled by the recovery agent
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-5 py-3 font-medium">Case</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Scenario</th>
                <th className="px-5 py-3 font-medium">Amount at Risk</th>
                <th className="px-5 py-3 font-medium">Retries</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Priority</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
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
                  <td className="px-5 py-3 text-slate-600">{c.retryCount}/3</td>
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
              {cases.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
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
