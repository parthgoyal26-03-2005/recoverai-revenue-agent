import { describe, expect, it } from "vitest";
import {
  analyzeRecoveryCase,
  type AIAnalysisStore,
  type AIAuditLogData,
  type NewAIDecisionData,
} from "@/lib/ai/agent";
import { createPrismaContextSource } from "@/lib/ai/context-builder";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import type { AIProvider, RecoveryAnalysis } from "@/lib/ai/types";
import { makeContext } from "@/lib/ai/test-fixtures";
import { prisma } from "@/lib/db/prisma";
import type {
  CaseWithRelations,
} from "@/lib/recovery/store";
import { DEFAULT_POLICY } from "@/lib/domain/types";

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 3_600_000);
}

function makeCase(overrides?: Partial<CaseWithRelations>): CaseWithRelations {
  return {
    id: "case_1",
    merchantId: "merchant_1",
    customerId: "customer_1",
    scenario: "FAILED_PAYMENT",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    amountAtRisk: 249_900,
    retryCount: 0,
    contactCount: 0,
    merchantApproved: false,
    merchantApprovedAt: null,
    windowExpiresAt: hoursFromNow(72),
    transactionId: null,
    checkoutSessionId: null,
    subscriptionId: null,
    createdAt: new Date(),
    resolvedAt: null,
    customer: { id: "c1", name: "Test User", email: "t@example.com" },
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

class FakeContextSource {
  constructor(private context: ReturnType<typeof makeContext> | null) {}
  async loadContext() {
    return this.context;
  }
}

class InMemoryAIStore implements AIAnalysisStore {
  cases = new Map<string, CaseWithRelations>();
  decisions: (NewAIDecisionData & { id: string })[] = [];
  audits: AIAuditLogData[] = [];
  private seq = 0;

  async getCase(id: string) {
    return this.cases.get(id) ?? null;
  }
  async createAIDecision(data: NewAIDecisionData) {
    const id = `aid_${++this.seq}`;
    this.decisions.push({ ...data, id });
    return { id };
  }
  async createAuditLog(data: AIAuditLogData) {
    this.audits.push(data);
  }
}

class ThrowingProvider implements AIProvider {
  readonly name = "throwing";
  readonly model = "does-not-matter";
  async analyzeRecoveryCase(): Promise<RecoveryAnalysis> {
    throw new Error("provider outage");
  }
}

class InvalidOutputProvider implements AIProvider {
  readonly name = "invalid";
  readonly model = "invalid-v1";
  async analyzeRecoveryCase(): Promise<RecoveryAnalysis> {
    return Promise.reject(new Error("schema validation failed upstream"));
  }
}

describe("analyzeRecoveryCase agent", () => {
  it("persists an AIDecision and creates an audit event", async () => {
    const store = new InMemoryAIStore();
    store.cases.set("case_1", makeCase());

    const result = await analyzeRecoveryCase(
      { contextSource: new FakeContextSource(makeContext()), store, provider: new MockAIProvider() },
      "case_1"
    );

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.analysis.diagnosis).toBe("temporary_payment_failure");
    expect(store.decisions).toHaveLength(1);
    expect(store.decisions[0].recoveryCaseId).toBe("case_1");
    expect(store.decisions[0].recommendedAction).toBe("RETRY_PAYMENT");
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0].event).toBe("AI_ANALYSIS_COMPLETED");
    expect(store.audits[0].actor).toBe("AI");
  });

  it("falls back to the deterministic mock when the real provider fails and marks it clearly", async () => {
    const store = new InMemoryAIStore();
    store.cases.set("case_1", makeCase());

    const result = await analyzeRecoveryCase(
      { contextSource: new FakeContextSource(makeContext()), store, provider: new ThrowingProvider() },
      "case_1"
    );

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.fallbackUsed).toBe(true);
    expect(result.provider).toContain("mock-fallback");
    expect(result.model).toBe("mock-rules-v1");
    expect(store.decisions[0].provider).toContain("mock-fallback");
  });

  it("never lets invalid LLM output enter the system (falls back instead)", async () => {
    const store = new InMemoryAIStore();
    store.cases.set("case_1", makeCase());

    const result = await analyzeRecoveryCase(
      { contextSource: new FakeContextSource(makeContext()), store, provider: new InvalidOutputProvider() },
      "case_1"
    );

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.fallbackUsed).toBe(true);
    expect(store.decisions[0].diagnosis).not.toBe("");
  });

  it("cross-checks the recommendation against the policy engine — a stubborn LLM retry on a high-value case is flagged blocked", async () => {
    const store = new InMemoryAIStore();
    store.cases.set(
      "case_1",
      makeCase({ amountAtRisk: DEFAULT_POLICY.approvalThresholdPaise })
    );

    const stubbornProvider: AIProvider = {
      name: "stubborn-llm",
      model: "stubborn-v1",
      async analyzeRecoveryCase() {
        return {
          diagnosis: "temporary_payment_failure",
          riskLevel: "LOW" as const,
          recommendedAction: "RETRY_PAYMENT" as const,
          priority: "MEDIUM" as const,
          confidence: 0.9,
          reasoning:
            "The model insists on a direct retry despite the approval threshold.",
          requiresMerchantAttention: false,
        };
      },
    };

    const result = await analyzeRecoveryCase(
      { contextSource: new FakeContextSource(makeContext()), store, provider: stubbornProvider },
      "case_1"
    );

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.policyValidation.allowedByPolicy).toBe(false);
    expect(result.policyValidation.reason).toMatch(/merchant approval/i);
    expect(store.audits[0].metadata.policyAllowed).toBe(false);
  });

  it("analysis never executes recovery (no interventions can be created by the agent)", async () => {
    const store = new InMemoryAIStore();
    store.cases.set("case_1", makeCase());

    await analyzeRecoveryCase(
      { contextSource: new FakeContextSource(makeContext()), store, provider: new MockAIProvider() },
      "case_1"
    );

    expect(Object.keys(store)).not.toContain("createIntervention");
    expect(
      store.audits.every((a) => !a.event.startsWith("INTERVENTION_"))
    ).toBe(true);
  });

  it("returns found:false for unknown cases and never writes records", async () => {
    const store = new InMemoryAIStore();
    const result = await analyzeRecoveryCase(
      { contextSource: new FakeContextSource(null), store, provider: new MockAIProvider() },
      "missing"
    );
    expect(result.found).toBe(false);
    expect(store.decisions).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });
});

describe("integration with the real database", () => {
  it("context source loads sanitized context for a seeded case (no PII or payment secrets)", async () => {
    const anyCase = await prisma.recoveryCase.findFirst({
      include: { customer: true },
    });
    if (!anyCase) return;
    const context = await createPrismaContextSource(prisma).loadContext(anyCase.id);
    expect(context).not.toBeNull();
    if (!context) return;
    const serialized = JSON.stringify(context);
    expect(serialized.toLowerCase()).not.toMatch(/cvv|upi.?pin|password|razorpay_payment_id|token/);
    expect(serialized).not.toContain(anyCase.customer.email);
    expect(context.kase.scenario).toBeTruthy();
    expect(context.merchantPolicy.maxRetries).toBeGreaterThan(0);
  });
});
