import { prisma } from "@/lib/db/prisma";
import { formatINR } from "@/lib/domain/format";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const policy = await prisma.recoveryPolicy.findFirst();

  const rows = [
    { label: "Maximum payment retries", value: policy ? `${policy.maxRetries} attempts` : "—" },
    { label: "Maximum customer contact attempts", value: policy ? `${policy.maxContactAttempts} messages` : "—" },
    { label: "Recovery window", value: policy ? `${policy.recoveryWindowHours} hours` : "—" },
    { label: "Merchant approval threshold", value: policy ? formatINR(policy.approvalThreshold) : "—" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Recovery Policies</h1>
        <p className="text-sm text-slate-500">
          Deterministic limits enforced by the backend — the AI can never override these
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <dl className="divide-y divide-slate-100">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between py-4">
              <dt className="text-sm font-medium text-slate-700">{row.label}</dt>
              <dd className="text-sm font-semibold text-slate-900">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-slate-400">
          Policy editing will be enabled when the policy engine is implemented.
        </p>
      </div>
    </div>
  );
}
