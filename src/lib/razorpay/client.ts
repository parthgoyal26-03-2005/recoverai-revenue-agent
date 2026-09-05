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

export type RazorpayLinkPayment = {
  id: string;
  amount?: number;
  currency?: string;
  status?: string;
};

export type FetchedPaymentLink = {
  id: string;
  status?: string;
  amount?: number;
  amount_paid?: number;
  currency?: string;
  reference_id?: string;
  short_url?: string;
  notes?: Record<string, unknown>;
  payments: RazorpayLinkPayment[];
};

export type FetchPaymentLinkResult = {
  ok: boolean;
  status: number;
  link?: FetchedPaymentLink;
  error?: string;
};

/**
 * Server-side fetch of a Razorpay Payment Link (GET /v1/payment_links/:id).
 * Used by payment-status reconciliation. Never exposes credentials —
 * auth stays in the Authorization header.
 */
export async function fetchPaymentLink(
  config: RazorpayConfig,
  paymentLinkId: string
): Promise<FetchPaymentLinkResult> {
  const response = await razorpayApiRequest(
    config,
    `/payment_links/${encodeURIComponent(paymentLinkId)}`,
    "GET"
  );

  if (!response.found || !response.data) {
    return {
      ok: false,
      status: response.status,
      error: response.error ?? "Failed to fetch payment link.",
    };
  }

  const d = response.data;
  const rawPayments = Array.isArray(d.payments) ? d.payments : [];
  const payments: RazorpayLinkPayment[] = [];
  for (const p of rawPayments) {
    if (p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string") {
      const po = p as Record<string, unknown>;
      payments.push({
        id: po.id as string,
        amount: typeof po.amount === "number" ? po.amount : undefined,
        currency: typeof po.currency === "string" ? po.currency : undefined,
        status: typeof po.status === "string" ? po.status : undefined,
      });
    }
  }

  if (typeof d.id !== "string") {
    return { ok: false, status: 502, error: "Razorpay responded without a payment link id." };
  }

  return {
    ok: true,
    status: response.status,
    link: {
      id: d.id,
      status: typeof d.status === "string" ? d.status : undefined,
      amount: typeof d.amount === "number" ? d.amount : undefined,
      amount_paid: typeof d.amount_paid === "number" ? d.amount_paid : undefined,
      currency: typeof d.currency === "string" ? d.currency : undefined,
      reference_id: typeof d.reference_id === "string" ? d.reference_id : undefined,
      short_url: typeof d.short_url === "string" ? d.short_url : undefined,
      notes:
        d.notes && typeof d.notes === "object"
          ? (d.notes as Record<string, unknown>)
          : undefined,
      payments,
    },
  };
}
