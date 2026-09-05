import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchPaymentLink } from "../client";
import type { RazorpayConfig } from "../config";

const config: RazorpayConfig = {
  keyId: "rzp_test_x",
  keySecret: "secret_x",
  webhookSecret: "whsec_x",
  merchantId: "merchant_x",
  apiBaseUrl: "https://api.razorpay.com/v1",
};

function mockLinkFetch(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    }))
  );
}

describe("fetchPaymentLink payments[] parsing (real Razorpay shape)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1/2. parses payment_id as the payment identifier", async () => {
    mockLinkFetch({
      id: "plink_test123",
      amount: 4037400,
      amount_paid: 4037400,
      currency: "INR",
      status: "paid",
      notes: {
        recoverai_case_id: "case123",
        recoverai_intervention_id: "intervention123",
      },
      payments: [
        {
          amount: 4037400,
          payment_id: "pay_test123",
          status: "captured",
        },
      ],
    });

    const result = await fetchPaymentLink(config, "plink_test123");
    expect(result.ok).toBe(true);
    expect(result.link).toBeTruthy();
    expect(result.link!.payments.length).toBe(1);
    expect(result.link!.payments[0].id).toBe("pay_test123");
    expect(result.link!.payments[0].amount).toBe(4037400);
    expect(result.link!.payments[0].status).toBe("captured");
  });

  it("id fallback still works when payment_id is absent", async () => {
    mockLinkFetch({
      id: "plink_fallback",
      amount: 100_000,
      amount_paid: 100_000,
      currency: "INR",
      status: "paid",
      payments: [{ id: "pay_legacy", amount: 100_000, status: "captured" }],
    });

    const result = await fetchPaymentLink(config, "plink_fallback");
    expect(result.ok).toBe(true);
    expect(result.link!.payments.length).toBe(1);
    expect(result.link!.payments[0].id).toBe("pay_legacy");
  });

  it("entries without any identifier are discarded; valid ones are kept", async () => {
    mockLinkFetch({
      id: "plink_mixed",
      amount: 100_000,
      amount_paid: 100_000,
      currency: "INR",
      status: "paid",
      payments: [
        { amount: 100_000, status: "captured" },
        { amount: 100_000, payment_id: "pay_kept", status: "captured" },
      ],
    });

    const result = await fetchPaymentLink(config, "plink_mixed");
    expect(result.ok).toBe(true);
    expect(result.link!.payments.length).toBe(1);
    expect(result.link!.payments[0].id).toBe("pay_kept");
  });

  it("missing link id is a safe failure", async () => {
    mockLinkFetch({ status: "paid", payments: [] });

    const result = await fetchPaymentLink(config, "plink_noid");
    expect(result.ok).toBe(false);
  });
});
