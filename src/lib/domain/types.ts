export const RECOVERY_ACTIONS = [
  "RETRY_PAYMENT",
  "SCHEDULE_RETRY",
  "SEND_REMINDER",
  "OFFER_ASSISTANCE",
  "ESCALATE_TO_MERCHANT",
  "STOP_RECOVERY",
] as const;

export type ActionType = (typeof RECOVERY_ACTIONS)[number];

export type ScenarioType =
  | "FAILED_PAYMENT"
  | "CHECKOUT_ABANDONMENT"
  | "SUBSCRIPTION_FAILURE";

export const PROGRESS_ACTIONS: ActionType[] = [
  "RETRY_PAYMENT",
  "SCHEDULE_RETRY",
  "SEND_REMINDER",
  "OFFER_ASSISTANCE",
];

export type PolicyConfig = {
  maxRetries: number;
  maxContactAttempts: number;
  recoveryWindowHours: number;
  approvalThresholdPaise: number;
};

export const DEFAULT_POLICY: PolicyConfig = {
  maxRetries: 3,
  maxContactAttempts: 2,
  recoveryWindowHours: 72,
  approvalThresholdPaise: 500_000,
};

export type PolicyContext = {
  scenario: ScenarioType;
  amountAtRiskPaise: number;
  retryCount: number;
  contactCount: number;
  windowExpiresAt: Date;
  merchantApproved: boolean;
  now?: Date;
};

export type ActionPermission = {
  action: ActionType;
  allowed: boolean;
  reason: string;
};

export type PolicyEvaluation = {
  eligible: boolean;
  stopRequired: boolean;
  escalateRequired: boolean;
  windowExpired: boolean;
  retriesRemaining: number;
  contactsRemaining: number;
  requiresApproval: boolean;
  permissions: ActionPermission[];
  allowedActions: ActionType[];
  summaryReason: string;
};

export type SimulatedOutcome = {
  status: "COMPLETED" | "SCHEDULED" | "SKIPPED" | "AWAITING_APPROVAL";
  result:
    | "SUCCESS"
    | "FAILURE"
    | "NO_RESPONSE"
    | "APPROVAL_PENDING"
    | "BLOCKED_BY_POLICY";
  recoveredAmountPaise: number;
  notes: string;
  scheduledAt?: Date;
};

export function buildPolicyContext(
  input: Pick<
    PolicyContext,
    | "scenario"
    | "amountAtRiskPaise"
    | "retryCount"
    | "contactCount"
    | "windowExpiresAt"
    | "merchantApproved"
  >,
  now?: Date
): PolicyContext {
  return { ...input, now };
}
