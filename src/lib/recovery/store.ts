import type {
  InterventionAction,
  Prisma,
  PrismaClient,
  RecoveryCase,
  RecoveryIntervention,
} from "@/generated/prisma/client";
import type { ActionType } from "@/lib/domain/types";

export type CaseWithRelations = RecoveryCase & {
  customer: { id: string; name: string; email: string };
  merchant: {
    id: string;
    name: string;
    policy: {
      maxRetries: number;
      maxContactAttempts: number;
      recoveryWindowHours: number;
      approvalThreshold: number;
    } | null;
  };
};

export type NewInterventionData = {
  recoveryCaseId: string;
  action: ActionType;
  status: RecoveryIntervention["status"];
  result: RecoveryIntervention["result"];
  scheduledAt: Date | null;
  executedAt: Date | null;
  recoveredAmount: number;
  notes: string | null;
  provider?: string | null;
  providerReference?: string | null;
  paymentLinkUrl?: string | null;
};

export type CaseUpdateData = {
  status?: RecoveryCase["status"];
  resolvedAt?: Date | null;
  retryCount?: number;
  contactCount?: number;
  merchantApproved?: boolean;
  merchantApprovedAt?: Date;
  merchantRejectedAt?: Date;
  rejectionReason?: string | null;
};

export type AuditLogData = {
  recoveryCaseId: string;
  event: string;
  actor: "SYSTEM" | "AI" | "POLICY_ENGINE" | "MERCHANT";
  metadata: Prisma.InputJsonObject;
};

export type DueIntervention = RecoveryIntervention & {
  recoveryCase: CaseWithRelations;
};

export interface RecoveryStore {
  getCase(id: string): Promise<CaseWithRelations | null>;
  findActiveCases(limit?: number): Promise<CaseWithRelations[]>;
  createIntervention(data: NewInterventionData): Promise<{ id: string }>;
  updateCase(id: string, data: CaseUpdateData): Promise<void>;
  createAuditLog(data: AuditLogData): Promise<void>;
  findDueScheduledInterventions(now: Date): Promise<DueIntervention[]>;
  updateIntervention(
    id: string,
    data: Partial<RecoveryIntervention>
  ): Promise<void>;
}

export function createPrismaStore(prisma: PrismaClient): RecoveryStore {
  return {
    getCase(id) {
      return prisma.recoveryCase.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          merchant: {
            select: {
              id: true,
              name: true,
              policy: {
                select: {
                  maxRetries: true,
                  maxContactAttempts: true,
                  recoveryWindowHours: true,
                  approvalThreshold: true,
                },
              },
            },
          },
        },
      }) as Promise<CaseWithRelations | null>;
    },
    findActiveCases(limit = 100) {
      return prisma.recoveryCase.findMany({
        where: { status: { in: ["DETECTED", "DIAGNOSED", "IN_PROGRESS"] } },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          merchant: {
            select: {
              id: true,
              name: true,
              policy: {
                select: {
                  maxRetries: true,
                  maxContactAttempts: true,
                  recoveryWindowHours: true,
                  approvalThreshold: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        take: limit,
      }) as Promise<CaseWithRelations[]>;
    },
    createIntervention(data) {
      return prisma.recoveryIntervention.create({
        data: { ...data, action: data.action as InterventionAction },
      });
    },
    async updateCase(id, data) {
      await prisma.recoveryCase.update({ where: { id }, data });
    },
    async createAuditLog(data) {
      await prisma.auditLog.create({ data });
    },
    findDueScheduledInterventions(now) {
      return prisma.recoveryIntervention.findMany({
        where: { status: "SCHEDULED", scheduledAt: { lte: now } },
        include: {
          recoveryCase: {
            include: {
              customer: { select: { id: true, name: true, email: true } },
              merchant: {
                select: {
                  id: true,
                  name: true,
                  policy: {
                    select: {
                      maxRetries: true,
                      maxContactAttempts: true,
                      recoveryWindowHours: true,
                      approvalThreshold: true,
                    },
                  },
                },
              },
            },
          },
        },
        take: 50,
      }) as Promise<DueIntervention[]>;
    },
    async updateIntervention(id, data) {
      await prisma.recoveryIntervention.update({ where: { id }, data });
    },
  };
}
