"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 4500;
const MAX_NETWORK_FAILURES = 5;

const TERMINAL_SYNC_STATUSES = new Set([
  "recovered",
  "already_recovered",
  "expired",
  "cancelled",
]);

async function postSync(caseId: string): Promise<{ status?: string; error?: string }> {
  const res = await fetch(`/api/recovery/cases/${caseId}/sync-payment`, {
    method: "POST",
  });
  try {
    return (await res.json()) as { status?: string; error?: string };
  } catch {
    return {};
  }
}

/**
 * Polls server-side payment status ONLY while a Razorpay payment is
 * outstanding (parent renders this solely for IN_PROGRESS cases with an
 * AWAITING_PAYMENT intervention). Refreshes once the case settles and stops.
 */
export function PaymentStatusPoller({ caseId }: { caseId: string }) {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (stopped.current) return;
      let data: { status?: string };
      try {
        data = await postSync(caseId);
      } catch {
        failures += 1;
        if (!stopped.current && failures < MAX_NETWORK_FAILURES) {
          timer = setTimeout(check, POLL_INTERVAL_MS);
        }
        return;
      }
      if (stopped.current) return;
      if (data.status && TERMINAL_SYNC_STATUSES.has(data.status)) {
        router.refresh();
        return;
      }
      timer = setTimeout(check, POLL_INTERVAL_MS);
    };

    timer = setTimeout(check, POLL_INTERVAL_MS);
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [caseId, router]);

  return null;
}

/** Manual fallback next to the awaiting-payment panel (demo-safe). */
export function CheckPaymentButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setFeedback(null);
    try {
      const data = await postSync(caseId);
      if (data.status === "recovered" || data.status === "already_recovered") {
        setFeedback("Payment confirmed — refreshing.");
        router.refresh();
      } else if (data.status === "pending" || data.status === "unknown") {
        setFeedback("Still waiting for customer payment.");
      } else if (data.status === "expired" || data.status === "cancelled") {
        setFeedback(`Payment link ${data.status} — refreshing.`);
        router.refresh();
      } else if (data.status === "mismatch") {
        setFeedback(data.error ?? "Payment could not be matched to this case.");
      } else if (data.status === "no_pending_payment") {
        setFeedback("No payment is currently awaiting confirmation.");
        router.refresh();
      } else {
        setFeedback(data.error ?? "Could not check payment status.");
      }
    } catch {
      setFeedback("Network error while checking payment status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={check}
        disabled={busy}
        className="border border-white/10 bg-black px-3 py-1.5 text-[12px] font-medium text-[#F7F9FC] transition-colors hover:border-white/25 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Check payment status"}
      </button>
      {feedback && <span className="text-[12px] text-[#A3ADBD]">{feedback}</span>}
    </span>
  );
}
