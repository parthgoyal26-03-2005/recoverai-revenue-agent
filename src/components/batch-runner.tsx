"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type BatchSummary = {
  casesAnalyzed: number;
  actionsExecuted: number;
  scheduled: number;
  recovered: number;
  failed: number;
  blocked: number;
  approvalRequired: number;
  stopped: number;
  escalated: number;
  revenueAtRiskPaise: number;
  revenueRecoveredPaise: number;
  recoveryRatePct: number;
};

const STEPS = [
  "Preparing cases…",
  "Analyzing & evaluating policies…",
  "Executing allowed recoveries…",
  "Finalizing metrics…",
];

function inr(paise: number) {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function BatchRunner() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBatch() {
    setRunning(true);
    setSummary(null);
    setError(null);
    setProgress({ processed: 0, total: 0 });
    setActiveStep(0);

    try {
      const res = await fetch("/api/recovery/batch", { method: "POST" });
      if (!res.ok || !res.body) {
        throw new Error(`Batch request failed (HTTP ${res.status}).`);
      }
      setActiveStep(1);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "phase" && event.phase === "preparing") {
            setActiveStep(0);
          } else if (event.type === "progress") {
            setActiveStep(2);
            setProgress({ processed: event.processed, total: event.total });
          } else if (event.type === "phase" && event.phase === "finalizing") {
            setActiveStep(3);
          } else if (event.type === "complete") {
            setActiveStep(4);
            setSummary(event.summary);
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
      router.refresh();
    } catch {
      setError("Network error while running the recovery batch.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Run Recovery Batch</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Processes every active case through the deterministic policy engine —
            only policy-allowed actions are executed.
          </p>
        </div>
        <button
          type="button"
          onClick={runBatch}
          disabled={running}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {running ? "Running…" : "Run Recovery Batch"}
        </button>
      </div>

      {running && (
        <ol className="mt-4 space-y-2">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  i < activeStep
                    ? "bg-emerald-600 text-white"
                    : i === activeStep
                      ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {i < activeStep ? "✓" : i + 1}
              </span>
              <span className={i <= activeStep ? "text-slate-800" : "text-slate-400"}>
                {step}
              </span>
              {i === 2 && progress.total > 0 && (
                <span className="ml-auto text-xs text-slate-500">
                  {progress.processed}/{progress.total} cases processed
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {!running && summary && (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-sm font-semibold text-emerald-900">Recovery Batch Complete</p>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[
              { label: "Cases analyzed", value: summary.casesAnalyzed },
              { label: "Actions executed", value: summary.actionsExecuted },
              { label: "Recovered", value: summary.recovered },
              { label: "Failed", value: summary.failed },
              { label: "Blocked", value: summary.blocked },
              { label: "Approval required", value: summary.approvalRequired },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-lg font-semibold text-slate-900">{item.value}</p>
                <p className="text-xs text-slate-500">{item.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Scheduled retries: {summary.scheduled} · Escalated: {summary.escalated} · Stopped:{" "}
            {summary.stopped}
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-emerald-200 pt-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Revenue at risk (batch)</dt>
              <dd className="text-lg font-semibold text-rose-700">{inr(summary.revenueAtRiskPaise)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Revenue recovered</dt>
              <dd className="text-lg font-semibold text-emerald-700">{inr(summary.revenueRecoveredPaise)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Recovery rate</dt>
              <dd className="text-lg font-semibold text-slate-900">{summary.recoveryRatePct}%</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
