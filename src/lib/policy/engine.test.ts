import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "@/lib/policy/engine";
import { DEFAULT_POLICY, type PolicyContext } from "@/lib/domain/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);
const now = new Date();

function baseContext(overrides?: Partial<PolicyContext>): PolicyContext {
  return {
    scenario: "FAILED_PAYMENT",
    amountAtRiskPaise: 100_000,
    retryCount: 0,
    contactCount: 0,
    windowExpiresAt: hoursFromNow(72),
    merchantApproved: false,
    now,
    ...overrides,
  };
}

describe("deterministic policy engine", () => {
  it("allows the first payment retry for an eligible failed payment", () => {
    const result = evaluatePolicy(baseContext(), DEFAULT_POLICY);

    expect(result.eligible).toBe(true);
    expect(result.allowedActions).toContain("RETRY_PAYMENT");
    expect(result.allowedActions).toContain("SCHEDULE_RETRY");
    expect(result.retriesRemaining).toBe(DEFAULT_POLICY.maxRetries);
  });

  it("blocks retries and forces stop after max retries are reached", () => {
    const result = evaluatePolicy(
      baseContext({ retryCount: DEFAULT_POLICY.maxRetries }),
      DEFAULT_POLICY
    );

    expect(result.allowedActions).not.toContain("RETRY_PAYMENT");
    expect(result.allowedActions).not.toContain("SCHEDULE_RETRY");
    expect(result.stopRequired).toBe(true);
    expect(result.eligible).toBe(false);

    const retryPermission = result.permissions.find(
      (p) => p.action === "RETRY_PAYMENT"
    );
    expect(retryPermission?.reason).toMatch(/maximum retry limit/i);
  });

  it("requires merchant escalation for high-value payments and allows retry after approval", () => {
    const highValue = baseContext({
      amountAtRiskPaise: DEFAULT_POLICY.approvalThresholdPaise,
    });

    const beforeApproval = evaluatePolicy(highValue, DEFAULT_POLICY);
    expect(beforeApproval.requiresApproval).toBe(true);
    expect(beforeApproval.allowedActions).toContain("ESCALATE_TO_MERCHANT");
    expect(beforeApproval.allowedActions).not.toContain("RETRY_PAYMENT");
    expect(beforeApproval.eligible).toBe(false);

    const afterApproval = evaluatePolicy(
      baseContext({
        amountAtRiskPaise: DEFAULT_POLICY.approvalThresholdPaise,
        merchantApproved: true,
      }),
      DEFAULT_POLICY
    );
    expect(afterApproval.requiresApproval).toBe(false);
    expect(afterApproval.allowedActions).toContain("RETRY_PAYMENT");
    expect(afterApproval.eligible).toBe(true);
  });

  it("allows a checkout abandonment reminder while contacts remain", () => {
    const result = evaluatePolicy(
      baseContext({ scenario: "CHECKOUT_ABANDONMENT" }),
      DEFAULT_POLICY
    );

    expect(result.eligible).toBe(true);
    expect(result.allowedActions).toContain("SEND_REMINDER");
    expect(result.allowedActions).toContain("OFFER_ASSISTANCE");
    expect(result.contactsRemaining).toBe(DEFAULT_POLICY.maxContactAttempts);
  });

  it("blocks reminders and stops recovery after the contact limit is reached", () => {
    const result = evaluatePolicy(
      baseContext({
        scenario: "CHECKOUT_ABANDONMENT",
        contactCount: DEFAULT_POLICY.maxContactAttempts,
      }),
      DEFAULT_POLICY
    );

    expect(result.allowedActions).not.toContain("SEND_REMINDER");
    expect(result.allowedActions).not.toContain("OFFER_ASSISTANCE");
    expect(result.stopRequired).toBe(true);
    expect(result.eligible).toBe(false);

    const reminder = result.permissions.find((p) => p.action === "SEND_REMINDER");
    expect(reminder?.reason).toMatch(/maximum contact attempts/i);
  });

  it("stops all recovery once the recovery window has expired", () => {
    const result = evaluatePolicy(
      baseContext({ windowExpiresAt: new Date(Date.now() - 60_000), now }),
      DEFAULT_POLICY
    );

    expect(result.windowExpired).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.stopRequired).toBe(true);
    expect(result.allowedActions).toEqual(["STOP_RECOVERY"]);
    expect(result.summaryReason).toMatch(/window of 72h has expired/i);
  });

  it("allows scheduled retries for subscription failures and escalates when exhausted", () => {
    const fresh = evaluatePolicy(
      baseContext({ scenario: "SUBSCRIPTION_FAILURE" }),
      DEFAULT_POLICY
    );
    expect(fresh.allowedActions).toContain("SCHEDULE_RETRY");
    expect(fresh.allowedActions).not.toContain("RETRY_PAYMENT");

    const exhausted = evaluatePolicy(
      baseContext({
        scenario: "SUBSCRIPTION_FAILURE",
        retryCount: DEFAULT_POLICY.maxRetries,
      }),
      DEFAULT_POLICY
    );
    expect(exhausted.stopRequired).toBe(true);
    expect(exhausted.escalateRequired).toBe(true);
  });

  it("evaluates identically for identical inputs (deterministic)", () => {
    const ctx = baseContext();
    const a = evaluatePolicy(ctx, DEFAULT_POLICY);
    const b = evaluatePolicy(ctx, DEFAULT_POLICY);
    expect(a).toEqual(b);
  });
});
