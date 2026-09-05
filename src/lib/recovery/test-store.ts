import type {
  AuditLogData,
  CaseUpdateData,
  CaseWithRelations,
  DueIntervention,
  NewInterventionData,
  RecoveryStore,
} from "@/lib/recovery/store";
import type {
  AIAuditLogData,
  AIAnalysisStore,
  NewAIDecisionData,
} from "@/lib/ai/agent";

export class RecoveryTestStore implements RecoveryStore, AIAnalysisStore {
  cases = new Map<string, CaseWithRelations>();
  interventions: (NewInterventionData & { id: string })[] = [];
  decisions: (NewAIDecisionData & { id: string })[] = [];
  audits: AuditLogData[] = [];
  private seq = 0;

  constructor(...recoveryCases: CaseWithRelations[]) {
    for (const c of recoveryCases) this.cases.set(c.id, c);
  }

  async getCase(id: string) {
    return this.cases.get(id) ?? null;
  }

  async findActiveCases(): Promise<CaseWithRelations[]> {
    const active = ["DETECTED", "DIAGNOSED", "IN_PROGRESS"];
    return [...this.cases.values()].filter((c) => active.includes(c.status));
  }

  async createIntervention(data: NewInterventionData) {
    const id = `iv_${++this.seq}`;
    this.interventions.push({ ...data, id });
    return { id };
  }

  async updateCase(id: string, data: CaseUpdateData) {
    const current = this.cases.get(id)!;
    this.cases.set(id, { ...current, ...data } as CaseWithRelations);
  }

  async createAuditLog(data: AuditLogData | AIAuditLogData) {
    this.audits.push(data);
  }

  async findDueScheduledInterventions(): Promise<DueIntervention[]> {
    return [] as DueIntervention[];
  }

  async updateIntervention(
    id: string,
    data: Partial<import("@/generated/prisma/client").RecoveryIntervention>
  ) {
    const entry = this.interventions.find((iv) => iv.id === id);
    if (entry) Object.assign(entry, data);
  }

  async findPendingRazorpayIntervention(recoveryCaseId: string) {
    const found = [...this.interventions]
      .reverse()
      .find(
        (iv) =>
          iv.recoveryCaseId === recoveryCaseId &&
          (iv as { provider?: string | null }).provider === "razorpay" &&
          iv.status === "AWAITING_PAYMENT" &&
          iv.result === "PENDING"
      );
    return (found ?? null) as unknown as import("@/generated/prisma/client").RecoveryIntervention | null;
  }

  async createAIDecision(data: NewAIDecisionData) {
    const id = `aid_${++this.seq}`;
    this.decisions.push({ ...data, id });
    return { id };
  }
}
