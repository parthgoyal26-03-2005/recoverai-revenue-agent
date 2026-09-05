/**
 * AI decision outcomes. Sources (all real, decision-level unless noted):
 * - analysesPerformed, avgConfidencePct — all AIDecision rows
 * - acceptedCount — decisions whose latest policy verdict allowed them
 * - approvalRequiredCount — decisions needing merchant attention
 * - blockedByPolicyCount — decisions whose policy verdict blocked them
 * Rows are NOT a partition (a decision can need approval AND be allowed),
 * so each row scales independently. Policy stop events are event-level and
 * shown separately below with an explicit label.
 */
export type AiOutcomeData = {
  analysesPerformed: number;
  avgConfidencePct: number;
  acceptedCount: number;
  approvalRequiredCount: number;
  blockedByPolicyCount: number;
  stoppedEvents: number;
  terminalPrevented: number;
};

export function AiOutcomes({ data }: { data: AiOutcomeData }) {
  const rows = [
    { label: "Auto-allowed", hint: "policy verdict: allowed", value: data.acceptedCount, color: "#34D399" },
    { label: "Merchant approval", hint: "needs merchant attention", value: data.approvalRequiredCount, color: "#FBBF24" },
    { label: "Blocked by policy", hint: "policy verdict: blocked", value: data.blockedByPolicyCount, color: "#F87171" },
  ];
  const scale = Math.max(data.analysesPerformed, 1);

  if (data.analysesPerformed === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[#6F7A89]">
        No AI decisions yet — analyze a case to populate this.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-6">
        <div>
          <p className="text-[26px] leading-none font-semibold tracking-tight text-[#F7F9FC] tabular-nums">
            {data.analysesPerformed.toLocaleString("en-IN")}
          </p>
          <p className="mt-1 text-[11px] font-semibold tracking-[0.08em] text-[#6F7A89] uppercase">
            AI decisions
          </p>
        </div>
        <div>
          <p className="text-[26px] leading-none font-semibold tracking-tight text-[#9DB1FF] tabular-nums">
            {data.avgConfidencePct}%
          </p>
          <p className="mt-1 text-[11px] font-semibold tracking-[0.08em] text-[#6F7A89] uppercase">
            Avg confidence
          </p>
        </div>
      </div>

      <ul className="mt-5 space-y-4">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[12px] font-semibold tracking-[0.06em] text-[#A3ADBD] uppercase">
                {r.label}
              </p>
              <p
                className="text-[12.5px] font-semibold text-[#F7F9FC] tabular-nums"
                title={r.hint}
              >
                {r.value > 0 ? r.value.toLocaleString("en-IN") : "—"}
              </p>
            </div>
            <div className="mt-1.5 h-[8px] w-full bg-[#101010]" title={`${r.label}: ${r.value} decisions (${r.hint})`}>
              {r.value > 0 ? (
                <div
                  className="h-full"
                  style={{ width: `${Math.max(0, (r.value / scale) * 100)}%`, background: r.color }}
                />
              ) : (
                <div className="h-full w-full bg-[#1A1A1A]" title="Zero — no decisions in this outcome" />
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-[#171717] pt-3 text-[11.5px] leading-relaxed text-[#6F7A89] tabular-nums">
        Policy enforcement events: {data.stoppedEvents.toLocaleString("en-IN")} recoveries
        stopped · {data.terminalPrevented.toLocaleString("en-IN")} terminal executions
        prevented. Categories above can overlap — they are not shares of a whole.
      </p>
    </div>
  );
}
