import { getRazorpayConfig } from "@/lib/razorpay/config";
import { createPaymentLink } from "@/lib/razorpay/client";
import { SimulationProvider } from "./simulation";
import type {
  ExecutionContext,
  ProviderName,
  RecoveryExecutionResult,
  RecoveryProvider,
} from "./types";

const simulationProvider = new SimulationProvider();

function buildReferenceId(caseId: string, interventionId?: string | null): string {
  const suffix = interventionId ?? caseId;
  const prefix = "RECOVERAI-";
  const max = 40;
  const available = max - prefix.length;
  return prefix + (suffix.length > available ? suffix.slice(0, available) : suffix);
}

function isRetryRetrieval(context: ExecutionContext): boolean {
  return (
    context.action === "RETRY_PAYMENT" &&
    context.recoveryCase.scenario === "FAILED_PAYMENT"
  );
}

export class RazorpayProvider implements RecoveryProvider {
  readonly name: ProviderName = "razorpay";

  async executeAction(
    context: ExecutionContext
  ): Promise<RecoveryExecutionResult> {
    if (!isRetryRetrieval(context)) {
      return simulationProvider.executeAction(context);
    }

    const config = getRazorpayConfig();
    if (!config) {
      return {
        status: "COMPLETED",
        result: "FAILURE",
        recoveredAmountPaise: 0,
        notes: "Razorpay is not configured; payment link could not be created.",
        paymentLink: null,
        executedBy: this.name,
      };
    }

    const referenceId = buildReferenceId(
      context.recoveryCase.id,
      context.interventionId
    );

    const created = await createPaymentLink(config, {
      amount: context.recoveryCase.amountAtRisk,
      currency: "INR",
      referenceId,
      expireBy: context.recoveryCase.windowExpiresAt,
      description: "RecoverAI - complete your pending payment",
      notes: {
        recoverai_case_id: context.recoveryCase.id,
        recoverai_intervention_id: context.interventionId ?? "",
        recoverai_scenario: context.recoveryCase.scenario,
      },
    });

    if (!created.ok || !created.id || !created.url) {
      return {
        status: "COMPLETED",
        result: "FAILURE",
        recoveredAmountPaise: 0,
        notes: created.error ?? "Payment link creation failed.",
        paymentLink: null,
        executedBy: this.name,
      };
    }

    return {
      status: "PENDING",
      result: "PENDING",
      recoveredAmountPaise: 0,
      notes:
        `Razorpay payment link created (${created.id}). ` +
        "Waiting for the customer to complete payment.",
      paymentLink: { id: created.id, url: created.url },
      executedBy: this.name,
    };
  }
}
