import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getRazorpayConfig } from "@/lib/razorpay/config";
import { verifyWebhookSignature } from "@/lib/razorpay/webhook";
import { dispatchRazorpayEvent } from "@/lib/razorpay/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = getRazorpayConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Razorpay is not configured." },
      { status: 500 }
    );
  }

  // Raw body is required for HMAC-SHA256 verification — never parse first.
  const rawBody = await request.text();

  const signatureHeader = request.headers.get("x-razorpay-signature");
  if (!signatureHeader) {
    return NextResponse.json(
      { error: "Missing webhook signature." },
      { status: 400 }
    );
  }

  if (!verifyWebhookSignature(rawBody, signatureHeader, config.webhookSecret)) {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const eventType =
    typeof body.event === "string" ? body.event : null;
  const payload = (body.payload ?? null) as Record<string, unknown> | null;
  const paymentWrap = (payload?.payment ?? null) as Record<string, unknown> | null;
  const paymentEntityRaw = (paymentWrap?.entity ?? null) as Record<string, unknown> | null;
  const eventId =
    typeof paymentEntityRaw?.id === "string" ? paymentEntityRaw.id : null;
  const razorpayEventId = request.headers.get("x-razorpay-event-id");

  const dedupeKey = razorpayEventId ?? eventId ?? `unknown-${Date.now()}`;

  // Lifecycle (reserve → process → mark) lives in the dispatcher so it is
  // unit-testable and shared: PROCESSED is only recorded after the handler
  // commits, FAILED events can be safely retried.
  const result = await dispatchRazorpayEvent(prisma, config, {
    dedupeKey,
    eventType,
    payload,
  });
  return NextResponse.json(result.body, { status: result.httpStatus });
}
