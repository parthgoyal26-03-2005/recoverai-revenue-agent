"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CaseActionsProps = {
  caseId: string;
  eligible: boolean;
  allowedActions: string[];
  blocked: { action: string; reason: string }[];
  requiresApproval: boolean;
  merchantApproved: boolean;
  /**
   * Outstanding Razorpay payment, if any. While present, RETRY_PAYMENT is
   * hidden — at most one recovery payment may be outstanding per case.
   * (The server orchestrator enforces this independently.)
   */
  paymentPending?: { id?: string | null; url?: string | null } | null;
};

const ACTION_LABELS: Record<string, string> = {
  RETRY_PAYMENT: "Retry Payment",
  SCHEDULE_RETRY: "Schedule Retry",
  SEND_REMINDER: "Send Reminder",
  OFFER_ASSISTANCE: "Offer Assistance",
  ESCALATE_TO_MERCHANT: "Escalate to Merchant",
  STOP_RECOVERY: "Stop Recovery",
};

export function CaseActions(props: CaseActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  async function call(path: string, body?: unknown, label = "request") {
    setBusy(label);
    setFeedback(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.message ?? data.error ?? "Request failed." });
      } else {
        const parts: string[] = [];
        if (data.messages) parts.push(...data.messages);
        if (data.message) parts.push(data.message);
        if (data.processed !== undefined) parts.push(data.message ?? "");
        setFeedback({
          ok: true,
          text:
            parts.filter(Boolean).join(" ") ||
            (data.action ? `${data.action} completed.` : "Done."),
        });
      }
      router.refresh();
    } catch {
      setFeedback({ ok: false, text: "Network error. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  const visibleActions = props.paymentPending
    ? props.allowedActions.filter((a) => a !== "RETRY_PAYMENT")
    : props.allowedActions;

  return (
    <div className="space-y-4">
      {props.paymentPending && (
        <div className="border border-emerald-400/25 bg-black p-3 text-sm text-emerald-200">
          A recovery payment is already awaiting customer payment — no further
          payment action is available until it settles.
        </div>
      )}
      {props.requiresApproval && !props.merchantApproved && (
        <div className="border border-amber-400/25 bg-black p-3 text-sm text-amber-200">
          High-value case: your approval is required before recovery can continue.
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => call(`/api/recovery/cases/${props.caseId}/approve`, undefined, "approve")}
            className="ml-2 bg-amber-400 px-2.5 py-1 text-xs font-semibold text-black transition-colors hover:bg-amber-300 disabled:opacity-50"
          >
            {busy === "approve" ? "Approving…" : "Approve Recovery"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            call(`/api/recovery/cases/${props.caseId}/evaluate`, undefined, "evaluate")
          }
          className="border border-white/10 bg-black px-3 py-1.5 text-sm font-medium text-[#F7F9FC] transition-colors hover:border-white/25 disabled:opacity-50"
        >
          {busy === "evaluate" ? "Evaluating…" : "Evaluate Recovery"}
        </button>

        {visibleActions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={busy !== null}
            onClick={() =>
              call(
                `/api/recovery/cases/${props.caseId}/execute`,
                { action },
                action
              )
            }
            className={
              action === "STOP_RECOVERY"
                ? "border border-red-400/30 bg-black px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-50"
                : "bg-[#5B7CFF] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#4A6DF5] disabled:opacity-50"
            }
          >
            {busy === action ? "Executing…" : `Execute: ${ACTION_LABELS[action] ?? action}`}
          </button>
        ))}

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => call("/api/recovery/run-due", undefined, "run-due")}
          className="border border-white/10 bg-black px-3 py-1.5 text-sm font-medium text-[#F7F9FC] transition-colors hover:border-white/25 disabled:opacity-50"
        >
          {busy === "run-due" ? "Processing…" : "Run Due Scheduled Actions"}
        </button>
      </div>

      {!props.eligible && visibleActions.length === 0 && !props.paymentPending && (
        <p className="text-sm text-red-300">
          No recovery actions are currently allowed by policy.
        </p>
      )}

      {props.blocked.length > 0 && (
        <div className="border border-[#1A1A1A] bg-black p-3">
          <p className="text-xs font-semibold tracking-wide text-[#6F7A89] uppercase">
            Blocked by policy
          </p>
          <ul className="mt-2 space-y-1">
            {props.blocked.map((b) => (
              <li key={b.action} className="text-xs text-[#A3ADBD]">
                <span className="font-mono font-semibold text-[#F7F9FC]">{b.action}</span> — {b.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback && (
        <div
          className={`border p-3 text-sm ${
            feedback.ok
              ? "border-emerald-400/25 bg-black text-emerald-200"
              : "border-red-400/25 bg-black text-red-200"
          }`}
        >
          {feedback.text}
        </div>
      )}
    </div>
  );
}
