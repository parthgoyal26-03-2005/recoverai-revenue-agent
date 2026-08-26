import type { ActionType } from "@/lib/domain/types";
import type { AIProvider, RecoveryAnalysis, RecoveryContext } from "@/lib/ai/types";

export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "mock-rules-v1";

  async analyzeRecoveryCase(context: RecoveryContext): Promise<RecoveryAnalysis> {
    return mockAnalyze(context);
  }
}

async function mockAnalyze(context: RecoveryContext): Promise<RecoveryAnalysis> {
  const { kase, customerHistory } = context;
  const amount = kase.amountAtRiskRupees;
  const threshold = context.merchantPolicy.approvalThresholdRupees;
  const retriesLeft =
    context.merchantPolicy.maxRetries - kase.retryCount;
  const contactsLeft =
    context.merchantPolicy.maxContactAttempts - kase.contactCount;
  const healthyHistory = customerHistory.successfulPayments >= 3;

  let action: ActionType = "SCHEDULE_RETRY";
  let diagnosis: RecoveryAnalysis["diagnosis"] = "insufficient_recovery_context";
  let riskLevel: RecoveryAnalysis["riskLevel"] = "MEDIUM";
  let priority: RecoveryAnalysis["priority"] = "MEDIUM";
  let confidence = 0.7;
  let attention = false;
  let reasoning: string;

  if (kase.hoursRemainingInWindow <= 0) {
    diagnosis = "recovery_window_expired";
    action = "STOP_RECOVERY";
    riskLevel = "HIGH";
    confidence = 0.99;
    attention = true;
    reasoning = `Recovery window expired ${Math.abs(kase.hoursRemainingInWindow)}h ago; policy requires recovery to stop.`;
  } else if (amount >= threshold) {
    diagnosis = "high_value_payment_risk";
    action = "ESCALATE_TO_MERCHANT";
    riskLevel = "HIGH";
    priority = "CRITICAL";
    confidence = 0.93;
    attention = true;
    reasoning = `Amount at risk (₹${amount}) meets or exceeds the merchant approval threshold (₹${threshold}); merchant approval is required before money-moving actions.`;
  } else {
    switch (kase.scenario) {
      case "FAILED_PAYMENT": {
        if (retriesLeft <= 0) {
          diagnosis = "repeated_payment_failure";
          action = "STOP_RECOVERY";
          riskLevel = "HIGH";
          confidence = 0.95;
          attention = true;
          reasoning = `All ${context.merchantPolicy.maxRetries} retry attempts have been used; no further payment retries are permitted.`;
        } else if (
          customerHistory.failedPayments >= 3 ||
          kase.retryCount >= 2
        ) {
          diagnosis = "repeated_payment_failure";
          action = "RETRY_PAYMENT";
          riskLevel = "MEDIUM";
          priority = "HIGH";
          confidence = 0.78;
          reasoning = `Customer has ${customerHistory.failedPayments} failed payments and this case is on attempt ${kase.retryCount + 1}; success probability is lower but one retry remains within limits.`;
        } else if (healthyHistory) {
          diagnosis = "temporary_payment_failure";
          action = "RETRY_PAYMENT";
          riskLevel = "LOW";
          priority = "MEDIUM";
          confidence = 0.9;
          reasoning = `Customer has ${customerHistory.successfulPayments} successful payments totalling ₹${customerHistory.totalSuccessfulAmountRupees} and this failure looks temporary; a direct retry has good odds (${retriesLeft} retries left).`;
        } else {
          diagnosis = "temporary_payment_failure";
          action = "SCHEDULE_RETRY";
          riskLevel = "LOW";
          confidence = 0.72;
          reasoning = `Limited history (${customerHistory.successfulPayments} successful payments); scheduling a retry is safer than an immediate retry.`;
        }
        break;
      }
      case "CHECKOUT_ABANDONMENT": {
        if (contactsLeft <= 0) {
          diagnosis = "checkout_abandonment";
          action = "STOP_RECOVERY";
          riskLevel = "MEDIUM";
          confidence = 0.94;
          attention = false;
          reasoning = `Contact limit of ${context.merchantPolicy.maxContactAttempts} reached; further reminders would violate the contact policy.`;
        } else {
          diagnosis = "checkout_abandonment";
          action = "SEND_REMINDER";
          riskLevel = "LOW";
          priority = amount >= 2000 ? "HIGH" : "MEDIUM";
          confidence = 0.85;
          reasoning = `Cart of ₹${amount}${context.sourceEvent.cartSummary ? ` (${context.sourceEvent.cartSummary})` : ""} abandoned with purchase intent shown; reminder is allowed (${contactsLeft} contact(s) left).`;
        }
        break;
      }
      case "SUBSCRIPTION_FAILURE": {
        if (retriesLeft <= 0) {
          diagnosis = "repeated_subscription_failure";
          action = "ESCALATE_TO_MERCHANT";
          riskLevel = "HIGH";
          priority = "HIGH";
          confidence = 0.88;
          attention = true;
          reasoning = `Subscription mandate failed after all ${context.merchantPolicy.maxRetries} scheduled retries; manual merchant follow-up is required.`;
        } else if ((context.sourceEvent.subscriptionRetryCount ?? 0) >= 2 || kase.retryCount >= 2) {
          diagnosis = "repeated_subscription_failure";
          action = "SCHEDULE_RETRY";
          riskLevel = "MEDIUM";
          priority = "HIGH";
          confidence = 0.76;
          reasoning = `Subscription has failed repeatedly (plan: ${context.sourceEvent.planName ?? "unknown"}); scheduling the next retry within limits.`;
        } else {
          diagnosis = "failed_subscription_payment";
          action = "SCHEDULE_RETRY";
          riskLevel = "LOW";
          confidence = 0.87;
          reasoning = `First recorded mandate failure on plan ${context.sourceEvent.planName ?? "(unknown)"}; scheduled retries recover most subscription failures.`;
        }
        break;
      }
      default:
        diagnosis = "insufficient_recovery_context";
        action = "ESCALATE_TO_MERCHANT";
        riskLevel = "MEDIUM";
        confidence = 0.5;
        reasoning = "Unknown scenario; merchant review recommended.";
    }
  }

  return {
    diagnosis,
    riskLevel,
    recommendedAction: action,
    priority,
    confidence,
    reasoning,
    requiresMerchantAttention: attention,
  };
}
