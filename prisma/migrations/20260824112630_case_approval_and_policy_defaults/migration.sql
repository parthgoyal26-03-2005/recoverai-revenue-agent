-- AlterTable
ALTER TABLE "RecoveryCase" ADD COLUMN     "merchantApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "merchantApprovedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RecoveryPolicy" ALTER COLUMN "approvalThreshold" SET DEFAULT 500000;
