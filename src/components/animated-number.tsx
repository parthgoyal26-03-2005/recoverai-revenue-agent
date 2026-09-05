"use client";

import { useEffect, useState } from "react";
import { formatLakhINR, formatCount } from "@/lib/domain/present";
import { formatINR } from "@/lib/domain/format";

/**
 * Tiny client island for KPI count-up. Props are plain serializable values
 * only (target + format key) so it can be rendered inside server components.
 */
export function AnimatedNumber({
  target,
  format,
  title,
}: {
  target: number;
  format: "lakh" | "full" | "count";
  title?: string;
}) {
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [value, setValue] = useState(reduced ? target : 0);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const durationMs = 700;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  const current = reduced ? target : value;
  const text =
    format === "lakh"
      ? formatLakhINR(Math.round(current))
      : format === "full"
        ? formatINR(Math.round(current))
        : formatCount(Math.round(current));
  const full =
    title ??
    (format === "lakh"
      ? formatLakhINR(target)
      : format === "full"
        ? formatINR(target)
        : formatCount(target));

  return (
    <span title={full} className="tabular-nums">
      {text}
    </span>
  );
}
