import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CircleDollarSign,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { AnimatedKpi, KpiCardStatic } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { BatchRunner } from "@/components/batch-runner";
import { DemoControls } from "@/components/demo-controls";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ScenarioPerformance } from "@/components/analytics/scenario-performance";
import { StatusBar } from "@/components/analytics/status-bar";
import { Pipeline } from "@/components/analytics/pipeline";
import { AiOutcomes } from "@/components/analytics/ai-outcomes";
import { formatINR, timeAgo } from "@/lib/domain/format";
import {
  actionLabel,
  eventLabel,
  formatCount,
  formatLakhINR,
  scenarioLabel,
  shortId,
} from "@/lib/domain/present";
import { getDashboardData } from "@/lib/analytics/metrics";

export const dynamic = "force-dynamic";

function currentAiProviderLabel() {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (selected === "gemini" && process.env.GEMINI_API_KEY) return { label: "Gemini", mock: false };
  if (selected === "groq" && process.env.GROQ_API_KEY) return { label: "Groq", mock: false };
  if (!selected && process.env.GEMINI_API_KEY) return { label: "Gemini", mock: false };
  if (!selected && process.env.GROQ_API_KEY) return { label: "Groq", mock: false };
  if (selected === "gemini") return { label: "Gemini", mock: false };
  if (selected === "groq") return { label: "Groq", mock: false };
  return { label: "Demo", mock: true };
}

