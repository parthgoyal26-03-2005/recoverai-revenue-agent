import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createPrismaStore } from "@/lib/recovery/store";
import { processDueActions } from "@/lib/recovery/orchestrator";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = createPrismaStore(prisma);
  const result = await processDueActions(store);
  return NextResponse.json({
    ok: true,
    processed: result.processed,
    message:
      result.processed === 0
        ? "No scheduled interventions are due."
        : `Processed ${result.processed} scheduled intervention(s).`,
  });
}
