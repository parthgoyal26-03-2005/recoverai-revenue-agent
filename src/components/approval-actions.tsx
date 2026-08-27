"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ApprovalActionsProps = {
  caseId: string;
  requiresApproval: boolean;
  approved: boolean;
  approvedAt?: string | null;
  rejected: boolean;
  rejectionReason?: string | null;
};

export function ApprovalActions(props: ApprovalActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(props.approvedAt ?? null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function act(kind: "approve" | "reject") {
    setBusy(kind);
    setFeedback(null);
    try {
      const res = await fetch(`/api/recovery/cases/${props.caseId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: kind === "reject" ? JSON.stringify({ reason }) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error ?? `${kind} failed.`);
      } else if (kind === "approve") {
        setApprovedAt(data.approvedAt ?? new Date().toISOString());
        setFeedback("✓ RECOVERY APPROVED — execution is now unlocked below.");
      } else {
        setFeedback("Recovery rejected. This case can no longer be executed.");
      }
      router.refresh();
    } catch {
      setFeedback("Network error.");
    } finally {
      setBusy(null);
    }
  }

  const showButtons =
    props.requiresApproval && !props.approved && !props.rejected;

  return (
    <div className="space-y-3">
      {showButtons ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => act("approve")}
              disabled={busy !== null}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "approve" ? "Approving…" : "Approve Recovery"}
            </button>
            <button
              type="button"
              onClick={() => setRejectOpen((v) => !v)}
              disabled={busy !== null}
              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Reject Recovery
            </button>
          </div>
          {rejectOpen && (
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => act("reject")}
                disabled={busy !== null}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busy === "reject" ? "Rejecting…" : "Confirm Rejection"}
              </button>
            </div>
          )}
        </>
      ) : props.approved || approvedAt ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <span className="font-bold">✓ RECOVERY APPROVED</span>
          {approvedAt && (
            <span className="ml-2 text-xs text-emerald-600">
              at {new Date(approvedAt).toLocaleString("en-IN")}
            </span>
          )}
        </div>
      ) : props.rejected ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="font-bold">REJECTED BY MERCHANT</span>
          {props.rejectionReason && ` — ${props.rejectionReason}`}
        </div>
      ) : null}

      {feedback && (
        <p
          className={`text-sm ${
            feedback.startsWith("✓") ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {feedback}
        </p>
      )}
    </div>
  );
}
