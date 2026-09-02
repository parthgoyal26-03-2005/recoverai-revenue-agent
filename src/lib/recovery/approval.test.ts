import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  approveCase,
  executeCaseAction,
  rejectCase,
} from "@/lib/recovery/orchestrator";
import { resetRecoveryProviderCache } from "@/lib/recovery/providers";
import { RecoveryTestStore } from "@/lib/recovery/test-store";
import type {
  CaseWithRelations,
} from "@/lib/recovery/store";
import type { RecoveryContext } from "@/lib/ai/types";
import { makeContext } from "@/lib/ai/test-fixtures";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import { analyzeRecoveryCase } from "@/lib/ai/agent";
import { DEFAULT_POLICY } from "@/lib/domain/types";

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 3_600_000);
}

function makeApprovalCase(
  overrides?: Partial<CaseWithRelations>
): CaseWithRelations {
  return {
    id: "case_appr",
    merchantId: "merchant_1",
    customerId: "customer_1",
    scenario: "FAILED_PAYMENT",
    status: "ESCALATED",
    priority: "CRITICAL",
    amountAtRisk: DEFAULT_POLICY.approvalThresholdPaise,
    retryCount: 0,
    contactCount: 0,
    merchantApproved: false,
    merchantApprovedAt: null,
    merchantRejectedAt: null,
    rejectionReason: null,
    windowExpiresAt: hoursFromNow(72),
    transactionId: null,
    checkoutSessionId: null,
    subscriptionId: null,
    createdAt: new Date(),
    resolvedAt: null,
    customer: { id: "c1", name: "High Value User", email: "hv@example.com" },
    merchant: {
      id: "merchant_1",
      name: "Merchant",
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

class FakeCtx {
  constructor(private context: RecoveryContext = makeContext()) {}
  async loadContext() {
    return this.context;
  }
}

describe("merchant approval workflow", () => {
  const origProvider = process.env.PAYMENT_PROVIDER;
  beforeAll(() => { process.env.PAYMENT_PROVIDER = "simulation"; resetRecoveryProviderCache(); });
  afterAll(() => { process.env.PAYMENT_PROVIDER = origProvider; resetRecoveryProviderCache(); });

  it("1. high-value case requires approval before any money-moving action", async () => {
    const store = new RecoveryTestStore(makeApprovalCase());

    const result = await executeCaseAction(store, "case_appr", "RETRY_PAYMENT");

    if (result.ok) throw new Error("expected policy block");
    expect(result.message).toMatch(/merchant approval/i);
  });

  it("2. high-value case cannot execute before approval (no intervention recorded)", async () => {
    const store = new RecoveryTestStore(makeApprovalCase());

    await executeCaseAction(store, "case_appr", "RETRY_PAYMENT");

    expect(store.interventions).toHaveLength(0);
    const lastAudit = store.audits[store.audits.length - 1];
    expect(["APPROVAL_REQUIRED", "ACTION_BLOCKED"]).toContain(lastAudit.event);
  });

  it("3. merchant approval unlocks execution and audits APPROVAL_GRANTED first", async () => {
    const store = new RecoveryTestStore(makeApprovalCase());

    const approval = await approveCase(store, "case_appr");
    expect(approval.ok).toBe(true);
    expect(approval.approvedAt).toBeTruthy();

    const result = await executeCaseAction(store, "case_appr", "RETRY_PAYMENT", {
      rng: () => 0,
    });

    expect(result.ok).toBe(true);
    const events = store.audits.map((a) => a.event);
    expect(events.indexOf("APPROVAL_GRANTED")).toBeLessThan(
      events.indexOf("INTERVENTION_EXECUTED")
    );
  });

  it("4. server revalidates approval during execution — approval state comes only from the database", async () => {
    const store = new RecoveryTestStore(makeApprovalCase());
    void Promise.resolve().then(() => undefined);

    const before = await executeCaseAction(store, "case_appr", "RETRY_PAYMENT");
    expect(before.ok).toBe(false);

    store.cases.set("case_appr", {
      ...store.cases.get("case_appr")!,
      merchantApproved: true,
      status: "IN_PROGRESS",
    });

    const after = await executeCaseAction(store, "case_appr", "RETRY_PAYMENT", {
      rng: () => 0,
    });
    expect(after.ok).toBe(true);
    expect(store.cases.get("case_appr")!.status).toBe("RECOVERED");
  });

  it("5. rejected approval cannot be executed and cannot be re-approved", async () => {
    const store = new RecoveryTestStore(makeApprovalCase());

    const rejection = await rejectCase(store, "case_appr", "Too risky this month.");
    expect(rejection.ok).toBe(true);

    const executeAttempt = await executeCaseAction(store, "case_appr", "RETRY_PAYMENT");
    if (executeAttempt.ok) throw new Error("expected rejection to block execution");
    expect(executeAttempt.message).toMatch(/REJECTED/i);

    const reApprove = await approveCase(store, "case_appr");
    expect(reApprove.ok).toBe(false);
    expect(store.cases.get("case_appr")!.status).toBe("REJECTED");
    expect(store.audits.some((a) => a.event === "APPROVAL_REJECTED")).toBe(true);
  });

  it("6. low-value allowed case executes without any approval flow", async () => {
    const store = new RecoveryTestStore(
      makeApprovalCase({
        status: "IN_PROGRESS",
        amountAtRisk: 249_900,
        priority: "MEDIUM",
      })
    );

    const result = await executeCaseAction(store, "case_appr", "RETRY_PAYMENT", {
      rng: () => 0,
    });

    expect(result.ok).toBe(true);
    expect(store.audits.some((a) => a.event === "APPROVAL_REQUIRED")).toBe(false);
    expect(store.audits.some((a) => a.event === "RECOVERY_SUCCESS")).toBe(true);
  });

  it("7. terminal case cannot be approved or rejected", async () => {
    const store = new RecoveryTestStore(makeApprovalCase({ status: "RECOVERED" }));

    const approveResult = await approveCase(store, "case_appr");
    expect(approveResult.ok).toBe(false);
    expect(approveResult.error).toMatch(/no longer possible/i);

    const rejectResult = await rejectCase(store, "case_appr", "late");
    expect(rejectResult.ok).toBe(false);
  });

  it("8-9. dashboard attention count and case-list row action classify approval cases correctly", async () => {
    const { computeApprovalAttention, getCaseRowAction } = await import(
      "@/lib/analytics/metrics"
    );

    const rows = [
      { status: "ESCALATED", amountAtRisk: 804_800, merchantApproved: false, merchantRejectedAt: null },
      { status: "ESCALATED", amountAtRisk: 500_000, merchantApproved: false, merchantRejectedAt: null },
      { status: "ESCALATED", amountAtRisk: 900_000, merchantApproved: true, merchantRejectedAt: null },
      { status: "ESCALATED", amountAtRisk: 700_000, merchantApproved: false, merchantRejectedAt: new Date() },
      { status: "IN_PROGRESS", amountAtRisk: 249_900, merchantApproved: false, merchantRejectedAt: null },
    ];
    const attention = computeApprovalAttention(rows);
    expect(attention.cases).toBe(2);
    expect(attention.amountPaise).toBe(804_800 + 500_000);

    const needsApprovalRow = getCaseRowAction({
      status: "ESCALATED",
      merchantApproved: false,
      windowExpiresAt: hoursFromNow(10),
      hasScheduledIntervention: false,
      allowedProgressAction: false,
    });
    expect(needsApprovalRow.tone).toBe("approval");
    expect(needsApprovalRow.cta).toBe("Review");

    const readyRow = getCaseRowAction({
      status: "IN_PROGRESS",
      merchantApproved: false,
      windowExpiresAt: hoursFromNow(10),
      hasScheduledIntervention: false,
      allowedProgressAction: true,
    });
    expect(readyRow.tone).toBe("ready");
    expect(readyRow.cta).toBe("Execute");

    const rejectedRow = getCaseRowAction({
      status: "REJECTED",
      merchantApproved: false,
      merchantRejectedAt: new Date(),
      windowExpiresAt: hoursFromNow(10),
      hasScheduledIntervention: false,
      allowedProgressAction: false,
    });
    expect(rejectedRow.tone).toBe("rejected");
  });

  it("10. audit events appear in the correct chronological order for the full approval journey", async () => {
    const store = new RecoveryTestStore(makeApprovalCase());

    await analyzeRecoveryCase(
      { contextSource: new FakeCtx(), store, provider: new MockAIProvider() },
      "case_appr"
    );
    await executeCaseAction(store, "case_appr", "RETRY_PAYMENT");
    await approveCase(store, "case_appr");
    await executeCaseAction(store, "case_appr", "RETRY_PAYMENT", { rng: () => 0 });

    const events = store.audits.map((a) => a.event);
    const idx = (e: string) => events.indexOf(e);
    expect(events).toContain("AI_ANALYSIS_COMPLETED");
    expect(idx("APPROVAL_GRANTED")).toBeGreaterThan(idx("AI_ANALYSIS_COMPLETED"));
    expect(idx("INTERVENTION_EXECUTED")).toBeGreaterThan(idx("APPROVAL_GRANTED"));
    expect(events).toContain("RECOVERY_SUCCESS");
  });
});
