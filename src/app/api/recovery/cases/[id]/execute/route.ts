import { NextResponse } from "next/server";
import { RECOVERY_ACTIONS, type ActionType } from "@/lib/domain/types";
import { prisma } from "@/lib/db/prisma";
import { createPrismaStore } from "@/lib/recovery/store";
import { executeCaseAction } from "@/lib/recovery/orchestrator";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/recovery/cases/[id]/execute">
) {
  const { id } = await ctx.params;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = body.action as ActionType | undefined;
  if (!action || !RECOVERY_ACTIONS.includes(action)) {
    return NextResponse.json(
      {
        error: `Invalid action. Must be one of: ${RECOVERY_ACTIONS.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const store = createPrismaStore(prisma);
  const outcome = await executeCaseAction(store, id, action);

  if (!outcome.ok && outcome.status === 404) {
    return NextResponse.json({ error: outcome.error }, { status: 404 });
  }

  if (!outcome.ok) {
    return NextResponse.json(
      {
        error: outcome.error,
        message: outcome.message,
        ...(outcome.paymentLinkId ? { paymentLinkId: outcome.paymentLinkId } : {}),
        ...(outcome.paymentLinkUrl ? { paymentLinkUrl: outcome.paymentLinkUrl } : {}),
        policyDecision: outcome.policy
          ? {
              allowedActions: outcome.policy.allowedActions,
              summaryReason: outcome.policy.summaryReason,
              permissions: outcome.policy.permissions,
            }
          : undefined,
      },
      { status: outcome.status }
    );
  }

  return NextResponse.json({
    ok: true,
    caseId: id,
    action: outcome.action,
    caseStatus: outcome.caseStatus,
    recoveredAmountPaise: outcome.recoveredAmountPaise,
    messages: outcome.messages,
    notes: outcome.outcome.notes,
    ...(outcome.outcome.errorCode ? { providerError: outcome.outcome.errorCode } : {}),
  });
}
