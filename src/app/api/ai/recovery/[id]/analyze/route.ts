import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createPrismaContextSource } from "@/lib/ai/context-builder";
import { createPrismaAIAnalysisStore, analyzeRecoveryCase } from "@/lib/ai/agent";
import { createAiProviderFromEnv } from "@/lib/ai/providers/openai-compatible";
import { MockAIProvider } from "@/lib/ai/providers/mock";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const required = process.env.INTERNAL_API_TOKEN;
  if (!required) return true;
  return request.headers.get("x-internal-token") === required;
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/ai/recovery/[id]/analyze">
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const result = await analyzeRecoveryCase(
    {
      contextSource: createPrismaContextSource(prisma),
      store: createPrismaAIAnalysisStore(prisma),
      provider: createAiProviderFromEnv() ?? new MockAIProvider(),
    },
    id
  );

  if (!result.found) {
    return NextResponse.json(
      { error: "Recovery case not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    decisionId: result.decisionId,
    provider: result.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed,
    latencyMs: result.latencyMs,
    analysis: result.analysis,
    policyValidation: result.policyValidation,
    note: "Recommendation only. No recovery action was executed. Execution requires the deterministic policy engine.",
  });
}
