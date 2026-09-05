/**
 * True recovery pipeline. Source: getDashboardData().pipelineCounts.
 * EVERY stage is a UNIQUE CASE count from existing records:
 * - detected: all RecoveryCase rows
 * - analyzed: distinct cases with ≥1 AIDecision
 * - eligible: progressed cases + currently policy-eligible (existing eligibleCases)
 * - attempted: distinct cases with ≥1 executed intervention (executedAt != null)
 * - recovered: cases with status RECOVERED
 * Interventions executed is an ATTEMPT count, shown separately — never in the funnel.
 */
export type PipelineCounts = {
  detected: number;
  analyzed: number;
  eligible: number;
  attempted: number;
  recovered: number;
  interventionsExecuted: number;
};

export function Pipeline({ counts }: { counts: PipelineCounts }) {
  const stages = [
    { label: "Detected", hint: "recovery cases created", cases: counts.detected },
    { label: "AI analyzed", hint: "cases with an AI decision", cases: counts.analyzed },
    { label: "Action eligible", hint: "progressed or currently allowed", cases: counts.eligible },
    { label: "Recovery attempted", hint: "cases with an executed action", cases: counts.attempted },
    { label: "Recovered", hint: "cases resolved with revenue", cases: counts.recovered },
  ];
  const max = Math.max(counts.detected, 1);
  const colors = ["#64748B", "#818CF8", "#5B7CFF", "#38BDF8", "#34D399"];

  if (counts.detected === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[#6F7A89]">
        No pipeline activity yet — run a recovery batch to populate it.
      </p>
    );
  }

  return (
    <div>
      <ol className="space-y-4">
        {stages.map((s, i) => {
          const pctOfDetected =
            counts.detected > 0 ? Math.round((s.cases / counts.detected) * 100) : 0;
          return (
            <li key={s.label}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[12px] font-semibold tracking-[0.06em] text-[#A3ADBD] uppercase">
                  {s.label}
                </p>
                <p className="text-[12.5px] text-[#F7F9FC] tabular-nums">
                  <span className="font-semibold">{s.cases.toLocaleString("en-IN")}</span>{" "}
                  <span className="text-[#6F7A89]">cases · {pctOfDetected}% of detected</span>
                </p>
              </div>
              <div
                className="mt-1.5 h-[10px] w-full bg-[#101010]"
                title={`${s.label}: ${s.cases} unique cases (${s.hint})`}
              >
                {s.cases > 0 && (
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.max(0, (s.cases / max) * 100)}%`,
                      background: colors[i % colors.length],
                    }}
                  />
                )}
              </div>
              {i < stages.length - 1 && (
                <p aria-hidden className="pt-1 text-[11px] text-[#3A3F47]">
                  ↓
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 border-t border-[#171717] pt-3 text-[11.5px] leading-relaxed text-[#6F7A89] tabular-nums">
        All stages are unique cases.{" "}
        {counts.interventionsExecuted.toLocaleString("en-IN")} interventions executed
        across {counts.attempted.toLocaleString("en-IN")} attempted cases — attempts,
        not cases.
      </p>
    </div>
  );
}
