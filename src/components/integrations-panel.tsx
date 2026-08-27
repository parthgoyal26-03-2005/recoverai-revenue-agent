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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Razorpay</h2>
          <p className="mt-1 text-sm text-slate-500">
            Connect your Razorpay Test Mode account to receive real payment failure webhooks.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase ${
            state?.connected
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {state?.connected ? "Connected" : "Not Configured"}
        </span>
      </div>

      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
          <dt className="text-slate-500">Mode</dt>
          <dd className="font-medium text-slate-900">
            {state?.mode === "test" ? "Test Mode" : state?.mode ?? "—"}
          </dd>
        </div>
        {state?.keyId && (
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <dt className="text-slate-500">Key</dt>
            <dd className="font-mono text-xs text-slate-700">{state.keyId}</dd>
          </div>
        )}
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
          <dt className="text-slate-500">Webhook URL</dt>
          <dd className="font-mono text-xs text-slate-700">
            /api/webhooks/razorpay
          </dd>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
          <dt className="text-slate-500">Required Event</dt>
          <dd className="font-mono text-xs text-slate-700">payment.failed</dd>
        </div>
      </dl>

      {state?.reason && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {state.reason}
        </p>
      )}

      <button
        type="button"
        onClick={testConnection}
        disabled={loading}
        className="mt-5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? "Testing…" : "Test Connection"}
      </button>
    </section>
  );
}
