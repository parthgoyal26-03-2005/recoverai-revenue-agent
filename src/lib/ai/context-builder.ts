import type { RecoveryContext } from "@/lib/ai/types";
import { DEFAULT_POLICY } from "@/lib/domain/types";
import type { PrismaClient } from "@/generated/prisma/client";

export interface ContextSource {
  loadContext(caseId: string): Promise<RecoveryContext | null>;
}

export function createPrismaContextSource(prisma: PrismaClient): ContextSource {
  return {
    async loadContext(caseId) {
      const recoveryCase = await prisma.recoveryCase.findUnique({
        where: { id: caseId },
        include: {
          customer: true,
          merchant: {
            select: {
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
          transaction: {
            select: { failureReason: true },
          },
          checkoutSession: {
            select: { cartSummary: true },
          },
          subscription: {
            select: { planName: true, retryCount: true },
          },
        },
      });
      if (!recoveryCase) return null;

      const [capturedAgg, failedCount, activeSubs, pastDueSubs, abandonedCount, interventions] =
        await Promise.all([
          prisma.transaction.aggregate({
            where: { customerId: recoveryCase.customerId, status: "CAPTURED" },
            _count: { _all: true },
            _sum: { amount: true },
          }),
          prisma.transaction.count({
            where: { customerId: recoveryCase.customerId, status: "FAILED" },
          }),
          prisma.subscription.count({
            where: { customerId: recoveryCase.customerId, status: "ACTIVE" },
          }),
          prisma.subscription.count({
            where: { customerId: recoveryCase.customerId, status: "PAST_DUE" },
          }),
          prisma.checkoutSession.count({
            where: {
              customerId: recoveryCase.customerId,
              status: "ABANDONED",
              id: { not: recoveryCase.checkoutSessionId ?? undefined },
            },
          }),
          prisma.recoveryIntervention.findMany({
            where: { recoveryCaseId: recoveryCase.id },
            orderBy: { createdAt: "asc" },
            select: {
              action: true,
              status: true,
              result: true,
              recoveredAmount: true,
            },
          }),
        ]);

      const now = new Date();
      const hoursRemaining = Math.floor(
        (recoveryCase.windowExpiresAt.getTime() - now.getTime()) / 3_600_000
      );

      return {
        generatedAt: now.toISOString(),
        kase: {
          id: recoveryCase.id,
          scenario: recoveryCase.scenario,
          status: recoveryCase.status,
          amountAtRiskRupees: recoveryCase.amountAtRisk / 100,
          currency: "INR",
          retryCount: recoveryCase.retryCount,
          contactCount: recoveryCase.contactCount,
          windowExpiresAt: recoveryCase.windowExpiresAt.toISOString(),
          hoursRemainingInWindow: hoursRemaining,
          merchantApproved: recoveryCase.merchantApproved,
          ageHours: Math.max(
            0,
            Math.floor((now.getTime() - recoveryCase.createdAt.getTime()) / 3_600_000)
          ),
        },
        customerHistory: {
          successfulPayments: capturedAgg._count._all,
          failedPayments: failedCount,
          totalSuccessfulAmountRupees: (capturedAgg._sum.amount ?? 0) / 100,
          activeSubscriptions: activeSubs,
          pastDueSubscriptions: pastDueSubs,
          previousAbandonedCheckouts: abandonedCount,
        },
        sourceEvent: {
          failureReason: recoveryCase.transaction?.failureReason ?? undefined,
          cartSummary: recoveryCase.checkoutSession?.cartSummary ?? undefined,
          planName: recoveryCase.subscription?.planName ?? undefined,
          subscriptionRetryCount: recoveryCase.subscription?.retryCount ?? undefined,
        },
        previousInterventions: interventions.map((iv) => ({
          action: iv.action,
          status: iv.status,
          result: iv.result ?? undefined,
          recoveredAmountRupees: iv.recoveredAmount / 100,
        })),
        merchantPolicy: recoveryCase.merchant.policy
          ? {
              maxRetries: recoveryCase.merchant.policy.maxRetries,
              maxContactAttempts: recoveryCase.merchant.policy.maxContactAttempts,
              recoveryWindowHours: recoveryCase.merchant.policy.recoveryWindowHours,
              approvalThresholdRupees:
                recoveryCase.merchant.policy.approvalThreshold / 100,
            }
          : {
              maxRetries: DEFAULT_POLICY.maxRetries,
              maxContactAttempts: DEFAULT_POLICY.maxContactAttempts,
              recoveryWindowHours: DEFAULT_POLICY.recoveryWindowHours,
              approvalThresholdRupees:
                DEFAULT_POLICY.approvalThresholdPaise / 100,
            },
      };
    },
  };
}
