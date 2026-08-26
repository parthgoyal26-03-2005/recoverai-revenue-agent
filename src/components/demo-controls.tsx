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
    <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Developer / Demo Controls
          </p>
          <p className="text-xs text-slate-400">
            Reset to the deterministic seed so the demo can be repeated. Disabled
            in production builds.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? "Resetting…" : "Reset Demo Data"}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-slate-600">{message}</p>}
    </section>
  );
}
