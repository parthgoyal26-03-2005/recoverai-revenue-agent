import { prisma } from "@/lib/db/prisma";
import { formatINR } from "@/lib/domain/format";

export const dynamic = "force-dynamic";

const POLICY_EXPLANATIONS = [
  {
    label: "Maximum payment retries",
    description:
      "The highest number of times RecoverAI may retry a failed payment for one case. After this limit, recovery is stopped automatically — no exceptions.",
  },
  {
    label: "Maximum customer contact attempts",
    description:
      "How many reminders or assistance offers may be sent per case. Protects customers from spam and keeps outreach bounded.",
  },
  {
    label: "Recovery window",
    description:
      "A case can only be worked on for this many hours after detection. Once the window expires, recovery stops permanently for that case.",
  },
  {
    label: "Merchant approval threshold",
    description:
      "Any money-moving action on a case at or above this amount requires explicit merchant approval first. The AI cannot bypass this.",
  },
];

export default async function PoliciesPage() {
  const policy = await prisma.recoveryPolicy.findFirst();

  const rows = [
    {
      label: POLICY_EXPLANATIONS[0].label,
      description: POLICY_EXPLANATIONS[0].description,
      value: policy ? `${policy.maxRetries} attempts` : "—",
    },
    {
      label: POLICY_EXPLANATIONS[1].label,
      description: POLICY_EXPLANATIONS[1].description,
      value: policy ? `${policy.maxContactAttempts} messages` : "—",
    },
    {
      label: POLICY_EXPLANATIONS[2].label,
      description: POLICY_EXPLANATIONS[2].description,
      value: policy ? `${policy.recoveryWindowHours} hours` : "—",
    },
    {
      label: POLICY_EXPLANATIONS[3].label,
      description: POLICY_EXPLANATIONS[3].description,
      value: policy ? formatINR(policy.approvalThreshold) : "—",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Recovery Policies</h1>
        <p className="text-sm text-slate-500">
          Deterministic limits enforced by backend code — never by the AI
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <dl className="divide-y divide-slate-100">
          {rows.map((row) => (
            <div key={row.label} className="py-4">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-sm font-medium text-slate-700">{row.label}</dt>
                <dd className="text-sm font-bold whitespace-nowrap text-slate-900">
                  {row.value}
                </dd>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {row.description}
              </p>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-sm font-semibold text-emerald-900">
          How these policies bound the AI
        </h2>
        <ol className="mt-3 space-y-2 text-sm text-emerald-800">
          <li className="flex items-center gap-2">
            <span className="rounded bg-white px-2 py-1 text-xs font-semibold shadow-sm">
              AI recommends
            </span>
            The AI agent only produces a structured suggestion (diagnosis + action).
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded bg-white px-2 py-1 text-xs font-semibold shadow-sm">
              Policy validates
            </span>
            Every recommendation is checked against the four limits above by
            deterministic code.
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white shadow-sm">
              Allowed
            </span>
            <span className="rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-white shadow-sm">
              Approval
            </span>
            <span className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white shadow-sm">
              Blocked
            </span>
            Only allowed actions reach the recovery engine — high-value cases wait
            for merchant approval, everything else is blocked with a reason.
          </li>
        </ol>
        <p className="mt-3 border-t border-emerald-200 pt-3 text-xs text-emerald-700">
          There is no code path that lets an AI response execute money movement
          directly. Policy editing is intentionally server-side only; changes
          require redeployment-safe validation before they take effect.
        </p>
      </div>
    </div>
  );
}
