/**
 * Case portfolio as a single 100% segmented bar. Source:
 * getDashboardData().statusBreakdown (unique case counts per group).
 * Zero-count groups render no segment but still appear in the legend as 0.
 */
const COLORS: Record<string, string> = {
  recovered: "#34D399",
  active: "#5B7CFF",
  approval: "#FBBF24",
  closed: "#F87171",
};

export function StatusBar({
  segments,
}: {
  segments: { key: string; label: string; cases: number }[];
}) {
  const total = segments.reduce((s, x) => s + x.cases, 0);

  if (total === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[#6F7A89]">
        No cases yet — portfolio distribution will appear here.
      </p>
    );
  }

  return (
    <div>
      <div
        className="flex h-[14px] w-full bg-[#101010]"
        role="img"
        aria-label={`Case portfolio across ${total} cases`}
      >
        {segments.map((s) =>
          s.cases > 0 ? (
            <div
              key={s.key}
              className="h-full"
              style={{
                width: `${(s.cases / total) * 100}%`,
                background: COLORS[s.key] ?? "#64748B",
              }}
              title={`${s.label}: ${s.cases} cases (${Math.round((s.cases / total) * 100)}%)`}
            />
          ) : null
        )}
      </div>
      <ul className="mt-4 space-y-2.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[12.5px]">
            <span
              aria-hidden
              className="circle h-2 w-2"
              style={{ background: COLORS[s.key] ?? "#64748B" }}
            />
            <span className="text-[#A3ADBD]">{s.label}</span>
            <span className="ml-auto font-semibold text-[#F7F9FC] tabular-nums">
              {s.cases > 0 ? s.cases.toLocaleString("en-IN") : "—"}
            </span>
            <span className="w-11 text-right text-[#6F7A89] tabular-nums">
              {s.cases > 0 ? `${Math.round((s.cases / total) * 100)}%` : "0"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-[#171717] pt-3 text-[11.5px] text-[#6F7A89] tabular-nums">
        {total.toLocaleString("en-IN")} total cases · segments proportional to case counts.
      </p>
    </div>
  );
}
