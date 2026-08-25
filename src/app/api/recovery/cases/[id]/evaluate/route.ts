import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createPrismaStore } from "@/lib/recovery/store";
import { evaluateCase } from "@/lib/recovery/orchestrator";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/recovery/cases/[id]/evaluate">
) {
  const { id } = await ctx.params;
  const store = createPrismaStore(prisma);
  const result = await evaluateCase(store, id, { persistAudit: true });

  if (!result.found) {
    return NextResponse.json({ error: "Recovery case not found." }, { status: 404 });
  }

  return NextResponse.json({
    caseId: result.caseId,
    scenario: result.scenario,
    amountAtRiskPaise: result.amountAtRiskPaise,
    caseStatus: result.caseStatus,
    policyConfig: result.config,
    eligibility: {
      eligible: result.policy!.eligible,
      reason: result.policy!.summaryReason,
      allowedActions: result.policy!.allowedActions,
      retriesRemaining: result.policy!.retriesRemaining,
      contactsRemaining: result.policy!.contactsRemaining,
      requiresApproval: result.policy!.requiresApproval,
      windowExpired: result.policy!.windowExpired,
    },
    permissions: result.policy!.permissions,
  });
}
