/**
 * Fresh actionable demo cases for `prisma/seed.ts`.
 *
 * Historical terminal cases (RECOVERED / FAILED / STOPPED / WINDOW_EXPIRED)
 * stay backdated for analytics. The specs below are created minutes before
 * seed time so the dashboard "Needs Attention" list shows fresh timestamps
 * (e.g. "3m ago") right after reseeding.
 *
 * Pure data + date math only — no Prisma imports, no side effects — so this
 * module is unit-testable without a database.
 */

export const SEED_WINDOW_HOURS = 72;

export type FreshCaseSpec = {
  scenario: "FAILED_PAYMENT" | "CHECKOUT_ABANDONMENT" | "SUBSCRIPTION_FAILURE";
  /** Amount at risk in paise (integer, deterministic). */
  amountPaise: number;
  outcome:
    | "ESCALATED_APPROVAL"
    | "ACTIVE_RETRY_SCHEDULED"
    | "ACTIVE_REMINDER_SENT";
  /** Minutes before seed time the case was "created". */
  ageMinutes: number;
};

export const FRESH_CASE_SPECS: FreshCaseSpec[] = [
  {
    // High-value failed payment awaiting merchant approval.
    scenario: "FAILED_PAYMENT",
    amountPaise: 3_200_000, // Rs 32,000 — above the Rs 5,000 approval threshold.
    outcome: "ESCALATED_APPROVAL",
    ageMinutes: 3,
  },
  {
    // Low-value failed payment ready to execute (no approval needed).
    scenario: "FAILED_PAYMENT",
    amountPaise: 249_900, // Rs 2,499
    outcome: "ACTIVE_RETRY_SCHEDULED",
    ageMinutes: 7,
  },
  {
    // Active checkout abandonment awaiting a reminder outcome.
    scenario: "CHECKOUT_ABANDONMENT",
    amountPaise: 349_900, // Rs 3,499
    outcome: "ACTIVE_REMINDER_SENT",
    ageMinutes: 12,
  },
  {
    // Active subscription failure with a scheduled retry.
    scenario: "SUBSCRIPTION_FAILURE",
    amountPaise: 99_900, // Rs 999
    outcome: "ACTIVE_RETRY_SCHEDULED",
    ageMinutes: 17,
  },
];

export function resolveSeedCreatedAt(
  seedNow: Date,
  spec: { ageMinutes?: number; ageHours: number }
): Date {
  if (spec.ageMinutes != null) {
    return new Date(seedNow.getTime() - spec.ageMinutes * 60_000);
  }
  return new Date(seedNow.getTime() - spec.ageHours * 3_600_000);
}

export function resolveSeedWindowExpiresAt(
  createdAt: Date,
  recoveryWindowHours: number = SEED_WINDOW_HOURS
): Date {
  return new Date(createdAt.getTime() + recoveryWindowHours * 3_600_000);
}