function currentRecoveryLabel(): { label: string; isRazorpay: boolean } {
  const selected = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (selected === "razorpay") return { label: "Razorpay Test", isRazorpay: true };
  return { label: "Simulation", isRazorpay: false };
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  const provider = currentAiProviderLabel();
  const recovery = currentRecoveryLabel();

  const attentionCases = await prisma.recoveryCase.findMany({
    where: { status: "ESCALATED", merchantApproved: false, merchantRejectedAt: null },
    orderBy: { amountAtRisk: "desc" },
    take: 6,
    select: {
      id: true,
      scenario: true,
      status: true,
      amountAtRisk: true,
      createdAt: true,
      customer: { select: { name: true } },
    },
  });

  const aiOutcomeData = {
    analysesPerformed: data.aiPerformance.analysesPerformed,
    avgConfidencePct: data.aiPerformance.avgConfidencePct,
    acceptedCount: data.aiPerformance.acceptedCount,
    approvalRequiredCount: data.aiPerformance.approvalRequiredCount,
    blockedByPolicyCount: data.aiPerformance.blockedByPolicyCount,
    stoppedEvents: data.policySafety.stopped,
    terminalPrevented: data.policySafety.terminalPrevented,
  };

  const closedCount =
    data.statusBreakdown.find((s) => s.key === "closed")?.cases ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue Recovery"
        subtitle="Monitor revenue at risk, AI-driven interventions, and recovered revenue across payment failures."
        actions={
          <>
            <span className="border border-[#5B7CFF]/50 bg-black px-2 py-1 text-[11px] font-semibold tracking-[0.04em] text-[#9DB1FF] uppercase">
              AI: {provider.mock ? "Demo" : provider.label}
            </span>
            <span className="border border-emerald-400/40 bg-black px-2 py-1 text-[11px] font-semibold tracking-[0.04em] text-emerald-300 uppercase">
              Recovery: {recovery.label}
            </span>
          </>
        }
      />

      {/* Primary KPIs — shared boundaries, one black block */}
      <section aria-label="Key metrics" className="grid grid-cols-1 gap-px border border-[#1A1A1A] bg-[#1A1A1A] sm:grid-cols-2 xl:grid-cols-4">
        <AnimatedKpi
          label="Revenue at risk"
          target={data.hero.totalAtRiskPaise}
          format="lakh"
          sub={`${formatCount(data.hero.totalCases)} cases tracked`}
          tone="negative"
          icon={Wallet}
          bare
        />
        <AnimatedKpi
          label="Revenue recovered"
          target={data.hero.recoveredPaise}
          format="lakh"
          sub={`${formatCount(data.hero.recoveredCases)} cases recovered`}
          tone="positive"
          icon={CircleDollarSign}
          bare
        />
        <KpiCardStatic
          label="Recovery rate"
          displayValue={`${data.hero.recoveryRatePct}%`}
          sub="share of at-risk revenue recovered"
          tone="info"
          icon={TrendingUp}
          bare
        />
        <KpiCardStatic
          label="Active cases"
          displayValue={formatCount(data.hero.activeCases)}
          sub={`${formatCount(data.hero.awaitingApprovalCases)} awaiting approval`}
          tone="warning"
          icon={Activity}
          bare
        />
      </section>

      {/* Secondary rail — single strip with separators */}
      <section aria-label="Secondary metrics" className="grid grid-cols-2 gap-px border border-[#1A1A1A] bg-[#1A1A1A] lg:grid-cols-4">
        {[
          {
            icon: ShieldAlert,
            label: "Approval required",
            value: `${formatCount(data.hero.awaitingApprovalCases)} · ${formatLakhINR(data.hero.awaitingApprovalPaise)}`,
          },
          {
            icon: BadgeCheck,
            label: "Recovered cases",
            value: formatCount(data.hero.recoveredCases),
          },
          {
            icon: AlertTriangle,
            label: "Failed / stopped / rejected",
            value: formatCount(closedCount),
          },
          {
            icon: Activity,
            label: "AI decisions",
            value: `${formatCount(data.aiPerformance.analysesPerformed)} · ${data.aiPerformance.avgConfidencePct}% avg confidence`,
          },
        ].map((m) => (
          <div
            key={m.label}
            className="flex items-center gap-3 bg-black px-4 py-3"
          >
            <m.icon className="h-4 w-4 shrink-0 text-[#6F7A89]" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[#F7F9FC] tabular-nums">
                {m.value}
              </p>
              <p className="text-[11.5px] text-[#6F7A89]">{m.label}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Charts row 1 */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Recovery performance"
            subtitle="Where revenue is being lost, and how much is being recovered — revenue in INR."
          />
          <CardBody>
            <ScenarioPerformance rows={data.scenarioAnalytics} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title="Case portfolio"
            subtitle="Live distribution of all cases."
          />
          <CardBody>
            <StatusBar segments={data.statusBreakdown} />
          </CardBody>
        </Card>
      </section>

      {/* Charts row 2 */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Recovery pipeline"
            subtitle="Unique cases at each stage — where are recoveries dropping out?"
          />
          <CardBody>
            <Pipeline counts={data.pipelineCounts} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title="AI / policy outcomes"
            subtitle="What the AI decided, and what policy allowed."
          />
          <CardBody>
            <AiOutcomes data={aiOutcomeData} />
          </CardBody>
        </Card>
      </section>

      {/* Attention */}
      <Card>
        <CardHeader
          title="Cases needing attention"
          subtitle={
            data.hero.awaitingApprovalCases > 0
              ? `${formatCount(data.hero.awaitingApprovalCases)} high-value recoveries waiting for approval · ${formatINR(data.hero.awaitingApprovalPaise)}`
              : "High-value recoveries waiting for merchant approval."
          }
          action={
            <Link
              href="/cases?filter=approval"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#9DB1FF] hover:text-white"
            >
              View all cases <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <CardBody>
          {attentionCases.length === 0 ? (
            <EmptyState
              icon={BadgeCheck}
              title="No cases need attention"
              body="All active cases are currently within recovery policy limits."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13.5px]">
                <thead>
                  <tr className="text-[11px] font-medium tracking-[0.06em] text-[#6F7A89] uppercase">
                    <th className="py-2 pr-4 font-medium">Customer</th>
                    <th className="py-2 pr-4 font-medium">Scenario</th>
                    <th className="py-2 pr-4 text-right font-medium">Amount</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 font-medium"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {attentionCases.map((c) => (
                    <tr key={c.id} className="border-t border-[#171717] transition-colors hover:bg-[#080808]">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-[#F7F9FC]">{c.customer.name}</p>
                        <p className="font-mono text-[11px] text-[#6F7A89]">{shortId(c.id)}</p>
                      </td>
                      <td className="py-3 pr-4 text-[#A3ADBD]">{scenarioLabel(c.scenario)}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-[#F7F9FC] tabular-nums">
                        {formatINR(c.amountAtRisk)}
                      </td>
                      <td className="py-3 pr-4"><StatusBadge value={c.status} dot /></td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/cases/${c.id}`}
                          className="inline-flex items-center gap-1 border border-white/10 bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-[#F7F9FC] transition-colors hover:border-[#5B7CFF]/50 hover:bg-[#5B7CFF]/10"
                        >
                          Review <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader
          title="Recent recovery activity"
          subtitle="Latest audited events across all cases."
          action={
            <Link
              href="/audit"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#9DB1FF] hover:text-white"
            >
              Full audit trail <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <CardBody>
          {data.activity.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No audit activity"
              body="Recovery actions will appear here as they occur."
            />
          ) : (
            <ol className="divide-y divide-[#171717]">
              {data.activity.slice(0, 8).map((log) => (
                <li key={log.id} className="flex items-center gap-3 py-2.5">
                  <span aria-hidden className="circle h-1.5 w-1.5 shrink-0 bg-[#5B7CFF]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[#F7F9FC]">
                      {eventLabel(log.event)}
                    </p>
                    <p className="truncate text-[12px] text-[#6F7A89]">
                      {log.customerName} · {shortId(log.caseId)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] text-[#6F7A89]">
                    {timeAgo(log.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <BatchRunner />

      {/* Recent recoveries */}
      <Card>
        <CardHeader
          title="Recent recoveries"
          subtitle="Successfully recovered revenue with the action that recovered it."
        />
        <CardBody>
          {data.recentRecoveries.length === 0 ? (
            <EmptyState
              icon={CircleDollarSign}
              title="No recovered cases yet"
              body="Recovered revenue will appear here after successful interventions."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13.5px]">
                <thead>
                  <tr className="text-[11px] font-medium tracking-[0.06em] text-[#6F7A89] uppercase">
                    <th className="py-2 pr-4 font-medium">Customer</th>
                    <th className="py-2 pr-4 font-medium">Scenario</th>
                    <th className="py-2 pr-4 text-right font-medium">Recovered</th>
                    <th className="py-2 pr-4 font-medium">Action</th>
                    <th className="py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRecoveries.map((r) => (
                    <tr key={r.id} className="border-t border-[#171717] transition-colors hover:bg-[#080808]">
                      <td className="py-3 pr-4">
                        <Link href={`/cases/${r.caseId}`} className="font-medium text-[#F7F9FC] hover:text-[#9DB1FF]">
                          {r.customerName}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-[#A3ADBD]">{scenarioLabel(r.scenario)}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-emerald-300 tabular-nums">
                        {formatINR(r.recoveredPaise)}
                      </td>
                      <td className="py-3 pr-4 text-[#A3ADBD]">{actionLabel(r.action)}</td>
                      <td className="py-3 text-[12px] text-[#6F7A89]">{timeAgo(r.executedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <DemoControls devMode={process.env.NODE_ENV !== "production"} />
    </div>
  );
}
