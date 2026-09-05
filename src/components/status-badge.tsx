import { clsx } from "clsx";
import { statusLabel } from "@/lib/domain/present";

/** Rectangular status labels: dark transparent bg, thin semantic border + text. */
const TONES: Record<string, string> = {
  RECOVERED: "border-emerald-400/40 text-emerald-300",
  SUCCESS: "border-emerald-400/40 text-emerald-300",
  COMPLETED: "border-emerald-400/40 text-emerald-300",
  DETECTED: "border-white/15 text-[#A3ADBD]",
  DIAGNOSED: "border-sky-400/40 text-sky-300",
  IN_PROGRESS: "border-[#5B7CFF]/50 text-[#9DB1FF]",
  ESCALATED: "border-amber-400/40 text-amber-300",
  AWAITING_PAYMENT: "border-[#5B7CFF]/50 text-[#9DB1FF]",
  PENDING: "border-white/15 text-[#A3ADBD]",
  SCHEDULED: "border-sky-400/40 text-sky-300",
  FAILED: "border-red-400/40 text-red-300",
  FAILURE: "border-red-400/40 text-red-300",
  STOPPED: "border-red-400/40 text-red-300",
  REJECTED: "border-red-400/40 text-red-300",
  LOW: "border-white/15 text-[#A3ADBD]",
  MEDIUM: "border-sky-400/40 text-sky-300",
  HIGH: "border-amber-400/40 text-amber-300",
  CRITICAL: "border-red-400/40 text-red-300",
};

export function StatusBadge({ value, dot = false }: { value: string; dot?: boolean }) {
  const tone = TONES[value] ?? "border-white/15 text-[#A3ADBD]";
  return (
    <span
      title={value}
      className={clsx(
        "inline-flex items-center gap-1.5 border bg-transparent px-2 py-0.5 text-[11px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase",
        tone
      )}
    >
      {dot && <span aria-hidden className="circle h-1.5 w-1.5 bg-current" />}
      {statusLabel(value)}
    </span>
  );
}
