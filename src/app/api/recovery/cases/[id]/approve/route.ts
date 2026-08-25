import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createPrismaStore } from "@/lib/recovery/store";
import { approveCase } from "@/lib/recovery/orchestrator";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/recovery/cases/[id]/approve">
) {
  const { id } = await ctx.params;
  const store = createPrismaStore(prisma);
  const result = await approveCase(store, id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "Recovery case not found." ? 404 : 409 }
    );
  }

  return NextResponse.json({ ok: true, caseId: id, approved: true });
}
