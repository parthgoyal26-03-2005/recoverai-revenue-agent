import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_POLICY } from "@/lib/domain/types";
import { evaluatePolicy } from "@/lib/policy/engine";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import {
  recoveryAnalysisSchema,
  type AIProvider,
  type RecoveryAnalysis,
} from "@/lib/ai/types";
import type { ContextSource } from "@/lib/ai/context-builder";
import type { CaseWithRelations } from "@/lib/recovery/store";

export interface AIAnalysisStore {
  getCase(id: string): Promise<CaseWithRelations | null>;
  createAIDecision(data: NewAIDecisionData): Promise<{ id: string }>;
  createAuditLog(data: AIAuditLogData): Promise<void>;
}

export type NewAIDecisionData = {
  recoveryCaseId: string;
  diagnosis: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  recommendedAction: RecoveryAnalysis["recommendedAction"];
  confidence: number;
  reasoning: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requiresMerchantAttention: boolean;
  provider: string;
  model: string;
  latencyMs: number;
};

export type AIAuditLogData = {
  recoveryCaseId: string;
  event: string;
  actor: "SYSTEM" | "AI" | "POLICY_ENGINE" | "MERCHANT";
  metadata: Prisma.InputJsonObject;
};

export function createPrismaAIAnalysisStore(prisma: PrismaClient): AIAnalysisStore {
  return {
    getCase(id) {
      return prisma.recoveryCase.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          merchant: {
            select: {
              id: true,
              name: true,
              policy: {
                select: {
                  maxRetries: true,
                  maxContactAttempts: true,
                  recoveryWindowHours: true,
                  approvalThreshold: true,
                },
              },
            },
          },
        },
      }) as Promise<CaseWithRelations | null>;
    },
    createAIDecision(data) {
      return prisma.aIDecision.create({ data });
    },
    async createAuditLog(data) {
      await prisma.auditLog.create({ data });
    },
  };
}

export type PolicyValidation = {
  actionRecommended: RecoveryAnalysis["recommendedAction"];
  allowedByPolicy: boolean;
  reason: string;
  allowedActions: string[];
};

export type AnalysisResult =
  | { found: false }
  | {
      found: true;
      decisionId: string;
      analysis: RecoveryAnalysis;
      provider: string;
      model: string;
      fallbackUsed: boolean;
      latencyMs: number;
      policyValidation: PolicyValidation;
    };

function policyConfigFromCase(recoveryCase: CaseWithRelations) {
  const p = recoveryCase.merchant.policy;
  if (!p) return DEFAULT_POLICY;
  return {
    maxRetries: p.maxRetries,
    maxContactAttempts: p.maxContactAttempts,
    recoveryWindowHours: p.recoveryWindowHours,
    approvalThresholdPaise: p.approvalThreshold,
  };
}

export type AnalyzeDeps = {
  contextSource: ContextSource;
  store: AIAnalysisStore;
  provider: AIProvider;
};

export async function analyzeRecoveryCase(
  deps: AnalyzeDeps,
  caseId: string
): Promise<AnalysisResult> {
  const context = await deps.contextSource.loadContext(caseId);
  if (!context) return { found: false };

  const startedAt = Date.now();
  let analysis: RecoveryAnalysis;
  let fallbackUsed = false;
  try {
    analysis = await deps.provider.analyzeRecoveryCase(context);
  } catch {
    analysis = await new MockAIProvider().analyzeRecoveryCase(context);
    fallbackUsed = true;
  }

  const validated = recoveryAnalysisSchema.parse(analysis);
  const latencyMs = Date.now() - startedAt;

  const recoveryCase = await deps.store.getCase(caseId);
  let policyValidation: PolicyValidation;
  if (!recoveryCase) {
    policyValidation = {
      actionRecommended: validated.recommendedAction,
      allowedByPolicy: false,
      reason: "Recovery case no longer exists.",
      allowedActions: [],
    };
  } else {
    const evaluation = evaluatePolicy(
      {
        scenario: recoveryCase.scenario,
        amountAtRiskPaise: recoveryCase.amountAtRisk,
        retryCount: recoveryCase.retryCount,
        contactCount: recoveryCase.contactCount,
        windowExpiresAt: recoveryCase.windowExpiresAt,
        merchantApproved: recoveryCase.merchantApproved,
      },
      policyConfigFromCase(recoveryCase)
    );
    const permission = evaluation.permissions.find(
      (p) => p.action === validated.recommendedAction
    );
    policyValidation = {
      actionRecommended: validated.recommendedAction,
      allowedByPolicy: permission?.allowed ?? false,
      reason:
        permission?.reason ??
        `${validated.recommendedAction} is not a supported action for this scenario.`,
      allowedActions: evaluation.allowedActions,
    };
  }

  const saved = await deps.store.createAIDecision({
    recoveryCaseId: caseId,
    diagnosis: validated.diagnosis,
    riskLevel: validated.riskLevel,
    recommendedAction: validated.recommendedAction,
    confidence: validated.confidence,
    reasoning: validated.reasoning,
    priority: validated.priority,
    requiresMerchantAttention: validated.requiresMerchantAttention,
    provider: fallbackUsed ? `${deps.provider.name}+mock-fallback` : deps.provider.name,
    model: fallbackUsed ? "mock-rules-v1" : deps.provider.model,
    latencyMs,
  });

  await deps.store.createAuditLog({
    recoveryCaseId: caseId,
    event: "AI_ANALYSIS_COMPLETED",
    actor: "AI",
    metadata: {
      diagnosis: validated.diagnosis,
      recommendedAction: validated.recommendedAction,
      riskLevel: validated.riskLevel,
      confidence: validated.confidence,
      requiresMerchantAttention: validated.requiresMerchantAttention,
      provider: fallbackUsed ? "mock-fallback" : deps.provider.name,
      model: fallbackUsed ? "mock-rules-v1" : deps.provider.model,
      policyAllowed: policyValidation.allowedByPolicy,
      policyReason: policyValidation.reason,
    },
  });

  return {
    found: true,
    decisionId: saved.id,
    analysis: validated,
    provider: fallbackUsed ? "mock-fallback" : deps.provider.name,
    model: fallbackUsed ? "mock-rules-v1" : deps.provider.model,
    fallbackUsed,
    latencyMs,
    policyValidation,
  };
}
