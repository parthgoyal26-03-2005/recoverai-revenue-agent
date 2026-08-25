import { describe, expect, it } from "vitest";
import { simulateOutcome } from "@/lib/simulation/outcomes";

const base = {
  caseId: "case_test_1",
  scenario: "FAILED_PAYMENT" as const,
  attemptNumber: 1,
  amountAtRiskPaise: 249_900,
};

describe("simulated action outcomes", () => {
  it("produces deterministic results for identical inputs", () => {
    const a = simulateOutcome({ ...base, action: "RETRY_PAYMENT" });
    const b = simulateOutcome({ ...base, action: "RETRY_PAYMENT" });
    expect(a).toEqual(b);
  });

  it("records full recovered amount on successful retry and zero on failure", () => {
    const success = simulateOutcome({
      ...base,
      action: "RETRY_PAYMENT",
      rng: () => 0,
    });
    expect(success.result).toBe("SUCCESS");
    expect(success.recoveredAmountPaise).toBe(base.amountAtRiskPaise);

    const failure = simulateOutcome({
      ...base,
      action: "RETRY_PAYMENT",
      rng: () => 0.99,
    });
    expect(failure.result).toBe("FAILURE");
    expect(failure.recoveredAmountPaise).toBe(0);
  });

  it("schedules retries with a future date instead of resolving them immediately", () => {
    const now = new Date();
    const outcome = simulateOutcome({
      ...base,
      action: "SCHEDULE_RETRY",
      now,
    });

    expect(outcome.status).toBe("SCHEDULED");
    expect(outcome.recoveredAmountPaise).toBe(0);
    expect(outcome.scheduledAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("escalation and stop never produce recovered revenue", () => {
    const escalation = simulateOutcome({
      ...base,
      action: "ESCALATE_TO_MERCHANT",
    });
    expect(escalation.result).toBe("APPROVAL_PENDING");
    expect(escalation.recoveredAmountPaise).toBe(0);

    const stop = simulateOutcome({ ...base, action: "STOP_RECOVERY" });
    expect(stop.result).toBe("BLOCKED_BY_POLICY");
    expect(stop.recoveredAmountPaise).toBe(0);
  });

  it("success probability declines across retry attempts", () => {
    const midRoll = () => 0.4;

    const firstAttempt = simulateOutcome({
      ...base,
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      rng: midRoll,
    });
    expect(firstAttempt.result).toBe("SUCCESS");

    const thirdAttempt = simulateOutcome({
      ...base,
      action: "RETRY_PAYMENT",
      attemptNumber: 3,
      rng: midRoll,
    });
    expect(thirdAttempt.result).toBe("FAILURE");
  });
});
