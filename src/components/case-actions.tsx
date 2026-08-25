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

  return (
    <div className="space-y-4">
      {props.requiresApproval && !props.merchantApproved && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          High-value case: your approval is required before recovery can continue.
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => call(`/api/recovery/cases/${props.caseId}/approve`, undefined, "approve")}
            className="ml-2 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
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
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "evaluate" ? "Evaluating…" : "Evaluate Recovery"}
        </button>

        {props.allowedActions.map((action) => (
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
                ? "rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                : "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            }
          >
            {busy === action ? "Executing…" : `Execute: ${ACTION_LABELS[action] ?? action}`}
          </button>
        ))}

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => call("/api/recovery/run-due", undefined, "run-due")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "run-due" ? "Processing…" : "Run Due Scheduled Actions"}
        </button>
      </div>

      {!props.eligible && props.allowedActions.length === 0 && (
        <p className="text-sm text-rose-700">
          No recovery actions are currently allowed by policy.
        </p>
      )}

      {props.blocked.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Blocked by policy
          </p>
          <ul className="mt-2 space-y-1">
            {props.blocked.map((b) => (
              <li key={b.action} className="text-xs text-slate-600">
                <span className="font-mono font-semibold">{b.action}</span> — {b.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            feedback.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {feedback.text}
        </div>
      )}
    </div>
  );
}
