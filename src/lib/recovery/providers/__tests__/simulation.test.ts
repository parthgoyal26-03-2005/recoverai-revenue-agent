import { describe, it, expect } from "vitest";
import { SimulationProvider } from "../simulation";
import type { CaseWithRelations } from "@/lib/recovery/store";
import { DEFAULT_POLICY } from "@/lib/domain/types";

function makeCase(overrides?: Partial<CaseWithRelations>): CaseWithRelations {
  return {
    id: "case_sim",
    merchantId: "merchant_1",
    customerId: "customer_1",
    scenario: "FAILED_PAYMENT",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    amountAtRisk: 250_000,
    retryCount: 0,
    contactCount: 0,
    merchantApproved: true,
    merchantApprovedAt: new Date(),
    windowExpiresAt: new Date(Date.now() + 72 * 3_600_000),
    transactionId: null,
    checkoutSessionId: null,
    subscriptionId: null,
    createdAt: new Date(),
    resolvedAt: null,
    customer: { id: "customer_1", name: "Test User", email: "t@example.com" },
    merchant: {
      id: "merchant_1",
      name: "Test Merchant",
      policy: {
        maxRetries: DEFAULT_POLICY.maxRetries,
        maxContactAttempts: DEFAULT_POLICY.maxContactAttempts,
        recoveryWindowHours: DEFAULT_POLICY.recoveryWindowHours,
        approvalThreshold: DEFAULT_POLICY.approvalThresholdPaise,
      },
    },
    ...overrides,
  } as CaseWithRelations;
}

describe("SimulationProvider", () => {
  const provider = new SimulationProvider();

  it("executes via simulation and returns executedBy = simulation", async () => {
    const result = await provider.executeAction({
      recoveryCase: makeCase(),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
    });
    expect(result.executedBy).toBe("simulation");
    expect(result.paymentLink).toBeNull();
    expect(["COMPLETED", "SCHEDULED", "SKIPPED", "AWAITING_APPROVAL"]).toContain(
      result.status
    );
  });

  it("honours a deterministic rng for a guaranteed success retry", async () => {
    const result = await provider.executeAction({
      recoveryCase: makeCase(),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
      rng: () => 0,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.result).toBe("SUCCESS");
    expect(result.recoveredAmountPaise).toBe(250_000);
  });

  it("never returns a payment link from the simulation provider", async () => {
    const result = await provider.executeAction({
      recoveryCase: makeCase({ scenario: "CHECKOUT_ABANDONMENT" }),
      action: "SEND_REMINDER",
      attemptNumber: 1,
      now: new Date(),
      rng: () => 0.99,
    });
    expect(result.paymentLink).toBeNull();
    expect(result.executedBy).toBe("simulation");
  });
});
