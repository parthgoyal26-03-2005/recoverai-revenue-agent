-- AlterTable
ALTER TABLE "AIDecision" ADD COLUMN     "priority" "CasePriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "requiresMerchantAttention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'mock',
ALTER COLUMN "model" SET DEFAULT 'mock-rules-v1';
