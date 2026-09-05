import { prisma } from "@/lib/db/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatINR } from "@/lib/domain/format";
import { Bell, Hourglass, MailWarning, Repeat } from "lucide-react";

export const dynamic = "force-dynamic";

const POLICY_EXPLANATIONS = [
  {
    label: "Maximum payment retries",
    description:
      "The highest number of times RecoverAI may retry a failed payment for one case. After this limit, recovery is stopped automatically — no exceptions.",
    icon: Repeat,
  },
  {
    label: "Maximum customer contact attempts",
    description:
      "How many reminders or assistance offers may be sent per case. Protects customers from spam and keeps outreach bounded.",
    icon: MailWarning,
  },
  {
    label: "Recovery window",
    description:
      "A case can only be worked on for this many hours after detection. Once the window expires, recovery stops permanently for that case.",
    icon: Hourglass,
  },
  {
    label: "Merchant approval threshold",
    description:
      "Any money-moving action on a case at or above this amount requires explicit merchant approval first. The AI cannot bypass this.",
    icon: Bell,
  },
];

export default async function PoliciesPage() {
  const policy = await prisma.recoveryPolicy.findFirst();

  const values = [
    policy ? `${policy.maxRetries} attempts` : "—",
    policy ? `${policy.maxContactAttempts} messages` : "—",
    policy ? `${policy.recoveryWindowHours} hours` : "—",
    policy ? formatINR(policy.approvalThreshold) : "—",
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Recovery Policies"
        subtitle="Deterministic controls that constrain AI-driven recovery actions. Enforced in code — never by the AI."
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {POLICY_EXPLANATIONS.map((p, i) => (
          <Card key={p.label} hover>
            <CardBody>
              <span className="inline-flex border border-[#1A1A1A] bg-black p-2 text-[#9DB1FF]">
                <p.icon className="h-4 w-4" />
              </span>
              <p className="mt-3 text-[11px] font-semibold tracking-[0.08em] text-[#6F7A89] uppercase">
                {p.label}
              </p>
              <p className="mt-1 text-[26px] font-semibold tracking-tight text-[#F7F9FC] tabular-nums">
                {values[i]}
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-[#A3ADBD]">{p.description}</p>
            </CardBody>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader
          title="How RecoverAI stays safe"
          subtitle="One direction only — the AI can never skip a step."
        />
        <CardBody>
          <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {["AI Recommendation", "Policy Validation", "Merchant Approval", "Controlled Execution", "Audit Trail"].map((s, i, arr) => (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={`border px-2.5 py-1.5 text-[12px] font-semibold ${
                    i === 2
                      ? "border-amber-400/30 bg-black text-amber-300"
                      : i >= 3
                        ? "border-emerald-400/30 bg-black text-emerald-300"
                        : "border-white/10 bg-black text-[#F7F9FC]"
                  }`}
                >
                  {s}
                </span>
                {i < arr.length - 1 && <span aria-hidden className="text-[#6F7A89]">→</span>}
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-[#171717] pt-4 text-[12.5px] leading-relaxed text-[#A3ADBD]">
            There is no code path that lets an AI response execute money movement directly.
            Policy editing is intentionally server-side only. Every evaluation, approval,
            and intervention is written to the audit trail.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
