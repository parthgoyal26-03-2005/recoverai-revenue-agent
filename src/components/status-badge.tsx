const BADGE_STYLES: Record<string, string> = {
  DETECTED: "bg-slate-100 text-slate-700",
  DIAGNOSED: "bg-sky-100 text-sky-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  RECOVERED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-rose-100 text-rose-700",
  ESCALATED: "bg-amber-100 text-amber-700",
  STOPPED: "bg-slate-200 text-slate-600",
  REJECTED: "bg-rose-100 text-rose-800",
  LOW: "bg-slate-100 text-slate-600",
  MEDIUM: "bg-sky-100 text-sky-700",
  HIGH: "bg-amber-100 text-amber-700",
  CRITICAL: "bg-rose-100 text-rose-700",
};

export function StatusBadge({ value }: { value: string }) {
  const style = BADGE_STYLES[value] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${style}`}
    >
      {value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}
