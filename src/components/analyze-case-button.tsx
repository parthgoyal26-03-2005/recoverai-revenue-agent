"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AnalyzeCaseButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/recovery/${caseId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "AI analysis failed.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error while contacting the AI layer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={analyze}
        disabled={busy}
        className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {busy ? "Analyzing…" : "Analyze with AI"}
      </button>
      {error && <span className="text-sm text-rose-700">{error}</span>}
    </div>
  );
}
