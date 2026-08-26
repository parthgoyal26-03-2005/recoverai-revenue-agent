import { describe, expect, it } from "vitest";
import { recoveryAnalysisSchema } from "@/lib/ai/types";
import { RECOVERY_ACTIONS } from "@/lib/domain/types";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import { makeContext } from "@/lib/ai/test-fixtures";

describe("AI response schema validation", () => {
  const valid = {
    diagnosis: "temporary_payment_failure",
    riskLevel: "LOW",
    recommendedAction: "SCHEDULE_RETRY",
    priority: "HIGH",
    confidence: 0.94,
    reasoning:
      "Customer has a strong successful payment history and this is the first failure.",
    requiresMerchantAttention: false,
  };

  it("accepts a fully valid AI response", () => {
    expect(recoveryAnalysisSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unsupported action invented by the LLM", () => {
    const result = recoveryAnalysisSchema.safeParse({
      ...valid,
      recommendedAction: "REFUND_THE_CUSTOMER",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown diagnoses", () => {
    const result = recoveryAnalysisSchema.safeParse({
      ...valid,
      diagnosis: "made_up_diagnosis",
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside 0..1 and short reasoning", () => {
    expect(
      recoveryAnalysisSchema.safeParse({ ...valid, confidence: 1.5 }).success
    ).toBe(false);
    expect(
      recoveryAnalysisSchema.safeParse({ ...valid, confidence: -0.1 }).success
    ).toBe(false);
    expect(
      recoveryAnalysisSchema.safeParse({ ...valid, reasoning: "" }).success
    ).toBe(false);
  });

  it("schema actions are exactly the engine-supported actions", () => {
    for (const action of RECOVERY_ACTIONS) {
      expect(
        recoveryAnalysisSchema.safeParse({ ...valid, recommendedAction: action })
          .success
      ).toBe(true);
    }
  });
});

describe("mock provider (demo mode)", () => {
  const provider = new MockAIProvider();

  it("is deterministic for identical context", async () => {
    const ctx = makeContext();
    const a = await provider.analyzeRecoveryCase(ctx);
    const b = await provider.analyzeRecoveryCase(ctx);
    expect(a).toEqual(b);
  });

  it("diagnoses healthy-history first failures as temporary with retry", async () => {
    const result = await provider.analyzeRecoveryCase(makeContext());
    expect(result.diagnosis).toBe("temporary_payment_failure");
    expect(result.riskLevel).toBe("LOW");
    expect(result.recommendedAction).toBe("RETRY_PAYMENT");
    expect(result.requiresMerchantAttention).toBe(false);
  });

  it("escalates high-value cases above the approval threshold", async () => {
    const result = await provider.analyzeRecoveryCase(
      makeContext({
        kase: { ...makeContext().kase, amountAtRiskRupees: 42000 },
      })
    );
    expect(result.diagnosis).toBe("high_value_payment_risk");
    expect(result.recommendedAction).toBe("ESCALATE_TO_MERCHANT");
    expect(result.requiresMerchantAttention).toBe(true);
  });

  it("stops recovery when the window has expired", async () => {
    const result = await provider.analyzeRecoveryCase(
      makeContext({
        kase: { ...makeContext().kase, hoursRemainingInWindow: -5 },
      })
    );
    expect(result.diagnosis).toBe("recovery_window_expired");
    expect(result.recommendedAction).toBe("STOP_RECOVERY");
  });
});
