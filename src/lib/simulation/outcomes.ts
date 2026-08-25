import type { ActionType, ScenarioType, SimulatedOutcome } from "@/lib/domain/types";

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicRng(caseId: string, salt: string): () => number {
  const seedFn = xmur3(`${caseId}:${salt}:recoverai-v1`);
  return mulberry32(seedFn());
}

const RETRY_SUCCESS_PROB = [0.55, 0.35, 0.2];
const REMINDER_SUCCESS_PROB = 0.3;
const ASSISTANCE_SUCCESS_PROB = 0.25;

const SCHEDULE_DELAY_MINUTES = [30, 120, 480];

export type SimulateParams = {
  caseId: string;
  scenario: ScenarioType;
  action: ActionType;
  attemptNumber: number;
  amountAtRiskPaise: number;
  now?: Date;
  rng?: () => number;
};

export function simulateOutcome(params: SimulateParams): SimulatedOutcome {
  const now = params.now ?? new Date();
  const roll =
    params.rng ??
    deterministicRng(
      params.caseId,
      `${params.action}:${params.attemptNumber}`
    );

  switch (params.action) {
    case "RETRY_PAYMENT": {
      const prob =
        RETRY_SUCCESS_PROB[
          Math.min(params.attemptNumber, RETRY_SUCCESS_PROB.length) - 1
        ] ?? RETRY_SUCCESS_PROB[RETRY_SUCCESS_PROB.length - 1];
      if (roll() < prob) {
        return {
          status: "COMPLETED",
          result: "SUCCESS",
          recoveredAmountPaise: params.amountAtRiskPaise,
          notes: `Simulated payment retry succeeded on attempt ${params.attemptNumber}.`,
        };
      }
      return {
        status: "COMPLETED",
        result: "FAILURE",
        recoveredAmountPaise: 0,
        notes: `Simulated payment retry failed on attempt ${params.attemptNumber} (issuer declined).`,
      };
    }

    case "SCHEDULE_RETRY": {
      const delay =
        SCHEDULE_DELAY_MINUTES[
          Math.min(params.attemptNumber, SCHEDULE_DELAY_MINUTES.length) - 1
        ] ?? SCHEDULE_DELAY_MINUTES[SCHEDULE_DELAY_MINUTES.length - 1];
      return {
        status: "SCHEDULED",
        result: "NO_RESPONSE",
        recoveredAmountPaise: 0,
        notes: `Retry ${params.attemptNumber} scheduled in ${delay} minutes.`,
        scheduledAt: new Date(now.getTime() + delay * 60_000),
      };
    }

    case "SEND_REMINDER": {
      if (roll() < REMINDER_SUCCESS_PROB) {
        return {
          status: "COMPLETED",
          result: "SUCCESS",
          recoveredAmountPaise: params.amountAtRiskPaise,
          notes: `Customer completed the purchase after reminder ${params.attemptNumber}.`,
        };
      }
      return {
        status: "COMPLETED",
        result: "NO_RESPONSE",
        recoveredAmountPaise: 0,
        notes: `Reminder ${params.attemptNumber} delivered; no response yet.`,
      };
    }

    case "OFFER_ASSISTANCE": {
      if (roll() < ASSISTANCE_SUCCESS_PROB) {
        return {
          status: "COMPLETED",
          result: "SUCCESS",
          recoveredAmountPaise: params.amountAtRiskPaise,
          notes: `Customer accepted assistance and completed the payment (contact ${params.attemptNumber}).`,
        };
      }
      return {
        status: "COMPLETED",
        result: "NO_RESPONSE",
        recoveredAmountPaise: 0,
        notes: `Assistance offer ${params.attemptNumber} delivered; no response yet.`,
      };
    }

    case "ESCALATE_TO_MERCHANT": {
      return {
        status: "AWAITING_APPROVAL",
        result: "APPROVAL_PENDING",
        recoveredAmountPaise: 0,
        notes: "Case escalated to merchant for review and approval.",
      };
    }

    case "STOP_RECOVERY": {
      return {
        status: "SKIPPED",
        result: "BLOCKED_BY_POLICY",
        recoveredAmountPaise: 0,
        notes: "Recovery stopped.",
      };
    }
  }
}
