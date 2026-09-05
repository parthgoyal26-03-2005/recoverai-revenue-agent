import Link from "next/link";
import { ScrollText } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { timeAgo } from "@/lib/domain/format";
import { eventLabel, shortId } from "@/lib/domain/present";
import { clsx } from "clsx";

export const dynamic = "force-dynamic";

const ACTOR_STYLES: Record<string, string> = {
  AI: "bg-[#5B7CFF]/10 text-[#9DB1FF] ring-[#5B7CFF]/25",
  POLICY_ENGINE: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
  SYSTEM: "bg-white/[0.05] text-[#A3ADBD] ring-white/10",
  MERCHANT: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
};

export default async function AuditPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { recoveryCase: { select: { customer: { select: { name: true } } } } },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Audit Trail"
        subtitle="Every AI decision, policy evaluation, and recovery action — latest 100, immutable."
      />

      <Card>
        <CardBody className="!px-0 !py-0">
          {logs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={ScrollText}
                title="No audit activity"
                body="Recovery actions will appear here as they occur."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[#171717]">
              {logs.map((log) => (
                <li key={log.id} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className={clsx(
                      "inline-flex shrink-0 border px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                      ACTOR_STYLES[log.actor] ?? "bg-white/[0.05] text-[#A3ADBD] ring-white/10"
                    )}
                  >
                    {log.actor.charAt(0) + log.actor.slice(1).toLowerCase().replace("_", " ")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-[#F7F9FC]">
                      {eventLabel(log.event)}
                    </p>
                    <p className="truncate text-[12px] text-[#6F7A89]">
                      {log.recoveryCase?.customer?.name ?? "Unknown"} ·{" "}
                      <Link
                        href={`/cases/${log.recoveryCaseId}`}
                        className="font-mono hover:text-[#9DB1FF]"
                        title={log.recoveryCaseId}
                      >
                        {shortId(log.recoveryCaseId)}
                      </Link>
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] whitespace-nowrap text-[#6F7A89]">
                    {timeAgo(log.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
