import { NextResponse } from "next/server";
import { testRazorpayConnection } from "@/lib/razorpay/client";
import { getRazorpayConfig, maskKeyId } from "@/lib/razorpay/config";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = getRazorpayConfig();

  const result = await testRazorpayConnection();

  return NextResponse.json({
    connected: result.connected,
    mode: result.mode,
    keyId: config ? maskKeyId(config.keyId) : null,
    ...(result.reason ? { reason: result.reason } : {}),
  });
}
