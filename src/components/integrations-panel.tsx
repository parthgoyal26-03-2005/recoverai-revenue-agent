"use client";

import { useState } from "react";

type ConnectionState = {
  connected: boolean;
  mode: string;
  keyId: string | null;
  reason?: string;
};

export function IntegrationsPanel() {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(false);

  async function testConnection() {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/razorpay/test", {
        method: "POST",
      });
      const data = await res.json();
      setState(data);
    } catch {
      setState({
        connected: false,
        mode: "unknown",
        keyId: null,
        reason: "Network error — could not reach server.",
      });
    } finally {
      setLoading(false);
    }
  }

  const hasTested = state !== null;
  const badgeLabel = !hasTested
    ? "Click Test to verify"
    : state.connected
      ? "Connected"
      : "Connection Failed";
  const badgeStyle = !hasTested
    ? "bg-white/[0.05] text-[#A3ADBD] ring-white/10"
    : state.connected
      ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20"
      : "bg-red-400/10 text-red-300 ring-red-400/25";

  return (
    <section className="border border-[#1A1A1A] bg-black p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-[#F7F9FC]">
            Razorpay <span className="text-sm font-normal text-[#6F7A89]">— Test Mode</span>
          </h2>
          <p className="mt-1 text-sm text-[#A3ADBD]">
            Test Razorpay credentials and verify API connectivity. Key is always masked.
          </p>
        </div>
        <span
          className={`shrink-0 border px-2.5 py-1 text-[11.5px] font-medium ring-1 ring-inset ${badgeStyle}`}
        >
          {badgeLabel}
        </span>
      </div>

      <dl className="mt-5 space-y-2.5 text-sm">
        <div className="flex items-center justify-between border border-[#1A1A1A] bg-black px-4 py-3">
          <dt className="text-[#6F7A89]">Mode</dt>
          <dd className="font-medium text-[#F7F9FC]">
            {hasTested ? (state.mode === "test" ? "Test Mode" : state.mode) : "Test Mode (expected)"}
          </dd>
        </div>
        {hasTested && state.keyId && (
          <div className="flex items-center justify-between border border-[#1A1A1A] bg-black px-4 py-3">
            <dt className="text-[#6F7A89]">Key ID (masked)</dt>
            <dd className="font-mono text-xs text-[#A3ADBD]">{state.keyId}</dd>
          </div>
        )}
        <div className="flex items-center justify-between border border-[#1A1A1A] bg-black px-4 py-3">
          <dt className="text-[#6F7A89]">Webhook Endpoint</dt>
          <dd className="font-mono text-xs text-[#A3ADBD]">/api/webhooks/razorpay</dd>
        </div>
        <div className="flex items-center justify-between border border-[#1A1A1A] bg-black px-4 py-3">
          <dt className="text-[#6F7A89]">Webhook Events</dt>
          <dd className="font-mono text-xs text-[#A3ADBD]">payment.failed · payment_link.paid</dd>
        </div>
      </dl>

      {hasTested && state.reason && (
        <p
          className={`mt-3 border px-4 py-2 text-sm ${
            state.connected
              ? "border-emerald-400/25 bg-black text-emerald-200"
              : "border-amber-400/25 bg-black text-amber-200"
          }`}
        >
          {state.reason}
        </p>
      )}

      {!hasTested && (
        <p className="mt-3 text-xs text-[#6F7A89]">
          Secrets are never exposed. The test calls Razorpay API with your Test Mode key and reports the result.
        </p>
      )}

      <button
        type="button"
        onClick={testConnection}
        disabled={loading}
        className="mt-5 bg-[#5B7CFF] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4A6DF5] disabled:opacity-50"
      >
        {loading ? "Testing…" : hasTested ? "Test Again" : "Test Connection"}
      </button>
    </section>
  );
}
