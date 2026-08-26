import { z } from "zod";
import { RECOVERY_ACTIONS } from "@/lib/domain/types";

export const DIAGNOSES = [
  "temporary_payment_failure",
  "repeated_payment_failure",
  "high_value_payment_risk",
  "checkout_abandonment",
  "failed_subscription_payment",
  "repeated_subscription_failure",
  "recovery_window_expired",
  "insufficient_recovery_context",
] as const;

export type DiagnosisType = (typeof DIAGNOSES)[number];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const recoveryAnalysisSchema = z.object({
  diagnosis: z.enum(DIAGNOSES),
  riskLevel: z.enum(RISK_LEVELS),
  recommendedAction: z.enum(RECOVERY_ACTIONS),
  priority: z.enum(PRIORITIES),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(10).max(1000),
  requiresMerchantAttention: z.boolean(),
});

export type RecoveryAnalysis = z.infer<typeof recoveryAnalysisSchema>;

export type RecoveryContext = {
  generatedAt: string;
  kase: {
    id: string;
    scenario: string;
    status: string;
    amountAtRiskRupees: number;
    currency: string;
    retryCount: number;
    contactCount: number;
    windowExpiresAt: string;
    hoursRemainingInWindow: number;
    merchantApproved: boolean;
    ageHours: number;
  };
  customerHistory: {
    successfulPayments: number;
    failedPayments: number;
    totalSuccessfulAmountRupees: number;
    activeSubscriptions: number;
    pastDueSubscriptions: number;
    previousAbandonedCheckouts: number;
  };
  sourceEvent: {
    failureReason?: string;
    cartSummary?: string;
    planName?: string;
    subscriptionRetryCount?: number;
  };
  previousInterventions: {
    action: string;
    status: string;
    result?: string;
    recoveredAmountRupees: number;
  }[];
  merchantPolicy: {
    maxRetries: number;
    maxContactAttempts: number;
    recoveryWindowHours: number;
    approvalThresholdRupees: number;
  };
};

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyzeRecoveryCase(context: RecoveryContext): Promise<RecoveryAnalysis>;
}
