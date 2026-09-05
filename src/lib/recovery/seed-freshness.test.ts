import { describe, expect, it } from "vitest";
import {
  FRESH_CASE_SPECS,
  SEED_WINDOW_HOURS,
  resolveSeedCreatedAt,
  resolveSeedWindowExpiresAt,
} from "../../../prisma/seed-fresh-cases";
import { DEFAULT_POLICY } from "@/lib/domain/types";

describe("seed freshness (demo-ready timestamps)", () => {
  it("7. fresh seeded approval case is minutes old, near seedNow", () => {
    const seedNow = new Date("2026-09-05T12:00:00.000Z");
    const approvalSpec = FRESH_CASE_SPECS.find(
      (s) => s.outcome === "ESCALATED_APPROVAL" && s.scenario === "FAILED_PAYMENT"
    )!;
    expect(approvalSpec).toBeTruthy();
    // Above the Rs 5,000 approval threshold.
    expect(approvalSpec.amountPaise).toBeGreaterThanOrEqual(
      DEFAULT_POLICY.approvalThresholdPaise
    );

    const createdAt = resolveSeedCreatedAt(seedNow, {
      ageHours: 0,
      ageMinutes: approvalSpec.ageMinutes,
    });
    const ageMs = seedNow.getTime() - createdAt.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(0);
    expect(ageMs).toBeLessThanOrEqual(20 * 60_000);

    const windowExpiresAt = resolveSeedWindowExpiresAt(createdAt, SEED_WINDOW_HOURS);
    expect(windowExpiresAt.getTime()).toBe(
      createdAt.getTime() + SEED_WINDOW_HOURS * 3_600_000
    );
    // Fresh window is still open at seed time.
    expect(windowExpiresAt.getTime()).toBeGreaterThan(seedNow.getTime());
  });

  it("covers all four required fresh demo shapes", () => {
    const shapes = FRESH_CASE_SPECS.map((s) => `${s.scenario}:${s.outcome}`).sort();
    expect(shapes).toEqual(
      [
        "CHECKOUT_ABANDONMENT:ACTIVE_REMINDER_SENT",
        "FAILED_PAYMENT:ACTIVE_RETRY_SCHEDULED",
        "FAILED_PAYMENT:ESCALATED_APPROVAL",
        "SUBSCRIPTION_FAILURE:ACTIVE_RETRY_SCHEDULED",
      ].sort()
    );
    for (const spec of FRESH_CASE_SPECS) {
      expect(spec.ageMinutes).toBeGreaterThanOrEqual(1);
      expect(spec.ageMinutes).toBeLessThanOrEqual(20);
    }
  });

  it("8. historical terminal cases remain backdated (hours, not minutes)", () => {
    const seedNow = new Date("2026-09-05T12:00:00.000Z");
    // Representative historical ages used by seed.ts for terminal outcomes.
    for (const ageHours of [100, 80, 24]) {
      const createdAt = resolveSeedCreatedAt(seedNow, { ageHours });
      const ageMs = seedNow.getTime() - createdAt.getTime();
      expect(ageMs).toBe(ageHours * 3_600_000);
      expect(ageMs).toBeGreaterThan(20 * 60_000);
    }
  });
});
