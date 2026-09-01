import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getRazorpayConfig } from "@/lib/razorpay/config";
import { verifyWebhookSignature } from "@/lib/razorpay/webhook";
import { handlePaymentFailed, handlePaymentLinkPaid } from "@/lib/razorpay/handler";

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

  const existingEvent = await prisma.razorpayWebhookEvent.findUnique({
    where: { eventId: dedupeKey },
  });
  if (existingEvent) {
    return NextResponse.json({ ok: true, status: "already_processed" });
  }

  await prisma.razorpayWebhookEvent.create({
    data: {
      eventId: dedupeKey,
      eventType: eventType ?? "unknown",
      status: "PROCESSED",
    },
  });

  if (eventType === "payment.failed") {
    if (!paymentEntityRaw || typeof paymentEntityRaw !== "object") {
      return NextResponse.json(
        { error: "Missing payment entity in payload." },
        { status: 400 }
      );
    }

    const paymentId =
      typeof paymentEntityRaw.id === "string" ? paymentEntityRaw.id : null;
    if (!paymentId) {
      return NextResponse.json(
        { error: "Missing payment ID." },
        { status: 400 }
      );
    }

    const result = await handlePaymentFailed(
      prisma,
      config.merchantId,
      paymentId,
      paymentEntityRaw as Parameters<typeof handlePaymentFailed>[3],
      dedupeKey
    );

    if (!result.ok) {
      await prisma.razorpayWebhookEvent.update({
        where: { eventId: dedupeKey },
        data: { status: "FAILED", errorMessage: result.error },
      });
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      ok: true,
      caseId: result.caseId,
      transactionId: result.transactionId,
    });
  }

  if (eventType === "payment_link.paid") {
    const paymentLinkWrap = (payload?.payment_link ?? null) as Record<string, unknown> | null;
    const paymentLinkEntity = (paymentLinkWrap?.entity ?? null) as Record<string, unknown> | null;

    if (!paymentLinkEntity || typeof paymentLinkEntity !== "object") {
      return NextResponse.json(
        { error: "Missing payment_link entity in payload." },
        { status: 400 }
      );
    }
    if (!paymentEntityRaw || typeof paymentEntityRaw !== "object") {
      return NextResponse.json(
        { error: "Missing payment entity in payload." },
        { status: 400 }
      );
    }

    const paymentLinkId =
      typeof paymentLinkEntity.id === "string" ? paymentLinkEntity.id : null;
    const paymentId =
      typeof paymentEntityRaw.id === "string" ? paymentEntityRaw.id : null;

    if (!paymentLinkId || !paymentId) {
      return NextResponse.json(
        { error: "Missing payment link or payment ID." },
        { status: 400 }
      );
    }

    const result = await handlePaymentLinkPaid(
      prisma,
      config.merchantId,
      paymentLinkId,
      paymentEntityRaw as Parameters<typeof handlePaymentLinkPaid>[3],
      dedupeKey
    );

    if (!result.ok) {
      await prisma.razorpayWebhookEvent.update({
        where: { eventId: dedupeKey },
        data: { status: "FAILED", errorMessage: result.error },
      });
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      ok: true,
      caseId: result.caseId,
    });
  }

  return NextResponse.json({ ok: true, status: "event_ignored" });
}
