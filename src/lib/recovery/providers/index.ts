import { isRazorpayConfigured } from "@/lib/razorpay/config";
import { SimulationProvider } from "./simulation";
import { RazorpayProvider } from "./razorpay";
import type { RecoveryProvider } from "./types";

let cachedProvider: RecoveryProvider | null = null;

export function getRecoveryProvider(): RecoveryProvider {
  if (cachedProvider) return cachedProvider;

  const selected = process.env.PAYMENT_PROVIDER?.trim();

  if (selected === "razorpay") {
    if (!isRazorpayConfigured()) {
      throw new Error(
        "PAYMENT_PROVIDER is set to 'razorpay' but Razorpay credentials are missing. " +
          "Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET and RAZORPAY_MERCHANT_ID, " +
          "or set PAYMENT_PROVIDER=simulation. Refusing to silently fall back."
      );
    }
    cachedProvider = new RazorpayProvider();
  } else {
    cachedProvider = new SimulationProvider();
  }

  return cachedProvider;
}

export function resetRecoveryProviderCache(): void {
  cachedProvider = null;
}
