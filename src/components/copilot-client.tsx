"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type CaseOption = {
  id: string;
  label: string;
};

export type AnalysisView = {
  decisionId: string;
  customerName: string;
  amountLabel: string;
  diagnosis: string;
  riskLevel: string;
  recommendedAction: string;
  confidence: number;
  reasoning: string;
  requiresMerchantAttention: boolean;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
  policyAllowedByPolicy: boolean;
  policyReason: string;
  requiresMerchantApproval: boolean;
};

const RISK_STYLES: Record<string, string> = {
  LOW: "bg-emerald-100 text-emerald-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  HIGH: "bg-rose-100 text-rose-700",
};

function humanize(value: string) {
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

type CopilotClientProps = {
  cases: CaseOption[];
  existingAnalyses: Record<string, AnalysisView>;
};

export function CopilotClient({ cases, existingAnalyses }: CopilotClientProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(cases[0]?.id ?? "");
  const [analysis, setAnalysis] = useState<AnalysisView | null>(
    selected ? (existingAnalyses[selected] ?? null) : null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/recovery/${selected}/analyze`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed.");
        setAnalysis(null);
      } else {
        setAnalysis({
          decisionId: data.decisionId,
          customerName: cases.find((c) => c.id === selected)?.label ?? selected,
          amountLabel: data.contextAmountLabel ?? "",
          diagnosis: data.analysis.diagnosis,
          riskLevel: data.analysis.riskLevel,
          recommendedAction: data.analysis.recommendedAction,
          confidence: data.analysis.confidence,
          reasoning: data.analysis.reasoning,
          requiresMerchantAttention: data.analysis.requiresMerchantAttention,
          provider: data.provider,
          model: data.model,
          fallbackUsed: data.fallbackUsed,
          latencyMs: data.latencyMs,
          policyAllowedByPolicy: data.policyValidation.allowedByPolicy,
          policyReason: data.policyValidation.reason,
          requiresMerchantApproval:
            data.analysis.recommendedAction === "ESCALATE_TO_MERCHANT" ||
            data.policyValidation.reason
              .toLowerCase()
              .includes("merchant approval"),
        });
        router.refresh();
      }
    } catch {
      setError("Network error while contacting the AI layer.");
    } finally {
      setBusy(false);
    }
  }

  function onSelectionChange(id: string) {
    setSelected(id);
    setAnalysis(existingAnalyses[id] ?? null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <label
            htmlFor="case-select"
            className="mb-1 block text-xs font-medium text-slate-500"
          >
            Select a recovery case
          </label>
          <select
            id="case-select"
            value={selected}
            onChange={(e) => onSelectionChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={busy || !selected}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {busy ? "Analyzing…" : "Analyze Case"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {!analysis && !busy && (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            No analysis yet for this case
          </p>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            Click &quot;Analyze Case&quot; to have the AI agent produce a
            diagnosis, risk assessment, and recommended action. The
            recommendation is validated by the deterministic policy engine — it
            never executes anything by itself.
          </p>
        </div>
      )}

      {analysis && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">
              AI Recovery Analysis
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                analysis.fallbackUsed
                  ? "bg-amber-100 text-amber-700"
                  : "bg-violet-100 text-violet-700"
              }`}
            >
              {analysis.fallbackUsed
                ? "Demo mode (mock provider)"
                : `${analysis.provider} · ${analysis.model}`}
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-400">Customer</dt>
              <dd className="text-sm font-medium text-slate-900">
                {analysis.customerName}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Diagnosis</dt>
              <dd className="font-mono text-sm font-medium text-slate-900">
                {analysis.diagnosis}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Risk</dt>
              <dd>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                    RISK_STYLES[analysis.riskLevel] ?? ""
                  }`}
                >
                  {humanize(analysis.riskLevel)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Recommendation</dt>
              <dd className="text-sm font-semibold text-emerald-700">
                {humanize(analysis.recommendedAction)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Confidence</dt>
              <dd className="text-sm font-semibold text-slate-900">
                {Math.round(analysis.confidence * 100)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Merchant Attention</dt>
              <dd className="text-sm font-medium text-slate-900">
                {analysis.requiresMerchantAttention ? "Required" : "Not Required"}
              </dd>
            </div>
          </dl>

          <div className="mt-5 rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Reasoning
            </p>
            <p className="mt-1 text-sm text-slate-700">{analysis.reasoning}</p>
          </div>

          <div
            className={`mt-4 rounded-lg p-4 text-sm ${
              analysis.requiresMerchantApproval && !analysis.policyAllowedByPolicy
                ? "bg-amber-50 text-amber-800"
                : analysis.policyAllowedByPolicy
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-rose-50 text-rose-800"
            }`}
          >
            {analysis.requiresMerchantApproval && !analysis.policyAllowedByPolicy ? (
              <>
                <span className="font-semibold">
                  Policy permits this action only after merchant approval.
                </span>{" "}
                Open the case to review and approve it — nothing will execute until
                you do.
              </>
            ) : (
              <>
                <span className="font-semibold">
                  Policy Engine check:{" "}
                  {analysis.policyAllowedByPolicy ? "ALLOWED" : "WOULD BE BLOCKED"}
                </span>{" "}
                — {analysis.policyReason}.{" "}
              </>
            )}
            The AI cannot execute actions; only the deterministic recovery engine
            can, and only when policy (and any required approval) allows.
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span className="rounded-md bg-slate-100 px-2 py-1">AI Recommendation</span>
            <span aria-hidden>↓</span>
            <span className="rounded-md bg-slate-100 px-2 py-1">Policy Validation</span>
            <span aria-hidden>↓</span>
            <span
              className={`rounded-md px-2 py-1 ${
                analysis.requiresMerchantApproval
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100"
              }`}
            >
              Merchant Approval{analysis.requiresMerchantApproval ? "" : " (not required)"}
            </span>
            <span aria-hidden>↓</span>
            <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-800">
              Execution
            </span>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Decision {analysis.decisionId.slice(-8)} · analyzed in{" "}
            {analysis.latencyMs}ms · stored in AIDecision + AuditLog
          </p>
        </div>
      )}
    </div>
  );
}
