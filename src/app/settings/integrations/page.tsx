import { IntegrationsPanel } from "@/components/integrations-panel";

export const dynamic = "force-dynamic";

export default function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500">
          Connect external payment providers to RecoverAI.
        </p>
      </div>
      <IntegrationsPanel />
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Simulation Mode</h2>
        <p className="mt-2 text-sm text-slate-600">
          RecoverAI includes a built-in simulation provider for demo purposes.
          All recovery actions use simulated outcomes — no real payments are attempted.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          When Razorpay is connected, real <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">payment.failed</code> webhooks will appear as new recovery cases in the dashboard.
        </p>
      </section>
    </div>
  );
}
