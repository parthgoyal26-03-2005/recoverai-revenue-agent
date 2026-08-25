import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const failedPayment = await prisma.recoveryCase.findFirst({
    where: {
      scenario: "FAILED_PAYMENT",
      status: { in: ["DETECTED", "IN_PROGRESS"] },
      amountAtRisk: { lt: 500000 },
    },
    select: { id: true, status: true, retryCount: true },
  });
  const abandoned = await prisma.recoveryCase.findFirst({
    where: {
      scenario: "CHECKOUT_ABANDONMENT",
      status: { in: ["DETECTED", "IN_PROGRESS"] },
    },
    select: { id: true },
  });
  const highValue = await prisma.recoveryCase.findFirst({
    where: {
      scenario: "FAILED_PAYMENT",
      status: "ESCALATED",
    },
    select: { id: true },
  });
  console.log(
    JSON.stringify({ failedPayment, abandoned, highValue }, null, 2)
  );
}

main().finally(() => prisma.$disconnect());
