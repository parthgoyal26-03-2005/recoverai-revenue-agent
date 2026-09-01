-- AlterEnum
ALTER TYPE "InterventionStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterEnum
ALTER TYPE "InterventionResult" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "RecoveryIntervention" ADD COLUMN "provider" TEXT,
ADD COLUMN "providerReference" TEXT,
ADD COLUMN "paymentLinkUrl" TEXT;

-- CreateIndex
CREATE INDEX "RecoveryIntervention_providerReference_idx" ON "RecoveryIntervention"("providerReference");
