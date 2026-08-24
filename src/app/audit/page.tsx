import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { timeAgo } from "@/lib/domain/format";

export const dynamic = "force-dynamic";

const ACTOR_STYLES: Record<string, string> = {
  AI: "bg-violet-100 text-violet-700",
  POLICY_ENGINE: "bg-blue-100 text-blue-700",
  SYSTEM: "bg-slate-100 text-slate-600",
  MERCHANT: "bg-emerald-100 text-emerald-700",
};

export default async function AuditPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-500">
          Every AI decision, policy evaluation, and recovery action (latest 100)
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y divide-slate-100">
          {logs.map((log) => (
            <li key={log.id} className="flex items-start gap-4 px-5 py-3.5">
              <span
                className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  ACTOR_STYLES[log.actor] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {log.actor.replace(/_/g, " ")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{log.event}</p>
                <p className="truncate text-xs text-slate-400">
                  Case{" "}
                  <Link
                    href="/cases"
                    className="font-mono hover:text-emerald-700"
                  >
                    {log.recoveryCaseId.slice(-8)}
                  </Link>
                  {log.metadata
                    ? ` · ${JSON.stringify(log.metadata).slice(0, 120)}`
                    : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs whitespace-nowrap text-slate-400">
                {timeAgo(log.createdAt)}
              </span>
            </li>
          ))}
          {logs.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-slate-400">
              No audit entries yet.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
