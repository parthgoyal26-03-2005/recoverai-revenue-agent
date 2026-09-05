import type { CaseWithRelations } from "@/lib/recovery/store";
import type { ActionType } from "@/lib/domain/types";

export type ProviderName = "simulation" | "razorpay";

export type PaymentLinkInfo = {
  id: string;
  url: string;
};

export type ExecutionContext = {
  recoveryCase: CaseWithRelations;
  action: ActionType;
  attemptNumber: number;
  now: Date;
  rng?: () => number;
  interventionId?: string | null;
};

export type RecoveryExecutionResult = {
  status:
    | "COMPLETED"
    | "SCHEDULED"
    | "SKIPPED"
    | "AWAITING_APPROVAL"
    | "PENDING";
  result:
    | "SUCCESS"
    | "FAILURE"
    | "NO_RESPONSE"
    | "APPROVAL_PENDING"
    | "BLOCKED_BY_POLICY"
    | "PENDING";
  recoveredAmountPaise: number;
  notes: string | null;
  scheduledAt?: Date | null;
  paymentLink?: PaymentLinkInfo | null;
  executedBy: ProviderName;
  /**
   * Machine-readable provider failure code (e.g.
   * "RAZORPAY_TEST_LINK_LIMIT_REACHED"). Absent when the provider call
   * succeeded or failed without a recognized typed cause.
   */
  errorCode?: string | null;
};

export interface RecoveryProvider {
  readonly name: ProviderName;
  executeAction(context: ExecutionContext): Promise<RecoveryExecutionResult>;
}
