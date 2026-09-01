import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RazorpayProvider } from "../razorpay";
import type { CaseWithRelations } from "@/lib/recovery/store";
import { DEFAULT_POLICY } from "@/lib/domain/types";

const origEnv = { ...process.env };

function makeCase(overrides?: Partial<CaseWithRelations>): CaseWithRelations {
  return {
    id: "case_rp",
    merchantId: "merchant_1",
    customerId: "customer_1",
    scenario: "FAILED_PAYMENT",
    status: "IN_PROGRESS",
    priority: "HIGH",
    amountAtRisk: 804_800,
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
    customer: { id: "customer_1", name: "Priya Sharma", email: "priya@example.com" },
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

function setRazorpayEnv() {
  process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
  process.env.RAZORPAY_KEY_SECRET = "key_secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_abc";
  process.env.RAZORPAY_MERCHANT_ID = "merchant_1";
}

let capturedRequest: { url?: string; body?: Record<string, unknown> } = {};

function mockFetchOk(data: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      capturedRequest = {
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      return {
        ok: true,
        status: 200,
        json: async () => data,
      } as Response;
    })
  );
}

function mockFetchError() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { description: "boom" } }),
    }))
  );
}

describe("RazorpayProvider", () => {
  const provider = new RazorpayProvider();

  beforeEach(() => {
    setRazorpayEnv();
    capturedRequest = {};
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.unstubAllGlobals();
  });

  it("creates a payment link for RETRY_PAYMENT and returns PENDING (not RECOVERED)", async () => {
    mockFetchOk({ id: "plink_test123", short_url: "https://rzp.io/l/abc" });
    const result = await provider.executeAction({
      recoveryCase: makeCase(),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
      interventionId: "iv_1",
    });

    expect(result.executedBy).toBe("razorpay");
    expect(result.status).toBe("PENDING");
    expect(result.recoveredAmountPaise).toBe(0);
    expect(result.paymentLink).toEqual({
      id: "plink_test123",
      url: "https://rzp.io/l/abc",
    });
  });

  it("uses the case amount (paise) and INR currency — not a browser-supplied value", async () => {
    mockFetchOk({ id: "plink_amt", short_url: "https://rzp.io/l/amt" });
    await provider.executeAction({
      recoveryCase: makeCase({ amountAtRisk: 804_800 }),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
      interventionId: "iv_1",
    });
    expect(capturedRequest.body?.amount).toBe(804_800);
    expect(capturedRequest.body?.currency).toBe("INR");
  });

  it("uses a RECOVERAI- reference_id within the Razorpay length limit", async () => {
    mockFetchOk({ id: "plink_ref", short_url: "https://rzp.io/l/ref" });
    await provider.executeAction({
      recoveryCase: makeCase(),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
      interventionId: "iv_1",
    });
    const ref = capturedRequest.body?.reference_id as string;
    expect(ref.startsWith("RECOVERAI-")).toBe(true);
    expect(ref.length).toBeLessThanOrEqual(40);
  });

  it("sets expire_by from the case recovery window", async () => {
    mockFetchOk({ id: "plink_exp", short_url: "https://rzp.io/l/exp" });
    await provider.executeAction({
      recoveryCase: makeCase({ windowExpiresAt: new Date(1_800_000_000_000) }),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
    });
    expect(capturedRequest.body?.expire_by).toBe(1_800_000_000);
  });

  it("embeds recoverai case/intervention/scenario in notes with no PII", async () => {
    mockFetchOk({ id: "plink_notes", short_url: "https://rzp.io/l/notes" });
    await provider.executeAction({
      recoveryCase: makeCase(),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
      interventionId: "iv_notes_123",
    });
    const notes = capturedRequest.body?.notes as Record<string, unknown>;
    expect(notes.recoverai_case_id).toBe("case_rp");
    expect(notes.recoverai_intervention_id).toBe("iv_notes_123");
    expect(notes.recoverai_scenario).toBe("FAILED_PAYMENT");
    const serialized = JSON.stringify(capturedRequest.body);
    expect(serialized).not.toContain("priya@example.com");
    expect(serialized).not.toContain("Priya Sharma");
  });

  it("delegates to simulation for non-FAILED_PAYMENT scenarios (no network)", async () => {
    mockFetchOk({ id: "plink_x", short_url: "https://rzp.io/l/x" });
    const result = await provider.executeAction({
      recoveryCase: makeCase({ scenario: "CHECKOUT_ABANDONMENT" }),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
      rng: () => 0,
    });
    expect(result.executedBy).toBe("simulation");
    expect(capturedRequest.url).toBeUndefined();
    expect(result.paymentLink).toBeNull();
  });

  it("delegates to simulation for non-retry actions (no network)", async () => {
    mockFetchOk({ id: "plink_y", short_url: "https://rzp.io/l/y" });
    const result = await provider.executeAction({
      recoveryCase: makeCase(),
      action: "SEND_REMINDER",
      attemptNumber: 1,
      now: new Date(),
      rng: () => 0,
    });
    expect(result.executedBy).toBe("simulation");
    expect(capturedRequest.url).toBeUndefined();
  });

  it("returns FAILURE (never RECOVERED) when payment link creation fails", async () => {
    mockFetchError();
    const result = await provider.executeAction({
      recoveryCase: makeCase(),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.result).toBe("FAILURE");
    expect(result.recoveredAmountPaise).toBe(0);
    expect(result.paymentLink).toBeNull();
    expect(result.notes).toContain("boom");
  });

  it("returns FAILURE when razorpay is not configured (no silent success)", async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_MERCHANT_ID;
    const result = await provider.executeAction({
      recoveryCase: makeCase(),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
    });
    expect(result.result).toBe("FAILURE");
    expect(result.paymentLink).toBeNull();
    expect(result.recoveredAmountPaise).toBe(0);
  });

  it("does not leak secrets or PII anywhere in the payment link request", async () => {
    mockFetchOk({ id: "plink_safe", short_url: "https://rzp.io/l/safe" });
    await provider.executeAction({
      recoveryCase: makeCase(),
      action: "RETRY_PAYMENT",
      attemptNumber: 1,
      now: new Date(),
      interventionId: "iv_safe",
    });
    const serialized = JSON.stringify(capturedRequest);
    expect(serialized).not.toContain("rzp_test_");
    expect(serialized).not.toContain("key_secret");
    expect(serialized).not.toContain("whsec_");
    expect(serialized).not.toContain("priya@example.com");
  });
});
