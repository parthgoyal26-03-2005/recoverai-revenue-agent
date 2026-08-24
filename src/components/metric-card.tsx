type MetricCardProps = {
  title: string;
  value: string;
  sub?: string;
  tone?: "default" | "positive" | "negative" | "warning";
};

const TONE_STYLES: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "text-slate-900",
  positive: "text-emerald-700",
  negative: "text-rose-700",
  warning: "text-amber-700",
};

export function MetricCard({ title, value, sub, tone = "default" }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight ${TONE_STYLES[tone]}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
