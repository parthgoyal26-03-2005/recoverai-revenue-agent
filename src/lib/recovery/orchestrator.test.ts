import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { executeCaseAction, evaluateCase } from "@/lib/recovery/orchestrator";
import { resetRecoveryProviderCache } from "@/lib/recovery/providers";
import type {
  AuditLogData,
  CaseUpdateData,
  CaseWithRelations,
  DueIntervention,
  NewInterventionData,
  RecoveryStore,
} from "@/lib/recovery/store";
import { DEFAULT_POLICY } from "@/lib/domain/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

function makeCase(overrides?: Partial<CaseWithRelations>): CaseWithRelations {
  return {
    id: "case_1",
    merchantId: "merchant_1",
    customerId: "customer_1",
    scenario: "FAILED_PAYMENT",
    status: "DETECTED",
    priority: "MEDIUM",
    amountAtRisk: 100_000,
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

class InMemoryStore implements RecoveryStore {
  cases = new Map<string, CaseWithRelations>();
  interventions: (NewInterventionData & { id: string })[] = [];
  audits: AuditLogData[] = [];
  caseUpdates: CaseUpdateData[] = [];
  private seq = 0;

  constructor(recoveryCase: CaseWithRelations) {
    this.cases.set(recoveryCase.id, recoveryCase);
  }

  async getCase(id: string) {
    return this.cases.get(id) ?? null;
  }
  async findActiveCases(): Promise<CaseWithRelations[]> {
    const active = ["DETECTED", "DIAGNOSED", "IN_PROGRESS"];
    return [...this.cases.values()].filter((c) => active.includes(c.status));
  }
  async createIntervention(data: NewInterventionData) {
    const id = `iv_${++this.seq}`;
    this.interventions.push({ ...data, id });
    return { id };
  }
  async updateCase(id: string, data: CaseUpdateData) {
    const current = this.cases.get(id)!;
    this.cases.set(id, { ...current, ...data } as CaseWithRelations);
    this.caseUpdates.push(data);
  }
  async createAuditLog(data: AuditLogData) {
    this.audits.push(data);
  }
  async findDueScheduledInterventions(): Promise<DueIntervention[]> {
    return [] as DueIntervention[];
  }
  async updateIntervention(
    id: string,
    data: Partial<import("@/generated/prisma/client").RecoveryIntervention>
  ) {
    const entry = this.interventions.find((iv) => iv.id === id);
    if (entry) Object.assign(entry, data);
  }
  async findPendingRazorpayIntervention(recoveryCaseId: string) {
    const found = [...this.interventions]
      .reverse()
      .find(
        (iv) =>
          iv.recoveryCaseId === recoveryCaseId &&
          (iv as { provider?: string | null }).provider === "razorpay" &&
          iv.status === "AWAITING_PAYMENT" &&
          iv.result === "PENDING"
      );
    return (found ?? null) as unknown as import("@/generated/prisma/client").RecoveryIntervention | null;
  }
}

describe("recovery orchestrator", () => {
  const origProvider = process.env.PAYMENT_PROVIDER;
  beforeAll(() => { process.env.PAYMENT_PROVIDER = "simulation"; resetRecoveryProviderCache(); });
  afterAll(() => { process.env.PAYMENT_PROVIDER = origProvider; resetRecoveryProviderCache(); });

  it("executes a successful retry: records recoveredAmount and marks case RECOVERED", async () => {
    const store = new InMemoryStore(makeCase());
    const result = await executeCaseAction(store, "case_1", "RETRY_PAYMENT", {
      rng: () => 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.caseStatus).toBe("RECOVERED");
    expect(result.recoveredAmountPaise).toBe(100_000);

    expect(store.interventions).toHaveLength(1);
    expect(store.interventions[0].recoveredAmount).toBe(100_000);
    expect(store.cases.get("case_1")!.status).toBe("RECOVERED");
    expect(store.audits.map((a) => a.event)).toContain("RECOVERY_SUCCESS");
  });

  it("failed recovery records zero revenue but the case remains eligible", async () => {
    const store = new InMemoryStore(makeCase());
    const result = await executeCaseAction(store, "case_1", "RETRY_PAYMENT", {
      rng: () => 0.99,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recoveredAmountPaise).toBe(0);
    expect(result.caseStatus).toBe("IN_PROGRESS");

    expect(store.interventions[0].recoveredAmount).toBe(0);
    expect(store.cases.get("case_1")!.status).toBe("IN_PROGRESS");
    expect(
      store.audits.filter((a) => a.event === "RECOVERY_SUCCESS")
    ).toHaveLength(0);
    expect(store.audits.map((a) => a.event)).toContain("RECOVERY_FAILED");
  });

  it("stops recovery after max retries are exhausted via failed attempts", async () => {
    const store = new InMemoryStore(makeCase());

    for (let i = 0; i < 3; i++) {
      await executeCaseAction(store, "case_1", "RETRY_PAYMENT", {
        rng: () => 0.99,
      });
    }

    expect(store.cases.get("case_1")!.status).toBe("STOPPED");
    expect(store.audits.map((a) => a.event)).toContain("CASE_STOPPED");

    const fourth = await executeCaseAction(store, "case_1", "RETRY_PAYMENT");
    expect(fourth.ok).toBe(false);
  });

  it("creates an audit log for every action including blocked ones", async () => {
    const store = new InMemoryStore(makeCase());

    await evaluateCase(store, "case_1", { persistAudit: true });
    expect(store.audits.some((a) => a.event === "CASE_ANALYZED")).toBe(true);

    await executeCaseAction(store, "case_1", "RETRY_PAYMENT", { rng: () => 0 });
    expect(
      store.audits.some((a) => a.event === "INTERVENTION_EXECUTED")
    ).toBe(true);

    const before = store.audits.length;
    await executeCaseAction(store, "case_1", "SEND_REMINDER");
    expect(store.audits.length).toBeGreaterThan(before);
    expect(store.audits[store.audits.length - 1].event).toBe("ACTION_BLOCKED");
    expect(store.interventions).toHaveLength(1);
  });

  it("never lets the client bypass policy validation on execute", async () => {
    const store = new InMemoryStore(
      makeCase({
        scenario: "CHECKOUT_ABANDONMENT",
        contactCount: 2,
        status: "IN_PROGRESS",
      })
    );

    const result = await executeCaseAction(store, "case_1", "SEND_REMINDER");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("BLOCKED_BY_POLICY");
    expect(result.message).toMatch(/maximum contact attempts/i);
    expect(store.interventions).toHaveLength(0);
    expect(store.audits[store.audits.length - 1].event).toBe("ACTION_BLOCKED");
  });

  it("blocks all execution on terminal cases (e.g. already recovered)", async () => {
    const store = new InMemoryStore(makeCase({ status: "RECOVERED" }));

    const result = await executeCaseAction(store, "case_1", "RETRY_PAYMENT", {
      rng: () => 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("BLOCKED_BY_POLICY");
    expect(result.message).toMatch(/already recovered|RECOVERED/i);
    expect(store.interventions).toHaveLength(0);
    expect(store.audits[store.audits.length - 1].event).toBe("ACTION_BLOCKED");
  });

  it("high-value cases block retries until the merchant approves", async () => {
    const store = new InMemoryStore(
      makeCase({ amountAtRisk: DEFAULT_POLICY.approvalThresholdPaise })
    );

    const blocked = await executeCaseAction(store, "case_1", "RETRY_PAYMENT");
    expect(blocked.ok).toBe(false);

    const evaluation = await evaluateCase(store, "case_1");
    expect(evaluation.policy!.requiresApproval).toBe(true);

    store.cases.set("case_1", {
      ...store.cases.get("case_1")!,
      merchantApproved: true,
    });

    const approved = await executeCaseAction(store, "case_1", "RETRY_PAYMENT", {
      rng: () => 0,
    });
    expect(approved.ok).toBe(true);
  });
});
