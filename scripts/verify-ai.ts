import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const caseId = process.argv[2];
  if (!caseId) throw new Error("usage: tsx scripts/verify-ai.ts <caseId>");

  const decisions = await prisma.aIDecision.findMany({
    where: { recoveryCaseId: caseId },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  console.log(
    "AIDecisions:",
    JSON.stringify(
      decisions.map((d) => ({
        diagnosis: d.diagnosis,
        action: d.recommendedAction,
        confidence: d.confidence,
        priority: d.priority,
        merchantAttention: d.requiresMerchantAttention,
        provider: d.provider,
        model: d.model,
      })),
      null,
      2
    )
  );

  const audits = await prisma.auditLog.findMany({
    where: { recoveryCaseId: caseId, actor: "AI" },
    orderBy: { createdAt: "desc" },
    take: 2,
  });
  console.log("AI audit events:", audits.map((a) => `${a.event} policyAllowed=${(a.metadata as {policyAllowed?: boolean})?.policyAllowed}`));

  const interventions = await prisma.recoveryIntervention.count({
    where: { recoveryCaseId: caseId },
  });
  const kase = await prisma.recoveryCase.findUnique({
    where: { id: caseId },
    select: { status: true },
  });
  console.log(`Interventions for case: ${interventions} (analyze must not create any)`);
  console.log(`Case status: ${kase?.status}`);
}

main().finally(() => prisma.$disconnect());
