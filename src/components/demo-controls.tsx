"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DemoControls({ devMode }: { devMode: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!devMode) return null;

  async function reset() {
    if (
      !window.confirm(
        "Reset all demo data? This wipes the database and restores the deterministic seed."
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = await res.json();
      setMessage(
        res.ok
          ? "Demo data has been reset to the deterministic seed."
          : (data.error ?? "Reset failed.")
      );
      router.refresh();
    } catch {
      setMessage("Network error during reset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-dashed border-[#242424] bg-black p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#6F7A89] uppercase">
            Developer / Demo Controls
          </p>
          <p className="text-xs text-[#6F7A89]">
            Reset to the deterministic seed so the demo can be repeated. Disabled
            in production builds.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="border border-white/10 bg-black px-3 py-1.5 text-sm font-medium text-[#F7F9FC] transition-colors hover:border-white/25 disabled:opacity-50"
        >
          {busy ? "Resetting…" : "Reset Demo Data"}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-[#A3ADBD]">{message}</p>}
    </section>
  );
}
