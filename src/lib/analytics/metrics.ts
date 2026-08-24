import { prisma } from "@/lib/db/prisma";
import type { ScenarioType } from "@/generated/prisma/client";

export type DashboardMetrics = {
  totalAtRiskPaise: number;
  recoveredPaise: number;
  recoveryRatePct: number;
  totalCases: number;
  activeCases: number;
  recoveredCases: number;
  failedCases: number;
  stoppedCases: number;
  escalatedCases: number;
  byScenario: {
    scenario: ScenarioType;
    atRiskPaise: number;
    recoveredPaise: number;
    cases: number;
  }[];
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [caseAgg, statusCounts, scenarioGroups] = await Promise.all([
    prisma.recoveryCase.aggregate({
      _count: { _all: true },
      _sum: { amountAtRisk: true },
    }),
    prisma.recoveryCase.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.recoveryCase.groupBy({
      by: ["scenario"],
      _count: { _all: true },
      _sum: { amountAtRisk: true },
    }),
  ]);

  const countOf = (status: string) =>
    statusCounts.find((g) => g.status === status)?._count._all ?? 0;

  const activeCases =
    countOf("DETECTED") +
    countOf("DIAGNOSED") +
    countOf("IN_PROGRESS") +
    countOf("ESCALATED");

  const recoveredPaise = (
    await prisma.recoveryIntervention.aggregate({
      where: { result: "SUCCESS" },
      _sum: { recoveredAmount: true },
    })
  )._sum.recoveredAmount ?? 0;

  const byScenario = await Promise.all(
    scenarioGroups.map(async (g) => {
      const rec = await prisma.recoveryIntervention.aggregate({
        where: {
          result: "SUCCESS",
          recoveryCase: { scenario: g.scenario },
        },
        _sum: { recoveredAmount: true },
      });
      return {
        scenario: g.scenario,
        atRiskPaise: g._sum.amountAtRisk ?? 0,
        recoveredPaise: rec._sum.recoveredAmount ?? 0,
        cases: g._count._all,
      };
    })
  );

  const totalAtRiskPaise = caseAgg._sum.amountAtRisk ?? 0;
  const totalCases = caseAgg._count._all;

  return {
    totalAtRiskPaise,
    recoveredPaise,
    recoveryRatePct:
      totalAtRiskPaise > 0
        ? Number(((recoveredPaise / totalAtRiskPaise) * 100).toFixed(1))
        : 0,
    totalCases,
    activeCases,
    recoveredCases: countOf("RECOVERED"),
    failedCases: countOf("FAILED"),
    stoppedCases: countOf("STOPPED"),
    escalatedCases: countOf("ESCALATED"),
    byScenario,
  };
}

export async function getRecentCases(limit = 8) {
  return prisma.recoveryCase.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { customer: { select: { name: true, email: true } } },
  });
}

export async function getAllCases() {
  return prisma.recoveryCase.findMany({
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { name: true, email: true } } },
  });
}
