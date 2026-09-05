import { formatINR } from "@/lib/domain/format";
import {
  formatLakhINR,
  scenarioLabel,
} from "@/lib/domain/present";
import type { ScenarioAnalytics } from "@/lib/analytics/metrics";

/**
 * Financial performance per scenario. Source: getDashboardData().scenarioAnalytics
 * (amountAtRiskPaise, recoveredPaise, recoveryRatePct — all revenue in paise).
 * Bars scale to the largest at-risk amount; full INR values in tooltips.
 */
export function ScenarioPerformance({ rows }: { rows: ScenarioAnalytics[] }) {
  const sorted = [...rows].sort((a, b) => b.amountAtRiskPaise - a.amountAtRiskPaise);
  const max = Math.max(...sorted.map((r) => r.amountAtRiskPaise), 1);

  if (sorted.length === 0 || sorted.every((r) => r.amountAtRiskPaise === 0)) {
    return (
      <p className="py-8 text-center text-[13px] text-[#6F7A89]">
        No scenario revenue yet — it will appear here after cases are created.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {sorted.map((r) => {
        const atRiskPct = Math.max(0, (r.amountAtRiskPaise / max) * 100);
        const recoveredPct = Math.max(0, (r.recoveredPaise / max) * 100);
        return (
          <div key={r.scenario}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] font-semibold text-[#F7F9FC]">
                {scenarioLabel(r.scenario)}
              </p>
              <p
                className="text-[12px] text-[#A3ADBD] tabular-nums"
                title={`${formatINR(r.amountAtRiskPaise)} at risk · ${formatINR(r.recoveredPaise)} recovered`}
              >
                {formatLakhINR(r.amountAtRiskPaise)} at risk ·{" "}
                <span className="font-semibold text-emerald-300">
                  {formatLakhINR(r.recoveredPaise)} recovered
                </span>{" "}
                · {r.recoveryRatePct}%
              </p>
            </div>
            <div className="mt-2 space-y-1">
              <div
                className="h-[10px] w-full bg-[#151515]"
                title={`At risk: ${formatINR(r.amountAtRiskPaise)} across ${r.cases} cases`}
              >
                {atRiskPct > 0 && (
                  <div className="h-full bg-[#5B7CFF]" style={{ width: `${atRiskPct}%` }} />
                )}
              </div>
              <div
                className="h-[6px] w-full bg-[#101010]"
                title={`Recovered: ${formatINR(r.recoveredPaise)}`}
              >
                {recoveredPct > 0 && (
                  <div className="h-full bg-[#34D399]" style={{ width: `${recoveredPct}%` }} />
                )}
              </div>
            </div>
            <p className="mt-1 text-[11.5px] text-[#6F7A89] tabular-nums">
              {r.cases} cases · {r.failedAttempts} failed attempts · {r.escalations} escalations
            </p>
          </div>
        );
      })}
      <p className="border-t border-[#171717] pt-3 text-[11.5px] text-[#6F7A89]">
        Full bar = revenue at risk · thin bar = revenue recovered · both scaled to the
        largest at-risk scenario.
      </p>
    </div>
  );
}
