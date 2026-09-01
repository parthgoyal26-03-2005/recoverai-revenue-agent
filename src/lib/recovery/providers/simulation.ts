import { simulateOutcome } from "@/lib/simulation/outcomes";
import type {
  ExecutionContext,
  ProviderName,
  RecoveryExecutionResult,
  RecoveryProvider,
} from "./types";

export class SimulationProvider implements RecoveryProvider {
  readonly name: ProviderName = "simulation";

  async executeAction(
    context: ExecutionContext
  ): Promise<RecoveryExecutionResult> {
    const outcome = simulateOutcome({
      caseId: context.recoveryCase.id,
      scenario: context.recoveryCase.scenario,
      action: context.action,
      attemptNumber: context.attemptNumber,
      amountAtRiskPaise: context.recoveryCase.amountAtRisk,
      now: context.now,
      rng: context.rng,
    });

    return {
      status: outcome.status,
      result: outcome.result,
      recoveredAmountPaise: outcome.recoveredAmountPaise,
      notes: outcome.notes,
      scheduledAt: outcome.scheduledAt ?? null,
      paymentLink: null,
      executedBy: this.name,
    };
  }
}
