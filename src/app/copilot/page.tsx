import { prisma } from "@/lib/db/prisma";
import { CopilotClient, type AnalysisView } from "@/components/copilot-client";

export const dynamic = "force-dynamic";

const SCENARIO_LABELS: Record<string, string> = {
  FAILED_PAYMENT: "Failed Payment",
  CHECKOUT_ABANDONMENT: "Checkout Abandonment",
  SUBSCRIPTION_FAILURE: "Subscription Failure",
};

export default async function CopilotPage() {
  const cases = await prisma.recoveryCase.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      customer: { select: { name: true } },
      aiDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const caseOptions = cases.map((c) => ({
    id: c.id,
    label: `${c.customer.name} — ${SCENARIO_LABELS[c.scenario] ?? c.scenario} — ₹${(c.amountAtRisk / 100).toLocaleString("en-IN")} (${c.status.toLowerCase()})`,
  }));

  const existingAnalyses: Record<string, AnalysisView> = {};
  for (const c of cases) {
    const d = c.aiDecisions[0];
    if (!d) continue;
    existingAnalyses[c.id] = {
      decisionId: d.id,
      customerName: c.customer.name,
      amountLabel: `₹${(c.amountAtRisk / 100).toLocaleString("en-IN")}`,
      diagnosis: d.diagnosis,
      riskLevel: d.riskLevel,
      recommendedAction: d.recommendedAction,
      confidence: d.confidence,
      reasoning: d.reasoning,
      requiresMerchantAttention: d.requiresMerchantAttention,
      provider: d.provider,
      model: d.model,
      fallbackUsed: d.provider.includes("mock"),
      latencyMs: d.latencyMs,
      policyAllowedByPolicy: true,
      policyReason:
        "Loaded from stored decision; run Analyze to re-validate against current policy.",
      requiresMerchantApproval: d.requiresMerchantAttention,
    };
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">AI Copilot</h1>
        <p className="text-sm text-slate-500">
          AI diagnosis and recovery recommendations — validated by the
          deterministic policy engine before anything can execute
        </p>
      </div>

      {caseOptions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
          No recovery cases found. Seed the database first.
        </div>
      ) : (
        <CopilotClient cases={caseOptions} existingAnalyses={existingAnalyses} />
      )}
    </div>
  );
}
