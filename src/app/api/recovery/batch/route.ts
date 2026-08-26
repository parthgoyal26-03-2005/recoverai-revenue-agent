import { prisma } from "@/lib/db/prisma";
import { createPrismaStore } from "@/lib/recovery/store";
import { runRecoveryBatch } from "@/lib/recovery/orchestrator";
import { summarizeBatchResults } from "@/lib/analytics/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const store = createPrismaStore(prisma);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        send({ type: "phase", phase: "preparing", message: "Preparing active cases…" });

        const summary = await runRecoveryBatch(store, {
          onProgress: (processed, total, last) => {
            send({
              type: "progress",
              processed,
              total,
              lastCase: {
                caseId: last.caseId,
                status: last.status,
                actionType: last.actionType,
                caseStatusAfter: last.caseStatusAfter,
              },
            });
          },
        });

        send({
          type: "phase",
          phase: "finalizing",
          message: "Finalizing metrics…",
          processed: summary.processedCases,
        });

        const totals = summarizeBatchResults(
          summary.results,
          summary.revenueAtRiskPaise
        );

        send({
          type: "complete",
          summary: {
            casesAnalyzed: totals.totalCases,
            actionsExecuted: totals.executed,
            scheduled: totals.scheduled,
            recovered: totals.recovered,
            failed: totals.failed,
            blocked: totals.blocked,
            approvalRequired: totals.approvalRequired,
            stopped: totals.stopped,
            escalated: totals.escalated,
            revenueAtRiskPaise: totals.revenueAtRiskPaise,
            revenueRecoveredPaise: totals.revenueRecoveredPaise,
            recoveryRatePct: totals.recoveryRatePct,
          },
        });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Batch run failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
