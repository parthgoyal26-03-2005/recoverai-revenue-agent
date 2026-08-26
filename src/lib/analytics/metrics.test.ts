import { describe, expect, it } from "vitest";
import {
  computeAiPerformance,
  computeFunnelStages,
  computePolicySafety,
  computeRecoveryRate,
  computeScenarioAnalytics,
  summarizeBatchResults,
} from "@/lib/analytics/metrics";

describe("dashboard aggregation helpers", () => {
  it("calculates revenue recovery rate correctly", () => {
    expect(computeRecoveryRate(92_300_00, 184_500_00)).toBeCloseTo(50.0, 1);
    expect(computeRecoveryRate(13_700_00, 48_200_00)).toBe(28.4);
  });

  it("handles zero division for recovery rate", () => {
    expect(computeRecoveryRate(0, 0)).toBe(0);
    expect(computeRecoveryRate(5_000, 0)).toBe(0);
    expect(computeRecoveryRate(5_000, -100)).toBe(0);
  });

  it("computes recovered revenue as the sum of successful interventions only", () => {
    const rows = [
      { recoveredPaise: 40_000, result: "SUCCESS" },
      { recoveredPaise: 12_000, result: "FAILURE" },
      { recoveredPaise: 52_300, result: "SUCCESS" },
      { recoveredPaise: 99_999, result: "NO_RESPONSE" },
    ];
    const recovered = rows
      .filter((r) => r.result === "SUCCESS")
      .reduce((s, r) => s + r.recoveredPaise, 0);
    expect(recovered).toBe(92_300);
    expect(computeRecoveryRate(recovered, 184_500)).toBe(50.0);
  });

  it("aggregates per-scenario analytics with individual recovery rates", () => {
    const [failedPayments, abandonment] = computeScenarioAnalytics([
      {
        scenario: "FAILED_PAYMENT",
        cases: 30,
        amountAtRiskPaise: 100_000_00,
        recoveredPaise: 25_000_00,
        failedAttempts: 18,
        escalations: 4,
      },
      {
        scenario: "CHECKOUT_ABANDONMENT",
        cases: 14,
        amountAtRiskPaise: 84_500_00,
        recoveredPaise: 67_300_00,
        failedAttempts: 3,
        escalations: 0,
      },
    ]);

    expect(failedPayments.recoveryRatePct).toBe(25);
    expect(abandonment.recoveryRatePct).toBeCloseTo(79.6, 1);
    expect(failedPayments.failedAttempts).toBe(18);
    expect(abandonment.escalations).toBe(0);
  });

  it("aggregates AI recommendation metrics including blocked and approval counts", () => {
    const stats = computeAiPerformance([
      { confidence: 0.9, policyAllowed: true, recommendedAction: "RETRY_PAYMENT", requiresMerchantAttention: false },
      { confidence: 0.8, policyAllowed: false, recommendedAction: "RETRY_PAYMENT", requiresMerchantAttention: false },
      { confidence: 1.0, policyAllowed: true, recommendedAction: "ESCALATE_TO_MERCHANT", requiresMerchantAttention: true },
    ]);
    expect(stats.analysesPerformed).toBe(3);
    expect(stats.acceptedCount).toBe(2);
    expect(stats.blockedByPolicyCount).toBe(1);
    expect(stats.approvalRequiredCount).toBe(1);
    expect(stats.avgConfidencePct).toBe(90);
  });

  it("handles empty AI metrics without division by zero", () => {
    const stats = computeAiPerformance([]);
    expect(stats.analysesPerformed).toBe(0);
    expect(stats.avgConfidencePct).toBe(0);
    expect(stats.acceptedCount).toBe(0);
  });

  it("computes policy safety metrics from audit events", () => {
    const stats = computePolicySafety([
      { event: "ACTION_ALLOWED" },
      { event: "ACTION_ALLOWED" },
      { event: "ACTION_BLOCKED", blockReason: "Retry blocked: maximum retry limit reached." },
      { event: "ACTION_BLOCKED", blockReason: "Case is RECOVERED; no further recovery actions are possible." },
      { event: "APPROVAL_REQUIRED" },
      { event: "CASE_ESCALATED" },
      { event: "CASE_STOPPED" },
      { event: "POLICY_WINDOW_EXPIRED" },
    ]);
    expect(stats.allowed).toBe(2);
    expect(stats.blocked).toBe(2);
    expect(stats.terminalPrevented).toBe(1);
    expect(stats.approvalRequired).toBe(2);
    expect(stats.stopped).toBe(2);
  });

  it("summarizes batch results into distinct outcome buckets", () => {
    const summary = summarizeBatchResults(
      [
        { status: "executed", caseStatusAfter: "RECOVERED", recoveredAmountPaise: 249_900, actionType: "RETRY_PAYMENT" },
        { status: "executed", caseStatusAfter: "IN_PROGRESS", recoveredAmountPaise: 0, actionType: "SEND_REMINDER" },
        { status: "executed", caseStatusAfter: "IN_PROGRESS", recoveredAmountPaise: 0, actionType: "SCHEDULE_RETRY" },
        { status: "executed", caseStatusAfter: "STOPPED", recoveredAmountPaise: 0, actionType: "STOP_RECOVERY" },
        { status: "blocked", caseStatusAfter: "ESCALATED", recoveredAmountPaise: 0, actionType: "RETRY_PAYMENT" },
        { status: "approval_required", caseStatusAfter: "ESCALATED", recoveredAmountPaise: 0, actionType: "ESCALATE_TO_MERCHANT" },
      ],
      1_000_000
    );
    expect(summary.totalCases).toBe(6);
    expect(summary.executed).toBe(4);
    expect(summary.recovered).toBe(1);
    expect(summary.scheduled).toBe(1);
    expect(summary.stopped).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.approvalRequired).toBe(1);
    expect(summary.revenueRecoveredPaise).toBe(249_900);
    expect(summary.recoveryRatePct).toBe(25.0);
  });

  it("excludes terminal cases from active recovery counts", () => {
    const statuses = [
      "DETECTED",
      "IN_PROGRESS",
      "RECOVERED",
      "FAILED",
      "STOPPED",
      "ESCALATED",
    ];
    const active = statuses.filter((s) =>
      (["DETECTED", "DIAGNOSED", "IN_PROGRESS", "ESCALATED"] as const).includes(
        s as "DETECTED"
      )
    );
    expect(active).toEqual(["DETECTED", "IN_PROGRESS", "ESCALATED"]);
    expect(active).not.toContain("RECOVERED");
    expect(active).not.toContain("STOPPED");
  });

  it("builds a complete funnel with real values at every stage", () => {
    const stages = computeFunnelStages({
      atRiskPaise: 184_500_00,
      casesAnalyzed: 54,
      casesEligible: 42,
      actionsExecuted: 31,
      recoveredCases: 17,
      recoveredPaise: 92_300_00,
    });
    expect(stages.map((s) => s.label)).toEqual([
      "Revenue At Risk",
      "Cases Analyzed",
      "Cases Eligible",
      "Actions Executed",
      "Cases Recovered",
    ]);
    expect(stages[0].value).toContain("1,84,500");
    expect(stages[4].sub).toContain("92,300");
  });
});
