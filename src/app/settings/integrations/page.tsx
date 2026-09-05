import { CreditCard, Cpu } from "lucide-react";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

function currentAi(): { label: string; model: string; isMock: boolean } {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (selected === "gemini" && process.env.GEMINI_API_KEY)
    return { label: "Gemini", model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash", isMock: false };
  if (selected === "groq" && process.env.GROQ_API_KEY)
    return { label: "Groq", model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile", isMock: false };
  if (!selected && process.env.GEMINI_API_KEY)
    return { label: "Gemini", model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash", isMock: false };
  if (!selected && process.env.GROQ_API_KEY)
    return { label: "Groq", model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile", isMock: false };
  if (selected === "gemini")
    return { label: "Gemini", model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash", isMock: false };
  if (selected === "groq")
    return { label: "Groq", model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile", isMock: false };
  return { label: "Mock", model: "mock-rules-v1", isMock: true };
}

function currentRecovery(): { label: string; isRazorpay: boolean } {
  const selected = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (selected === "razorpay") return { label: "Razorpay Test", isRazorpay: true };
  return { label: "Simulation", isRazorpay: false };
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
  const ai = currentAi();
  const recovery = currentRecovery();
  const razorpayConfigured = isRazorpayConfigured();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Integrations"
        subtitle="External providers connected to RecoverAI. Test Mode only — no live payments."
      />

      <IntegrationsPanel />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Razorpay" subtitle="Test Mode" />
          <CardBody className="space-y-2.5 pt-4 text-[13px]">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex border border-[#1A1A1A] bg-black p-1.5 text-[#9DB1FF]">
                <CreditCard className="h-4 w-4" />
              </span>
              <span
                className={`border px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${
                  razorpayConfigured
                    ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20"
                    : "bg-white/[0.05] text-[#A3ADBD] ring-white/10"
                }`}
              >
                {razorpayConfigured ? "Configured ✓" : "Not configured"}
              </span>
            </div>
            {[
              ["Connection", "Use Test Connection above"],
              ["Payment provider", recovery.isRazorpay ? "Razorpay Test" : "Simulation"],
              ["Webhook", "/api/webhooks/razorpay"],
              ["Events", "payment.failed · payment_link.paid"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border border-[#1A1A1A] bg-black px-3.5 py-2.5">
                <dt className="text-[#6F7A89]">{k}</dt>
                <dd className="font-mono text-[12px] text-[#A3ADBD]">{v}</dd>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="AI Provider" subtitle="Diagnosis + recommendations" />
          <CardBody className="space-y-2.5 pt-4 text-[13px]">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex border border-[#1A1A1A] bg-black p-1.5 text-[#9DB1FF]">
                <Cpu className="h-4 w-4" />
              </span>
              <span
                className={`border px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${
                  ai.isMock
                    ? "bg-amber-400/10 text-amber-300 ring-amber-400/25"
                    : "bg-[#5B7CFF]/10 text-[#9DB1FF] ring-[#5B7CFF]/25"
                }`}
              >
                {ai.isMock ? "Mock" : ai.label}
              </span>
            </div>
            {[
              ["Provider", ai.isMock ? "Mock (deterministic)" : ai.label],
              ["Model", ai.model],
              ["Status", ai.isMock ? "Always available" : "Configured via env"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border border-[#1A1A1A] bg-black px-3.5 py-2.5">
                <dt className="text-[#6F7A89]">{k}</dt>
                <dd className="font-mono text-[12px] text-[#A3ADBD]">{v}</dd>
              </div>
            ))}
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Simulation mode"
          subtitle="Built-in deterministic provider for safe demos."
        />
        <CardBody className="pt-4 text-[13px] leading-relaxed text-[#A3ADBD]">
          <p>
            When <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[12px] text-[#F7F9FC]">PAYMENT_PROVIDER=simulation</code>,
            all recovery actions use simulated outcomes — no real payments are attempted. Set{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[12px] text-[#F7F9FC]">PAYMENT_PROVIDER=razorpay</code>{" "}
            to create real Razorpay Test Mode payment links for failed-payment cases.
          </p>
          <p className="mt-2">
            Webhook signatures are verified via{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[12px] text-[#F7F9FC]">x-razorpay-signature</code>{" "}
            (HMAC-SHA256). Key secrets and webhook secrets are never exposed in the UI.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
