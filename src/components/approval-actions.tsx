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
              className="bg-[#5B7CFF] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4A6DF5] disabled:opacity-50"
            >
              {busy === "approve" ? "Approving…" : "Approve Recovery"}
            </button>
            <button
              type="button"
              onClick={() => setRejectOpen((v) => !v)}
              disabled={busy !== null}
              className="border border-red-400/30 bg-black px-4 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-50"
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
                className="min-w-[220px] flex-1 border border-white/10 bg-black px-3 py-2 text-sm text-[#F7F9FC] placeholder:text-[#6F7A89] focus:border-red-400/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => act("reject")}
                disabled={busy !== null}
                className="bg-red-400 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-red-300 disabled:opacity-50"
              >
                {busy === "reject" ? "Rejecting…" : "Confirm Rejection"}
              </button>
            </div>
          )}
        </>
      ) : props.approved || approvedAt ? (
        <div className="border border-emerald-400/25 bg-black p-3 text-sm text-emerald-200">
          <span className="font-bold">✓ RECOVERY APPROVED</span>
          {approvedAt && (
            <span className="ml-2 text-xs text-emerald-300/80">
              at {new Date(approvedAt).toLocaleString("en-IN")}
            </span>
          )}
        </div>
      ) : props.rejected ? (
        <div className="border border-red-400/25 bg-black p-3 text-sm text-red-200">
          <span className="font-bold">REJECTED BY MERCHANT</span>
          {props.rejectionReason && ` — ${props.rejectionReason}`}
        </div>
      ) : null}

      {feedback && (
        <p
          className={`text-sm ${
            feedback.startsWith("✓") ? "text-emerald-300" : "text-red-300"
          }`}
        >
          {feedback}
        </p>
      )}
    </div>
  );
}
