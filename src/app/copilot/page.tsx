import { prisma } from "@/lib/db/prisma";
import { CopilotClient, type AnalysisView } from "@/components/copilot-client";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const cases = await prisma.recoveryCase.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      customer: { select: { name: true } },
      aiDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const { formatINR } = await import("@/lib/domain/format");
  const { scenarioLabel } = await import("@/lib/domain/present");

  const caseOptions = cases.map((c) => ({
    id: c.id,
    label: `${c.customer.name} — ${scenarioLabel(c.scenario)} — ${formatINR(c.amountAtRisk)}`,
  }));

  const existingAnalyses: Record<string, AnalysisView> = {};
  for (const c of cases) {
    const d = c.aiDecisions[0];
    if (!d) continue;
    existingAnalyses[c.id] = {
      decisionId: d.id,
      customerName: c.customer.name,
      amountLabel: formatINR(c.amountAtRisk),
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
      <PageHeader
        title="AI Recovery Copilot"
        subtitle="Analyze recovery cases and generate policy-safe intervention recommendations. The AI recommends — policy decides."
      />

      {caseOptions.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No recovery cases found"
          body="Seed the database first — copilot analyses will appear here."
        />
      ) : (
        <CopilotClient cases={caseOptions} existingAnalyses={existingAnalyses} />
      )}
    </div>
  );
}
