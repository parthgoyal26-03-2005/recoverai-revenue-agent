-- AlterTable
ALTER TABLE "RecoveryCase" ADD COLUMN     "merchantRejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT;

-- AlterEnum
ALTER TYPE "CaseStatus" ADD VALUE 'REJECTED';
