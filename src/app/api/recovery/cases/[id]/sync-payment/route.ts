import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getRazorpayConfig } from "@/lib/razorpay/config";
import { syncPaymentLinkStatus } from "@/lib/razorpay/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-side payment-status sync (reconciliation fallback for the
 * `payment_link.paid` webhook). Fetches the case's outstanding Razorpay
 * Payment Link with server credentials and acts on its authoritative status.
 * Never trusts browser claims; never creates payment links; never consumes
 * retries.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const config = getRazorpayConfig();
  if (!config) {
    return NextResponse.json(
      { status: "error", error: "Razorpay is not configured." },
      { status: 500 }
    );
  }

  const result = await syncPaymentLinkStatus(prisma, config, id);

  switch (result.outcome) {
    case "recovered":
      return NextResponse.json({
        status: "recovered",
        caseId: result.caseId,
        recoveredAmountPaise: result.recoveredAmountPaise,
      });
    case "already_recovered":
      return NextResponse.json({ status: "already_recovered", caseId: result.caseId });
    case "pending":
    case "unknown":
      return NextResponse.json({ status: result.outcome });
    case "expired":
    case "cancelled":
      return NextResponse.json({ status: result.outcome, caseId: id });
    case "mismatch":
      return NextResponse.json(
        { status: "mismatch", error: result.error },
        { status: 409 }
      );
    case "no_pending_payment":
    case "not_found":
      return NextResponse.json(
        { status: result.outcome, error: result.error },
        { status: 404 }
      );
    case "error":
    default:
      return NextResponse.json(
        { status: "error", error: result.error },
        { status: 502 }
      );
  }
}
