export type RazorpayConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  merchantId: string;
  apiBaseUrl: string;
};

export function getRazorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  const merchantId = process.env.RAZORPAY_MERCHANT_ID?.trim();

  if (!keyId || !keySecret || !webhookSecret || !merchantId) {
    return null;
  }

  return {
    keyId,
    keySecret,
    webhookSecret,
    merchantId,
    apiBaseUrl:
      process.env.RAZORPAY_API_BASE_URL?.trim() ||
      "https://api.razorpay.com/v1",
  };
}

export function isRazorpayConfigured(): boolean {
  return getRazorpayConfig() !== null;
}

export function maskKeyId(keyId: string): string {
  if (keyId.length <= 8) return "rzp_test_****";
  return keyId.slice(0, 7) + "****" + keyId.slice(-4);
}
