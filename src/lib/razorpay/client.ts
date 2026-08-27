import { getRazorpayConfig, type RazorpayConfig } from "./config";

type RazorpayApiResponse = {
  found: boolean;
  status: number;
  data?: Record<string, unknown>;
  error?: string;
};

function buildAuthHeader(keyId: string, keySecret: string): string {
  const token = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  return `Basic ${token}`;
}

export async function testRazorpayConnection(): Promise<{
  connected: boolean;
  mode: "test" | "unknown";
  reason?: string;
}> {
  const config = getRazorpayConfig();
  if (!config) {
    return { connected: false, mode: "unknown", reason: "Razorpay credentials are not configured." };
  }

  const mode = config.keyId.startsWith("rzp_test_") ? "test" : "unknown";

  try {
    const response = await fetch(`${config.apiBaseUrl}/payments?count=1`, {
      method: "GET",
      headers: {
        Authorization: buildAuthHeader(config.keyId, config.keySecret),
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      return { connected: true, mode };
    }

    if (response.status === 401) {
      return { connected: false, mode, reason: "Invalid Razorpay credentials." };
    }

    if (response.status === 403) {
      return { connected: false, mode, reason: "Razorpay credentials lack required permissions." };
    }

    const body = await response.text().catch(() => "");
    return {
      connected: false,
      mode,
      reason: `Razorpay API returned status ${response.status}.${body ? ` ${body.slice(0, 100)}` : ""}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { connected: false, mode, reason: `Network error: ${msg}` };
  }
}

export async function razorpayApiRequest(
  config: RazorpayConfig,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET"
): Promise<RazorpayApiResponse> {
  try {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: buildAuthHeader(config.keyId, config.keySecret),
        "Content-Type": "application/json",
      },
    });

    const data = await response.json().catch(() => null);

    if (response.ok) {
      return { found: true, status: response.status, data: data as Record<string, unknown> };
    }

    return {
      found: false,
      status: response.status,
      error: (data as { error?: { description?: string } })?.error?.description ?? `HTTP ${response.status}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { found: false, status: 500, error: `Network error: ${msg}` };
  }
}
