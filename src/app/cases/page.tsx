import Link from "next/link";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatINR, timeAgo } from "@/lib/domain/format";
import { scenarioLabel, shortId } from "@/lib/domain/present";
import { DEFAULT_POLICY } from "@/lib/domain/types";
import { evaluatePolicy } from "@/lib/policy/engine";
import {
  computeApprovalAttention,
  getCaseRowAction,
} from "@/lib/analytics/metrics";
import { clsx } from "clsx";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All", href: "/cases" },
  { key: "approval", label: "Needs Attention", href: "/cases?filter=approval" },
  { key: "progress", label: "In Progress", href: "/cases?filter=progress" },
  { key: "recovered", label: "Recovered", href: "/cases?filter=recovered" },
  { key: "stopped", label: "Stopped", href: "/cases?filter=stopped" },
] as const;

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const active = filter ?? "all";

  const where =
    active === "approval"
      ? { status: "ESCALATED" as const, merchantApproved: false, merchantRejectedAt: null }
      : active === "progress"
        ? { status: { in: ["DETECTED", "DIAGNOSED", "IN_PROGRESS"] as ("DETECTED" | "DIAGNOSED" | "IN_PROGRESS")[] } }
        : active === "recovered"
          ? { status: "RECOVERED" as const }
          : active === "stopped"
            ? { status: { in: ["STOPPED", "FAILED", "REJECTED"] as ("STOPPED" | "FAILED" | "REJECTED")[] } }
            : undefined;

  const [cases, policyRow] = await Promise.all([
    prisma.recoveryCase.findMany({
      where,
      orderBy: [{ merchantRejectedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
      include: {
        customer: { select: { name: true, email: true } },
        interventions: {
          where: { status: "SCHEDULED" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma.recoveryPolicy.findFirst(),
  ]);

  const config = policyRow
    ? {
        ...DEFAULT_POLICY,
        maxRetries: policyRow.maxRetries,
        maxContactAttempts: policyRow.maxContactAttempts,
        recoveryWindowHours: policyRow.recoveryWindowHours,
        approvalThresholdPaise: policyRow.approvalThreshold,
      }
    : DEFAULT_POLICY;

  const allForAttention = await prisma.recoveryCase.findMany({
    where: { status: "ESCALATED" },
    select: {
      status: true,
      amountAtRisk: true,
      merchantApproved: true,
      merchantRejectedAt: true,
    },
  });
  const attention = computeApprovalAttention(allForAttention);
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery Cases"
        subtitle="All detected revenue recovery opportunities, with the policy-derived next step for each."
      />

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Case filters">
        {TABS.map((t) => {
          const isActive = active === t.key || (t.key === "all" && active !== "approval" && active !== "progress" && active !== "recovered" && active !== "stopped");
          return (
            <Link
              key={t.key}
              href={t.href}
              role="tab"
              aria-selected={isActive}
              className={clsx(
                "border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
                isActive
                  ? "border-[#5B7CFF]/50 bg-[#5B7CFF]/10 text-white"
                  : "border-white/10 bg-transparent text-[#A3ADBD] hover:border-white/25 hover:text-white"
              )}
            >
              {t.label}
              {t.key === "approval" && attention.cases > 0 ? ` (${attention.cases})` : ""}
            </Link>
          );
        })}
      </div>

      {attention.cases > 0 && active !== "approval" && (
        <Link
          href="/cases?filter=approval"
          className="flex flex-wrap items-center justify-between gap-3 border border-amber-400/25 bg-black px-5 py-4 transition-colors hover:border-amber-400/40"
        >
          <div>
            <p className="text-sm font-semibold text-amber-200">Requires your attention</p>
            <p className="text-[12.5px] text-amber-200/70">
              High-value recoveries are waiting for your approval.
            </p>
          </div>
          <p className="text-lg font-semibold text-amber-200 tabular-nums">
            {attention.cases} cases · {formatINR(attention.amountPaise)}
          </p>
        </Link>
      )}

      <Card>
        <CardBody className="!px-0 !py-0">
          {cases.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={BadgeCheck}
                title={active === "approval" ? "No cases need attention" : "No recovery cases"}
                body={
                  active === "approval"
                    ? "All active cases are currently within recovery policy limits."
                    : "Recovery cases will appear here as they are detected."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-[13.5px]">
                <thead>
                  <tr className="text-[11px] font-medium tracking-[0.06em] text-[#6F7A89] uppercase">
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Scenario</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Risk</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Next step</th>
                    <th className="px-5 py-3 font-medium"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => {
                    const evaluation = evaluatePolicy(
                      {
                        scenario: c.scenario,
                        amountAtRiskPaise: c.amountAtRisk,
                        retryCount: c.retryCount,
                        contactCount: c.contactCount,
                        windowExpiresAt: c.windowExpiresAt,
                        merchantApproved: c.merchantApproved,
                        now,
                      },
                      config
                    );
                    const rowAction = getCaseRowAction({
                      status: c.status,
                      merchantApproved: c.merchantApproved,
                      merchantRejectedAt: c.merchantRejectedAt,
                      windowExpiresAt: c.windowExpiresAt,
                      hasScheduledIntervention: c.interventions.length > 0,
                      allowedProgressAction: evaluation.allowedActions.some(
                        (a) =>
                          a === "RETRY_PAYMENT" ||
                          a === "SCHEDULE_RETRY" ||
                          a === "SEND_REMINDER" ||
                          a === "OFFER_ASSISTANCE"
                      ),
                    });
                    return (
                      <tr
                        key={c.id}
                        className="border-t border-[#171717] transition-colors hover:bg-[#080808]"
                      >
                        <td className="px-5 py-3">
                          <p className="font-medium text-[#F7F9FC]">{c.customer.name}</p>
                          <p className="font-mono text-[11px] text-[#6F7A89]">{shortId(c.id)} · {timeAgo(c.createdAt)}</p>
                        </td>
                        <td className="px-4 py-3 text-[#A3ADBD]">{scenarioLabel(c.scenario)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#F7F9FC] tabular-nums">
                          {formatINR(c.amountAtRisk)}
                        </td>
                        <td className="px-4 py-3"><StatusBadge value={c.priority} /></td>
                        <td className="px-4 py-3"><StatusBadge value={c.status} dot /></td>
                        <td className="px-4 py-3 text-[12.5px] text-[#A3ADBD]">{rowAction.label}</td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            href={`/cases/${c.id}`}
                            aria-label={`View case for ${c.customer.name}`}
                            className="inline-flex items-center gap-1 border border-white/10 bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-[#F7F9FC] transition-colors hover:border-[#5B7CFF]/50 hover:bg-[#5B7CFF]/10"
                          >
                            View <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
