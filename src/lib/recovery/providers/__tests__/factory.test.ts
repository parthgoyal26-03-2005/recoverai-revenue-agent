import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRecoveryProvider, resetRecoveryProviderCache } from "../index";
import { SimulationProvider } from "../simulation";
import { RazorpayProvider } from "../razorpay";

const origEnv = { ...process.env };

function setRazorpayEnv() {
  process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
  process.env.RAZORPAY_KEY_SECRET = "key_secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_abc";
  process.env.RAZORPAY_MERCHANT_ID = "merchant_1";
  process.env.RAZORPAY_API_BASE_URL = "https://api.razorpay.com/v1";
}

describe("recovery provider factory", () => {
  beforeEach(() => resetRecoveryProviderCache());

  afterEach(() => {
    process.env = { ...origEnv };
    resetRecoveryProviderCache();
  });

  it("defaults to simulation when PAYMENT_PROVIDER is unset", () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(getRecoveryProvider()).toBeInstanceOf(SimulationProvider);
  });

  it("explicitly selects simulation via PAYMENT_PROVIDER=simulation", () => {
    process.env.PAYMENT_PROVIDER = "simulation";
    expect(getRecoveryProvider()).toBeInstanceOf(SimulationProvider);
  });

  it("selects razorpay when PAYMENT_PROVIDER=razorpay and credentials set", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    setRazorpayEnv();
    expect(getRecoveryProvider()).toBeInstanceOf(RazorpayProvider);
  });

  it("refuses to fall back silently when razorpay selected without credentials", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_MERCHANT_ID;
    expect(() => getRecoveryProvider()).toThrow(/razorpay/);
  });

  it("falls back to simulation for an unknown PAYMENT_PROVIDER value", () => {
    process.env.PAYMENT_PROVIDER = "nonsense";
    expect(getRecoveryProvider()).toBeInstanceOf(SimulationProvider);
  });

  it("resetRecoveryProviderCache clears the cached singleton", () => {
    process.env.PAYMENT_PROVIDER = "simulation";
    const first = getRecoveryProvider();
    process.env.PAYMENT_PROVIDER = "razorpay";
    setRazorpayEnv();
    expect(getRecoveryProvider()).toBe(first);
    resetRecoveryProviderCache();
    expect(getRecoveryProvider()).toEqual(new RazorpayProvider());
    expect(getRecoveryProvider()).not.toBe(first);
  });
});
