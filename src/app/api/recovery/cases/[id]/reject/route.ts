import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createPrismaStore } from "@/lib/recovery/store";
import { rejectCase } from "@/lib/recovery/orchestrator";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/recovery/cases/[id]/reject">
) {
  const { id } = await ctx.params;

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason = body.reason?.trim() || "Merchant declined this recovery.";

  const store = createPrismaStore(prisma);
  const result = await rejectCase(store, id, reason);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "Recovery case not found." ? 404 : 409 }
    );
  }

  return NextResponse.json({ ok: true, caseId: id, rejected: true, reason });
}
