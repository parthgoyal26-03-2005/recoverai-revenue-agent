import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeCaseAction } from "@/lib/recovery/orchestrator";
import { resetRecoveryProviderCache } from "@/lib/recovery/providers";
import { RecoveryTestStore } from "@/lib/recovery/test-store";
import type { CaseWithRelations } from "@/lib/recovery/store";
import { DEFAULT_POLICY } from "@/lib/domain/types";

const origEnv = { ...process.env };

function makeCase(overrides?: Partial<CaseWithRelations>): CaseWithRelations {
  return {
    id: "case_guard",
    merchantId: "merchant_1",
    customerId: "customer_1",
    scenario: "FAILED_PAYMENT",
    status: "IN_PROGRESS",
    priority: "HIGH",
    amountAtRisk: 4_037_400,
    retryCount: 0,
    contactCount: 0,
    merchantApproved: true,
    merchantApprovedAt: new Date(),
    merchantRejectedAt: null,
    rejectionReason: null,
    windowExpiresAt: new Date(Date.now() + 72 * 3_600_000),
    transactionId: null,
    checkoutSessionId: null,
    subscriptionId: null,
    createdAt: new Date(),
    resolvedAt: null,
    customer: { id: "customer_1", name: "Guard User", email: "g@example.com" },
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

let fetchCalls = 0;

function mockLinkCreate(linkId: string, url: string) {
  fetchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: linkId, short_url: url }),
      } as Response;
    })
  );
}

function mockLinkCreateFail(description: string, status = 400) {
  fetchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      fetchCalls += 1;
      return {
        ok: false,
        status,
        json: async () => ({ error: { description } }),
      } as Response;
    })
  );
}

describe("single outstanding Razorpay payment", () => {
  beforeEach(() => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
    process.env.RAZORPAY_KEY_SECRET = "key_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_abc";
    process.env.RAZORPAY_MERCHANT_ID = "merchant_1";
    resetRecoveryProviderCache();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    resetRecoveryProviderCache();
    vi.unstubAllGlobals();
  });

  it("1. first RETRY_PAYMENT creates exactly one Razorpay Payment Link", async () => {
    mockLinkCreate("plink_first", "https://rzp.io/l/first");
    const store = new RecoveryTestStore(makeCase());

    const result = await executeCaseAction(store, "case_guard", "RETRY_PAYMENT");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fetchCalls).toBe(1);
    expect(store.interventions).toHaveLength(1);
    const iv = store.interventions[0] as Record<string, unknown>;
    expect(iv.provider).toBe("razorpay");
    expect(iv.status).toBe("AWAITING_PAYMENT");
    expect(iv.result).toBe("PENDING");
    expect(iv.providerReference).toBe("plink_first");
    expect(iv.paymentLinkUrl).toBe("https://rzp.io/l/first");
    expect(store.cases.get("case_guard")!.status).toBe("IN_PROGRESS");
    expect(store.cases.get("case_guard")!.retryCount).toBe(1);
    expect(
      store.audits.filter((a) => a.event === "RECOVERY_PAYMENT_CREATED")
    ).toHaveLength(1);
  });

  it("2/3/4/20. second RETRY_PAYMENT creates ZERO links, reuses existing, keeps retryCount", async () => {
    mockLinkCreate("plink_first", "https://rzp.io/l/first");
    const store = new RecoveryTestStore(makeCase());

    const first = await executeCaseAction(store, "case_guard", "RETRY_PAYMENT");
    expect(first.ok).toBe(true);
    const retryAfterFirst = store.cases.get("case_guard")!.retryCount;

    const second = await executeCaseAction(store, "case_guard", "RETRY_PAYMENT");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);
    expect(second.error).toBe("PAYMENT_ALREADY_PENDING");
    expect(second.message).toMatch(/already awaiting customer payment/i);
    expect(second.paymentLinkId).toBe("plink_first");
    expect(second.paymentLinkUrl).toBe("https://rzp.io/l/first");

    // No second Razorpay call, no second intervention, no retry consumed.
    expect(fetchCalls).toBe(1);
    expect(store.interventions).toHaveLength(1);
    expect(store.cases.get("case_guard")!.retryCount).toBe(retryAfterFirst);
    expect(
      store.audits.filter((a) => a.event === "RECOVERY_PAYMENT_CREATED")
    ).toHaveLength(1);
  });

  it("provider failure does NOT consume retry/contact budget and keeps case recoverable", async () => {
    mockLinkCreateFail("Internal server error at Razorpay", 500);
    const store = new RecoveryTestStore(makeCase());

    const result = await executeCaseAction(store, "case_guard", "RETRY_PAYMENT");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fetchCalls).toBe(1);
    expect(result.caseStatus).toBe("IN_PROGRESS");
    expect(result.recoveredAmountPaise).toBe(0);
    expect(store.cases.get("case_guard")!.retryCount).toBe(0);
    expect(store.cases.get("case_guard")!.contactCount).toBe(0);
    expect(store.cases.get("case_guard")!.status).not.toBe("RECOVERED");
    expect(store.cases.get("case_guard")!.merchantApproved).toBe(true);

    const iv = store.interventions[0] as Record<string, unknown>;
    expect(String(iv.notes)).toMatch(/^Provider error:/);
    expect(result.messages.join(" ")).toMatch(/No retry was consumed/);
    expect(result.messages.join(" ")).not.toMatch(/Attempt did not recover revenue/);
    expect(
      store.audits.filter((a) => a.event === "RECOVERY_PAYMENT_CREATED")
    ).toHaveLength(0);
    expect(
      store.audits.filter((a) => a.event === "RECOVERY_FAILED")
    ).toHaveLength(0);
  });

  it("Test Mode 30-link limit returns typed provider error without consuming retry", async () => {
    mockLinkCreateFail("test mode limit of 30 reached for payment_link", 400);
    const store = new RecoveryTestStore(makeCase());

    const result = await executeCaseAction(store, "case_guard", "RETRY_PAYMENT");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.errorCode).toBe("RAZORPAY_TEST_LINK_LIMIT_REACHED");
    expect(result.caseStatus).toBe("IN_PROGRESS");
    expect(result.recoveredAmountPaise).toBe(0);
    expect(store.cases.get("case_guard")!.retryCount).toBe(0);
    expect(store.cases.get("case_guard")!.status).not.toBe("RECOVERED");
    expect(store.cases.get("case_guard")!.merchantApproved).toBe(true);

    const joined = result.messages.join(" ");
    expect(joined).toMatch(/Payment Link limit reached/);
    expect(joined).toMatch(/up to 30 Payment Links/);
    expect(joined).toMatch(/Simulation Mode/);
    expect(joined).toMatch(/No retry was consumed/);

    const iv = store.interventions[0] as Record<string, unknown>;
    expect(String(iv.notes)).toMatch(/^Provider error:/);
    expect(iv.providerReference).toBeNull();
    expect(iv.paymentLinkUrl).toBeNull();
  });

  it("19. recovered case cannot create a new Payment Link (terminal guard)", async () => {
    mockLinkCreate("plink_never", "https://rzp.io/l/never");
    const store = new RecoveryTestStore(
      makeCase({ status: "RECOVERED", resolvedAt: new Date() })
    );

    const result = await executeCaseAction(store, "case_guard", "RETRY_PAYMENT");
    expect(result.ok).toBe(false);
    expect(fetchCalls).toBe(0);
    expect(store.interventions).toHaveLength(0);
  });
});
