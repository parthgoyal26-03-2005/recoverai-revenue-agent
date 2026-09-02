import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Prisma } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260824);
const randInt = (min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const rupees = (r: number) => r * 100;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

const FIRST_NAMES = [
  "Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Karthik", "Meera",
  "Arjun", "Divya", "Sanjay", "Pooja", "Rahul", "Ishita", "Aditya", "Nisha",
  "Varun", "Kavya", "Nikhil", "Riya", "Siddharth", "Tanvi", "Manish", "Shreya",
  "Harsh", "Anjali", "Gaurav", "Swati", "Rajat", "Neha",
];
const LAST_NAMES = [
  "Sharma", "Patel", "Reddy", "Iyer", "Gupta", "Nair", "Desai", "Kulkarni",
  "Mehta", "Joshi", "Verma", "Rao", "Malhotra", "Chatterjee", "Bhat",
];
const CART_ITEMS = [
  "Annual Pro Subscription", "Premium Plan (Yearly)", "Starter Pack x2",
  "Business Suite License", "Team Plan (5 seats)", "Add-on Bundle",
];

type CaseSpec = {
  customerId: string;
  scenario: "FAILED_PAYMENT" | "CHECKOUT_ABANDONMENT" | "SUBSCRIPTION_FAILURE";
  amount: number;
  outcome:
    | "RECOVERED_RETRY"
    | "RECOVERED_REMINDER"
    | "FAILED_RETRIES"
    | "STOPPED_MAX_RETRIES"
    | "WINDOW_EXPIRED"
    | "ESCALATED_APPROVAL"
    | "ACTIVE_RETRY_SCHEDULED"
    | "ACTIVE_REMINDER_SENT";
  retriesUsed?: number;
  ageHours: number;
};

async function main() {
  console.log("Seeding RecoverAI data...");

  await prisma.$executeRaw`UPDATE "RecoveryCase" SET "transactionId" = NULL WHERE "transactionId" IS NOT NULL`;
  await prisma.$executeRaw`UPDATE "Transaction" SET "recoveryCaseId" = NULL WHERE "recoveryCaseId" IS NOT NULL`;
  await prisma.$executeRaw`UPDATE "RecoveryCase" SET "checkoutSessionId" = NULL WHERE "checkoutSessionId" IS NOT NULL`;
  await prisma.$executeRaw`UPDATE "RecoveryCase" SET "subscriptionId" = NULL WHERE "subscriptionId" IS NOT NULL`;

  await prisma.razorpayWebhookEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.aIDecision.deleteMany();
  await prisma.recoveryIntervention.deleteMany();
  await prisma.recoveryCase.deleteMany();
  await prisma.recoveryPolicy.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.checkoutSession.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.merchant.deleteMany();

  const merchant = await prisma.merchant.create({
    data: {
      id: process.env.RAZORPAY_MERCHANT_ID || undefined,
      name: "Acme Retail Pvt Ltd",
      email: "ops@acmeretail.example.com",
    },
  });

  await prisma.recoveryPolicy.create({
    data: {
      merchantId: merchant.id,
      maxRetries: 3,
      maxContactAttempts: 2,
      recoveryWindowHours: 72,
      approvalThreshold: rupees(5000),
    },
  });

  const customers = [];
  for (let i = 0; i < 50; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
    customers.push(
      await prisma.customer.create({
        data: {
          merchantId: merchant.id,
          name: `${first} ${last}`,
          email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
          phone: `+9198${String(10000000 + i * 137).slice(0, 8)}`,
          createdAt: hoursAgo(randInt(24, 2160)),
        },
      })
    );
  }

  const capturedTxns = [];
  let txnSeq = 1000;
  for (let i = 0; i < 100; i++) {
    const customer = customers[randInt(0, customers.length - 1)];
    const isFailed = i < 45;
    const amount =
      rng() < 0.08 ? rupees(randInt(25000, 50000)) : rupees(randInt(199, 9999));
    capturedTxns.push(
      await prisma.transaction.create({
        data: {
          merchantId: merchant.id,
          customerId: customer.id,
          amount,
          currency: "INR",
          status: isFailed ? "FAILED" : "CAPTURED",
          failureReason: isFailed
            ? pick([
                "insufficient_funds",
                "card_declined",
                "authentication_failed",
                "network_timeout",
                "bank_error",
              ])
            : null,
          razorpayPaymentId: `pay_SIM${txnSeq++}`,
          createdAt: hoursAgo(randInt(1, 720)),
        },
      })
    );
  }

  const abandonedSessions = [];
  for (let i = 0; i < 30; i++) {
    const customer = customers[randInt(0, customers.length - 1)];
    const isAbandoned = i < 20;
    abandonedSessions.push(
      await prisma.checkoutSession.create({
        data: {
          merchantId: merchant.id,
          customerId: customer.id,
          cartSummary: pick(CART_ITEMS),
          amount: rupees(randInt(499, 14999)),
          status: isAbandoned ? "ABANDONED" : "CONVERTED",
          abandonedAt: isAbandoned ? hoursAgo(randInt(2, 96)) : null,
          createdAt: hoursAgo(randInt(2, 120)),
        },
      })
    );
  }

  const subscriptions = [];
  for (let i = 0; i < 20; i++) {
    const customer = customers[randInt(0, customers.length - 1)];
    const failed = i < 12;
    subscriptions.push(
      await prisma.subscription.create({
        data: {
          merchantId: merchant.id,
          customerId: customer.id,
          planName: pick(["Pro Monthly", "Business Annual", "Starter Monthly"]),
          amount: rupees(randInt(299, 19999)),
          status: failed ? "PAST_DUE" : "ACTIVE",
          failureReason: failed
            ? pick(["mandate_expired", "insufficient_funds", "card_expired"])
            : null,
          retryCount: failed ? randInt(1, 2) : 0,
          nextRetryAt: failed ? hoursFromNow(randInt(1, 48)) : null,
          createdAt: hoursAgo(randInt(72, 2880)),
        },
      })
    );
  }

  const failedTxns = capturedTxns.filter((t) => t.status === "FAILED");
  const specs: CaseSpec[] = [];

  for (let i = 0; i < 8; i++) {
    const t = failedTxns[i];
    specs.push({
      customerId: t.customerId,
      scenario: "FAILED_PAYMENT",
      amount: t.amount,
      outcome: i % 2 === 0 ? "RECOVERED_RETRY" : "ACTIVE_RETRY_SCHEDULED",
      ageHours: randInt(4, 48),
    });
  }

  for (let i = 0; i < 8; i++) {
    const t = failedTxns[8 + i];
    const bucket = i % 4;
    specs.push({
      customerId: t.customerId,
      scenario: "FAILED_PAYMENT",
      amount: t.amount,
      outcome:
        bucket === 0
          ? "RECOVERED_RETRY"
          : bucket === 1
            ? "STOPPED_MAX_RETRIES"
            : bucket === 2
              ? "WINDOW_EXPIRED"
              : "FAILED_RETRIES",
      retriesUsed: bucket === 0 ? randInt(2, 3) : 3,
      ageHours: bucket === 2 ? randInt(80, 140) : randInt(24, 72),
    });
  }

  for (let i = 0; i < 6; i++) {
    const t = failedTxns[16 + i];
    specs.push({
      customerId: t.customerId,
      scenario: "FAILED_PAYMENT",
      amount: rupees(randInt(25000, 50000)),
      outcome: i % 3 === 2 ? "ESCALATED_APPROVAL" : "ESCALATED_APPROVAL",
      ageHours: randInt(2, 40),
    });
  }

  for (let i = 0; i < 14; i++) {
    const s = abandonedSessions[i];
    specs.push({
      customerId: s.customerId,
      scenario: "CHECKOUT_ABANDONMENT",
      amount: s.amount,
      outcome: i % 3 === 0 ? "RECOVERED_REMINDER" : i % 3 === 1 ? "ACTIVE_REMINDER_SENT" : "FAILED_RETRIES",
      ageHours: randInt(3, 70),
    });
  }

  for (let i = 0; i < 12; i++) {
    const s = subscriptions[i];
    specs.push({
      customerId: s.customerId,
      scenario: "SUBSCRIPTION_FAILURE",
      amount: s.amount,
      outcome: i % 3 === 0 ? "RECOVERED_RETRY" : i % 3 === 1 ? "ACTIVE_RETRY_SCHEDULED" : "WINDOW_EXPIRED",
      ageHours: i % 3 === 2 ? randInt(76, 130) : randInt(6, 60),
    });
  }

  for (let i = 0; i < 6; i++) {
    const t = failedTxns[22 + i];
    specs.push({
      customerId: t.customerId,
      scenario: "FAILED_PAYMENT",
      amount: t.amount,
      outcome: pick([
        "RECOVERED_RETRY",
        "FAILED_RETRIES",
        "ACTIVE_RETRY_SCHEDULED",
        "ESCALATED_APPROVAL",
      ]),
      ageHours: randInt(2, 60),
    });
  }

    const usedTxnIds = new Set<string>();
    const usedCheckoutIds = new Set<string>();
    const usedSubIds = new Set<string>();

  for (const spec of specs) {
    const createdAt = hoursAgo(spec.ageHours);
    const priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" =
      spec.amount >= rupees(25000)
        ? "CRITICAL"
        : spec.amount >= rupees(5000)
          ? "HIGH"
          : spec.amount >= rupees(1000)
            ? "MEDIUM"
            : "LOW";

    const caseData: Parameters<typeof prisma.recoveryCase.create>[0]["data"] = {
      merchantId: merchant.id,
      customerId: spec.customerId,
      scenario: spec.scenario,
      amountAtRisk: spec.amount,
      priority,
      retryCount: 0,
      contactCount: 0,
      windowExpiresAt: new Date(createdAt.getTime() + 72 * 3_600_000),
      createdAt,
    };
    const linkedTxn =
      spec.scenario === "FAILED_PAYMENT"
        ? failedTxns.find(
            (t) =>
              !usedTxnIds.has(t.id) &&
              t.customerId === spec.customerId &&
              t.amount === spec.amount
          )
        : undefined;
    if (linkedTxn) {
      usedTxnIds.add(linkedTxn.id);
      caseData.transactionId = linkedTxn.id;
    }

    const linkedCheckout =
      spec.scenario === "CHECKOUT_ABANDONMENT"
        ? abandonedSessions.find(
            (s) => !usedCheckoutIds.has(s.id) && s.customerId === spec.customerId
          )
        : undefined;
    if (linkedCheckout) {
      usedCheckoutIds.add(linkedCheckout.id);
      caseData.checkoutSessionId = linkedCheckout.id;
    }

    const linkedSub =
      spec.scenario === "SUBSCRIPTION_FAILURE"
        ? subscriptions.find(
            (s) =>
              !usedSubIds.has(s.id) &&
              s.customerId === spec.customerId &&
              s.amount === spec.amount
          )
        : undefined;
    if (linkedSub) {
      usedSubIds.add(linkedSub.id);
      caseData.subscriptionId = linkedSub.id;
    }

    const terminal =
      spec.outcome === "RECOVERED_RETRY" ||
      spec.outcome === "RECOVERED_REMINDER"
        ? { status: "RECOVERED" as const, resolvedAt: new Date(createdAt.getTime() + randInt(1, 40) * 3_600_000) }
        : spec.outcome === "FAILED_RETRIES"
          ? { status: "FAILED" as const, resolvedAt: new Date(createdAt.getTime() + randInt(20, 70) * 3_600_000) }
          : spec.outcome === "STOPPED_MAX_RETRIES" || spec.outcome === "WINDOW_EXPIRED"
            ? { status: "STOPPED" as const, resolvedAt: new Date(createdAt.getTime() + randInt(30, 71) * 3_600_000) }
            : spec.outcome === "ESCALATED_APPROVAL"
              ? { status: "ESCALATED" as const, resolvedAt: null }
              : { status: "IN_PROGRESS" as const, resolvedAt: null };

    const rec = await prisma.recoveryCase.create({
      data: caseData,
    });

    const riskLevel: "LOW" | "MEDIUM" | "HIGH" =
      priority === "CRITICAL" || priority === "HIGH" ? "HIGH" : priority === "MEDIUM" ? "MEDIUM" : "LOW";

    const diagnoses: Record<CaseSpec["scenario"], string> = {
      FAILED_PAYMENT:
        spec.amount >= rupees(25000)
          ? "High-value transaction declined due to issuer-side authentication failure. Customer has prior successful payments, indicating genuine intent."
          : pick([
              "Soft decline likely caused by insufficient funds; customer has successful payment history.",
              "Card declined by issuer. Previous attempts succeeded, suggesting a temporary bank-side issue.",
              "Network timeout during authorization; not a permanent decline.",
            ]),
      CHECKOUT_ABANDONMENT:
        "Customer reached the payment step but left without completing purchase. Cart value suggests considered intent rather than browsing.",
      SUBSCRIPTION_FAILURE:
        "Recurring mandate charge failed. Likely expired card or insufficient balance at billing time.",
    };

    const recommendedByOutcome: Record<CaseSpec["outcome"], "RETRY_PAYMENT" | "SEND_REMINDER" | "SCHEDULE_RETRY" | "ESCALATE_TO_MERCHANT"> = {
      RECOVERED_RETRY: "RETRY_PAYMENT",
      RECOVERED_REMINDER: "SEND_REMINDER",
      FAILED_RETRIES: "RETRY_PAYMENT",
      STOPPED_MAX_RETRIES: "RETRY_PAYMENT",
      WINDOW_EXPIRED: "RETRY_PAYMENT",
      ESCALATED_APPROVAL: "ESCALATE_TO_MERCHANT",
      ACTIVE_RETRY_SCHEDULED: "SCHEDULE_RETRY",
      ACTIVE_REMINDER_SENT: "SEND_REMINDER",
    };

    await prisma.aIDecision.create({
      data: {
        recoveryCaseId: rec.id,
        diagnosis: diagnoses[spec.scenario],
        riskLevel,
        recommendedAction: recommendedByOutcome[spec.outcome],
        confidence: Number((0.68 + rng() * 0.3).toFixed(2)),
        reasoning:
          "Based on transaction history, failure reason classification, and customer engagement signals.",
        model: "recoverai-diagnoser-v0-simulated",
        latencyMs: randInt(300, 1800),
        createdAt,
      },
    });

    const audits: {
      event: string;
      actor: "SYSTEM" | "AI" | "POLICY_ENGINE" | "MERCHANT";
      metadata: Prisma.InputJsonObject;
      offsetH: number;
    }[] = [
      { event: "CASE_CREATED", actor: "SYSTEM", metadata: { scenario: spec.scenario, amountAtRisk: spec.amount }, offsetH: 0 },
      { event: "AI_DIAGNOSIS_COMPLETED", actor: "AI", metadata: { recommendedAction: recommendedByOutcome[spec.outcome] }, offsetH: 0.05 },
      { event: "POLICY_EVALUATION_ALLOWED", actor: "POLICY_ENGINE", metadata: { rulesEvaluated: ["max_retries", "max_contact_attempts", "recovery_window"] }, offsetH: 0.1 },
    ];

    const interventions: {
      action: "RETRY_PAYMENT" | "SCHEDULE_RETRY" | "SEND_REMINDER" | "OFFER_ASSISTANCE" | "ESCALATE_TO_MERCHANT" | "STOP_RECOVERY";
      status: "PENDING" | "SCHEDULED" | "COMPLETED" | "SKIPPED" | "AWAITING_APPROVAL";
      result: "SUCCESS" | "FAILURE" | "NO_RESPONSE" | "APPROVAL_PENDING" | "BLOCKED_BY_POLICY" | null;
      scheduledAt: Date | null;
      executedAt: Date | null;
      recoveredAmount: number;
      notes: string | null;
    }[] = [];
    let retries = spec.retriesUsed ?? 0;
    let contacts = 0;
    let recovered = 0;

    switch (spec.outcome) {
      case "RECOVERED_RETRY":
        for (let r = 0; r < retries - 1; r++) {
          interventions.push({ action: "RETRY_PAYMENT", status: "COMPLETED", result: "FAILURE", scheduledAt: null, executedAt: new Date(createdAt.getTime() + (r + 1) * 6 * 3_600_000), recoveredAmount: 0, notes: "Payment still declined" });
        }
        interventions.push({ action: "RETRY_PAYMENT", status: "COMPLETED", result: "SUCCESS", scheduledAt: null, executedAt: terminal.resolvedAt!, recoveredAmount: spec.amount, notes: "Retry succeeded" });
        break;
      case "RECOVERED_REMINDER":
        contacts = 1;
        interventions.push({ action: "SEND_REMINDER", status: "COMPLETED", result: "SUCCESS", scheduledAt: null, executedAt: new Date(createdAt.getTime() + 4 * 3_600_000), recoveredAmount: spec.amount, notes: "Customer completed payment after reminder" });
        break;
      case "FAILED_RETRIES":
        for (let r = 0; r < Math.min(retries || 2, 3); r++) {
          interventions.push({ action: "RETRY_PAYMENT", status: "COMPLETED", result: "FAILURE", scheduledAt: null, executedAt: new Date(createdAt.getTime() + (r + 1) * 8 * 3_600_000), recoveredAmount: 0, notes: "Payment declined" });
        }
        break;
      case "STOPPED_MAX_RETRIES":
        for (let r = 0; r < 3; r++) {
          interventions.push({ action: "RETRY_PAYMENT", status: "COMPLETED", result: "FAILURE", scheduledAt: null, executedAt: new Date(createdAt.getTime() + (r + 1) * 6 * 3_600_000), recoveredAmount: 0, notes: `Attempt ${r + 1} declined` });
        }
        interventions.push({ action: "STOP_RECOVERY", status: "SKIPPED", result: "BLOCKED_BY_POLICY", scheduledAt: null, executedAt: terminal.resolvedAt!, recoveredAmount: 0, notes: "Max retries (3) reached; recovery stopped" });
        audits.push({ event: "POLICY_LIMIT_STOP", actor: "POLICY_ENGINE", metadata: { limit: "maxRetries", value: 3 }, offsetH: 20 });
        retries = 3;
        break;
      case "WINDOW_EXPIRED":
        interventions.push({ action: "RETRY_PAYMENT", status: "COMPLETED", result: "FAILURE", scheduledAt: null, executedAt: new Date(createdAt.getTime() + 6 * 3_600_000), recoveredAmount: 0, notes: "Payment declined" });
        interventions.push({ action: "STOP_RECOVERY", status: "SKIPPED", result: "BLOCKED_BY_POLICY", scheduledAt: null, executedAt: terminal.resolvedAt!, recoveredAmount: 0, notes: "Recovery window (72h) expired" });
        audits.push({ event: "POLICY_WINDOW_EXPIRED", actor: "POLICY_ENGINE", metadata: { windowHours: 72 }, offsetH: 73 });
        retries = 1;
        break;
      case "ESCALATED_APPROVAL":
        contacts = 1;
        audits.push({ event: "APPROVAL_REQUIRED", actor: "POLICY_ENGINE", metadata: { reason: "amount_above_threshold", threshold: rupees(25000) }, offsetH: 0.15 });
        interventions.push({ action: "ESCALATE_TO_MERCHANT", status: "AWAITING_APPROVAL", result: "APPROVAL_PENDING", scheduledAt: null, executedAt: null, recoveredAmount: 0, notes: "High-value case requires merchant approval before retry" });
        break;
      case "ACTIVE_RETRY_SCHEDULED":
        retries = 1;
        interventions.push({ action: "RETRY_PAYMENT", status: "COMPLETED", result: "FAILURE", scheduledAt: null, executedAt: new Date(createdAt.getTime() + 2 * 3_600_000), recoveredAmount: 0, notes: "First retry declined" });
        interventions.push({ action: "SCHEDULE_RETRY", status: "SCHEDULED", result: null, scheduledAt: hoursFromNow(randInt(1, 24)), executedAt: null, recoveredAmount: 0, notes: "Scheduled within recovery window" });
        audits.push({ event: "INTERVENTION_SCHEDULED", actor: "SYSTEM", metadata: { action: "RETRY_PAYMENT" }, offsetH: 3 });
        break;
      case "ACTIVE_REMINDER_SENT":
        contacts = 1;
        interventions.push({ action: "SEND_REMINDER", status: "COMPLETED", result: "NO_RESPONSE", scheduledAt: null, executedAt: new Date(createdAt.getTime() + 3 * 3_600_000), recoveredAmount: 0, notes: "Reminder delivered; no response yet" });
        break;
    }

    for (const iv of interventions) {
      await prisma.recoveryIntervention.create({
        data: {
          recoveryCaseId: rec.id,
          action: iv.action,
          status: iv.status,
          result: iv.result,
          scheduledAt: iv.scheduledAt,
          executedAt: iv.executedAt,
          recoveredAmount: iv.recoveredAmount,
          notes: iv.notes,
          createdAt: iv.executedAt ?? createdAt,
        },
      });
      if (iv.executedAt) {
        audits.push({
          event: `INTERVENTION_${iv.action}`,
          actor: "SYSTEM",
          metadata: { status: iv.status, result: iv.result },
          offsetH: Math.max(0, (iv.executedAt.getTime() - createdAt.getTime()) / 3_600_000),
        });
      }
    }

    await prisma.recoveryCase.update({
      where: { id: rec.id },
      data: {
        status: terminal.status,
        resolvedAt: terminal.resolvedAt,
        retryCount: retries,
        contactCount: contacts,
      },
    });

    for (const a of audits) {
      await prisma.auditLog.create({
        data: {
          recoveryCaseId: rec.id,
          event: a.event,
          actor: a.actor,
          metadata: a.metadata,
          createdAt: new Date(createdAt.getTime() + a.offsetH * 3_600_000),
        },
      });
    }
  }

  const counts = {
    merchants: await prisma.merchant.count(),
    customers: await prisma.customer.count(),
    transactions: await prisma.transaction.count(),
    checkoutSessions: await prisma.checkoutSession.count(),
    subscriptions: await prisma.subscription.count(),
    recoveryCases: await prisma.recoveryCase.count(),
    interventions: await prisma.recoveryIntervention.count(),
    aiDecisions: await prisma.aIDecision.count(),
    auditLogs: await prisma.auditLog.count(),
  };
  console.log("Seed complete:", JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
