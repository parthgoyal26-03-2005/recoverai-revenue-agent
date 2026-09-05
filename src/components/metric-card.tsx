import type { ComponentType, ReactNode } from "react";
import { clsx } from "clsx";
import { AnimatedNumber } from "./animated-number";

export type MetricTone = "default" | "positive" | "negative" | "warning" | "info";

const VALUE_TONES: Record<MetricTone, string> = {
  default: "text-[#F7F9FC]",
  positive: "text-emerald-300",
  negative: "text-amber-300",
  warning: "text-amber-300",
  info: "text-[#9DB1FF]",
};

const ICON_TONES: Record<MetricTone, string> = {
  default: "text-[#6F7A89]",
  positive: "text-emerald-300",
  negative: "text-amber-300",
  warning: "text-amber-300",
  info: "text-[#9DB1FF]",
};

type CardShellProps = {
  label: string;
  displayValue: ReactNode;
  sub?: string;
  tone?: MetricTone;
  icon?: ComponentType<{ className?: string }>;
  title?: string;
  bare?: boolean;
};

/**
 * Server-safe KPI block. Flat black analytical block — no card chrome.
 * When `bare`, renders without its own border so siblings can share
 * boundaries inside a bordered grid (divide-x dividers).
 */
export function KpiCardStatic({
  label,
  displayValue,
  sub,
  tone = "default",
  icon: Icon,
  title,
  bare = false,
}: CardShellProps) {
  return (
    <div className={clsx("bg-black p-5", !bare && "border border-[#1A1A1A]")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-[#6F7A89] uppercase">
          {label}
        </p>
        {Icon && <Icon className={clsx("h-4 w-4 shrink-0", ICON_TONES[tone])} />}
      </div>
      <p
        title={title}
        className={clsx(
          "mt-2 text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums",
          VALUE_TONES[tone]
        )}
      >
        {displayValue}
      </p>
      {sub && <p className="mt-2 text-[12.5px] text-[#A3ADBD]">{sub}</p>}
    </div>
  );
}

export function KpiCard(props: {
  label: string;
  displayValue: string;
  sub?: string;
  tone?: MetricTone;
  icon?: ComponentType<{ className?: string }>;
  title?: string;
  bare?: boolean;
}) {
  return <KpiCardStatic {...props} />;
}

/** Animated KPI — server component; animation lives in <AnimatedNumber/>. */
export function AnimatedKpi({
  label,
  target,
  format,
  sub,
  tone = "default",
  icon,
  bare = false,
}: {
  label: string;
  target: number;
  format: "lakh" | "full" | "count";
  sub?: string;
  tone?: MetricTone;
  icon?: ComponentType<{ className?: string }>;
  bare?: boolean;
}) {
  return (
    <KpiCardStatic
      label={label}
      displayValue={<AnimatedNumber target={target} format={format} />}
      sub={sub}
      tone={tone}
      icon={icon}
      bare={bare}
    />
  );
}

/** Back-compat export for existing imports. */
export function MetricCard({
  title,
  value,
  sub,
  tone = "default",
}: {
  title: string;
  value: string;
  sub?: string;
  tone?: MetricTone;
}) {
  return <KpiCardStatic label={title} displayValue={value} sub={sub} tone={tone} />;
}
