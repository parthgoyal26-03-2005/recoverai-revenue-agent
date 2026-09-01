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
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: Record<string, unknown>
): Promise<RazorpayApiResponse> {
  try {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: buildAuthHeader(config.keyId, config.keySecret),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
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

export type CreatePaymentLinkParams = {
  amount: number;
  currency: string;
  referenceId: string;
  expireBy: Date;
  description?: string;
  notes?: Record<string, string>;
};

export type CreatePaymentLinkResult = {
  ok: boolean;
  status: number;
  id?: string;
  url?: string;
  error?: string;
};

export async function createPaymentLink(
  config: RazorpayConfig,
  params: CreatePaymentLinkParams
): Promise<CreatePaymentLinkResult> {
  const expireByUnix = Math.floor(params.expireBy.getTime() / 1000);

  const response = await razorpayApiRequest(
    config,
    "/payment_links",
    "POST",
    {
      amount: params.amount,
      currency: params.currency,
      reference_id: params.referenceId,
      description: params.description ?? "RecoverAI recovery payment",
      accept_partial: false,
      expire_by: expireByUnix,
      notes: params.notes ?? {},
    }
  );

  if (!response.found || response.status !== 200) {
    return {
      ok: false,
      status: response.status,
      error: response.error ?? "Failed to create payment link.",
    };
  }

  const id =
    typeof response.data?.id === "string" ? response.data.id : undefined;
  const url =
    typeof response.data?.short_url === "string"
      ? response.data.short_url
      : undefined;

  if (!id || !url) {
    return {
      ok: false,
      status: 502,
      error: "Razorpay responded without a payment link id or url.",
    };
  }

  return { ok: true, status: 200, id, url };
}
