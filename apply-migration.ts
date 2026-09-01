import "dotenv/config";
import { Client } from "pg";

const DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!DIRECT_URL) {
  throw new Error("DIRECT_URL/DATABASE_URL not set");
}

const MIGRATION_NAME = "20260827110000_add_recovery_provider_fields";

const SQL = `
ALTER TYPE "InterventionStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "InterventionResult" ADD VALUE 'PENDING';
ALTER TABLE "RecoveryIntervention" ADD COLUMN IF NOT EXISTS "provider" TEXT,
ADD COLUMN IF NOT EXISTS "providerReference" TEXT,
ADD COLUMN IF NOT EXISTS "paymentLinkUrl" TEXT;
CREATE INDEX IF NOT EXISTS "RecoveryIntervention_providerReference_idx" ON "RecoveryIntervention"("providerReference");
`;

async function main() {
  const client = new Client({ connectionString: DIRECT_URL });
  await client.connect();

  try {
    const existing = await client.query(
      `SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1`,
      [MIGRATION_NAME]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      console.log("Migration already recorded; applying SQL idempotently.");
    } else {
      await client.query(
        `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
         VALUES (gen_random_uuid()::text, 'manual-' || md5($1), now(), $1, NULL, NULL, now(), 1)`,
        [MIGRATION_NAME]
      );
      console.log("Recorded migration in _prisma_migrations.");
    }

    await client.query(SQL);
    console.log("Migration SQL applied.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
