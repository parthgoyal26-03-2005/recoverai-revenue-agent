import type { RecoveryContext } from "@/lib/ai/types";

export function makeContext(
  overrides?: Partial<RecoveryContext>
): RecoveryContext {
  return {
    generatedAt: "2026-08-24T10:00:00.000Z",
    kase: {
      id: "case_1",
      scenario: "FAILED_PAYMENT",
      status: "IN_PROGRESS",
      amountAtRiskRupees: 2499,
      currency: "INR",
      retryCount: 0,
      contactCount: 0,
      windowExpiresAt: "2026-08-27T10:00:00.000Z",
      hoursRemainingInWindow: 72,
      merchantApproved: false,
      ageHours: 2,
    },
    customerHistory: {
      successfulPayments: 8,
      failedPayments: 1,
      totalSuccessfulAmountRupees: 19992,
      activeSubscriptions: 1,
      pastDueSubscriptions: 0,
      previousAbandonedCheckouts: 0,
    },
    sourceEvent: { failureReason: "insufficient_funds" },
    previousInterventions: [],
    merchantPolicy: {
      maxRetries: 3,
      maxContactAttempts: 2,
      recoveryWindowHours: 72,
      approvalThresholdRupees: 5000,
    },
    ...overrides,
  };
}
