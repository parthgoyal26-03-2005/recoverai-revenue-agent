import { IntegrationsPanel } from "@/components/integrations-panel";

export const dynamic = "force-dynamic";

function currentAiLabel(): string {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (selected === "gemini" && process.env.GEMINI_API_KEY) return "Gemini";
  if (selected === "groq" && process.env.GROQ_API_KEY) return "Groq";
  if (!selected && process.env.GEMINI_API_KEY) return "Gemini";
  if (!selected && process.env.GROQ_API_KEY) return "Groq";
  if (selected === "gemini") return "Gemini";
  if (selected === "groq") return "Groq";
  return "Mock";
}

function currentRecoveryLabel(): string {
  const selected = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (selected === "razorpay") return "Razorpay Test Mode";
  return "Simulation Mode";
}

function isRazorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() &&
    process.env.RAZORPAY_KEY_SECRET?.trim() &&
    process.env.RAZORPAY_WEBHOOK_SECRET?.trim() &&
    process.env.RAZORPAY_MERCHANT_ID?.trim()
  );
}

export default function IntegrationsPage() {
  const aiLabel = currentAiLabel();
  const recoveryLabel = currentRecoveryLabel();
  const razorpayConfigured = isRazorpayConfigured();
  const isMock = aiLabel === "Mock";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500">
          RecoverAI in Razorpay Test Mode — no live payments. All recovery
          payments use Razorpay Test Mode payment links.
        </p>
      </div>

      <IntegrationsPanel />

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">
          Current Configuration
        </h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <dt className="text-slate-500">Razorpay</dt>
            <dd className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Test Mode</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                  razorpayConfigured
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {razorpayConfigured ? "Configured" : "Not Configured"}
              </span>
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <dt className="text-slate-500">Payment Provider</dt>
            <dd
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                recoveryLabel === "Razorpay Test Mode"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {recoveryLabel === "Razorpay Test Mode" ? "Razorpay Test" : "Simulation"}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <dt className="text-slate-500">AI</dt>
            <dd
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                isMock
                  ? "bg-amber-100 text-amber-700"
                  : "bg-violet-100 text-violet-700"
              }`}
            >
              {isMock ? "Mock" : aiLabel}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <dt className="text-slate-500">Webhook Endpoint</dt>
            <dd className="font-mono text-xs text-slate-700">/api/webhooks/razorpay</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-slate-400">
          Webhook receives <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">payment.failed</code> and{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">payment_link.paid</code> events.
          Signature verified via <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">x-razorpay-signature</code> (HMAC-SHA256).
          Secrets are never exposed in the UI.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Simulation Mode</h2>
        <p className="mt-2 text-sm text-slate-600">
          RecoverAI includes a built-in simulation provider for demo purposes.
          When <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">PAYMENT_PROVIDER=simulation</code>, all recovery actions use
          simulated outcomes — no real payments are attempted. Set{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">PAYMENT_PROVIDER=razorpay</code> to create real Razorpay Test Mode
          payment links for failed-payment cases.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          When Razorpay is connected, real{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">payment.failed</code> webhooks appear as new recovery cases in the
          dashboard. Click “Test Connection” above to verify your Razorpay Test Mode credentials.
        </p>
      </section>
    </div>
  );
}
