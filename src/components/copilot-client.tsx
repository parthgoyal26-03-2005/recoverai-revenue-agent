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
  LOW: "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20 ring-inset",
  MEDIUM: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/25 ring-inset",
  HIGH: "bg-red-400/10 text-red-300 ring-1 ring-red-400/25 ring-inset",
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
            className="mb-1 block text-xs font-medium text-[#6F7A89]"
          >
            Select a recovery case
          </label>
          <select
            id="case-select"
            value={selected}
            onChange={(e) => onSelectionChange(e.target.value)}
            className="w-full border border-white/10 bg-black px-3 py-2 text-sm text-[#F7F9FC] focus:border-[#5B7CFF] focus:outline-none"
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
          className="bg-[#5B7CFF] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4A6DF5] disabled:opacity-50"
        >
          {busy ? "Analyzing…" : "Analyze Case"}
        </button>
      </div>

      {error && (
        <div className="border border-red-400/25 bg-black p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {!analysis && !busy && (
        <div className="flex min-h-[300px] flex-col items-center justify-center border border-dashed border-[#242424] bg-black p-10 text-center">
          <p className="text-sm font-medium text-[#F7F9FC]">
            No analysis yet for this case
          </p>
          <p className="mt-1 max-w-md text-sm text-[#A3ADBD]">
            Click &quot;Analyze Case&quot; to have the AI agent produce a
            diagnosis, risk assessment, and recommended action. The
            recommendation is validated by the deterministic policy engine — it
            never executes anything by itself.
          </p>
        </div>
      )}

      {analysis && (
        <div className="border border-[#1A1A1A] bg-black p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold tracking-[0.08em] text-[#A3ADBD] uppercase">
              AI Recovery Analysis
            </h2>
            <span
              className={`border px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                analysis.fallbackUsed
                  ? "bg-amber-400/10 text-amber-300 ring-amber-400/25"
                  : "bg-[#5B7CFF]/10 text-[#9DB1FF] ring-[#5B7CFF]/25"
              }`}
            >
              {analysis.fallbackUsed
                ? "Demo mode (mock provider)"
                : `${analysis.provider} · ${analysis.model}`}
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-[#6F7A89]">Customer</dt>
              <dd className="text-sm font-medium text-[#F7F9FC]">
                {analysis.customerName}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F7A89]">Diagnosis</dt>
              <dd className="font-mono text-sm font-medium text-[#F7F9FC]">
                {analysis.diagnosis}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F7A89]">Risk</dt>
              <dd>
                <span
                  className={`inline-flex border px-2 py-0.5 text-xs font-semibold ${
                    RISK_STYLES[analysis.riskLevel] ?? ""
                  }`}
                >
                  {humanize(analysis.riskLevel)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F7A89]">Recommendation</dt>
              <dd className="text-sm font-semibold text-emerald-300">
                {humanize(analysis.recommendedAction)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F7A89]">Confidence</dt>
              <dd className="text-sm font-semibold text-[#F7F9FC] tabular-nums">
                {Math.round(analysis.confidence * 100)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F7A89]">Merchant Attention</dt>
              <dd className="text-sm font-medium text-[#F7F9FC]">
                {analysis.requiresMerchantAttention ? "Required" : "Not Required"}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border border-[#1A1A1A] bg-black p-4">
            <p className="text-xs font-semibold tracking-wide text-[#6F7A89] uppercase">
              Reasoning
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[#A3ADBD]">{analysis.reasoning}</p>
          </div>

          <div
            className={`mt-4 border p-4 text-sm leading-relaxed ${
              analysis.requiresMerchantApproval && !analysis.policyAllowedByPolicy
                ? "border-amber-400/30 bg-black text-amber-200"
                : analysis.policyAllowedByPolicy
                  ? "border-emerald-400/30 bg-black text-emerald-200"
                  : "border-red-400/30 bg-black text-red-200"
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

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-medium text-[#6F7A89]">
            <span className="border border-white/10 bg-black px-2 py-1 text-[#A3ADBD]">AI Recommendation</span>
            <span aria-hidden>→</span>
            <span className="border border-white/10 bg-black px-2 py-1 text-[#A3ADBD]">Policy Validation</span>
            <span aria-hidden>→</span>
            <span
              className={`border px-2 py-1 ${
                analysis.requiresMerchantApproval
                  ? "border-amber-400/30 bg-black text-amber-300"
                  : "border-white/10 bg-black text-[#A3ADBD]"
              }`}
            >
              Merchant Approval{analysis.requiresMerchantApproval ? "" : " (not required)"}
            </span>
            <span aria-hidden>→</span>
            <span className="border border-emerald-400/30 bg-black px-2 py-1 text-emerald-300">
              Execution
            </span>
          </div>

          <p className="mt-3 font-mono text-[11px] text-[#6F7A89]">
            Decision …{analysis.decisionId.slice(-8)} · analyzed in{" "}
            {analysis.latencyMs}ms · stored in AIDecision + AuditLog
          </p>
        </div>
      )}
    </div>
  );
}
