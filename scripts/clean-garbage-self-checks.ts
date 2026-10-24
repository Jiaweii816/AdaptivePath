import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "../src/lib/env";
import { DEFAULT_DATABASE_URL } from "../src/server/db/sqlite-path";
import { isCleanSelfCheck } from "../src/server/agents/coach-agent/self-check-guard";

async function main() {
  loadLocalEnv();
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const rows = await prisma.diagnosisResult.findMany({
      where: {
        OR: [
          { selfCheckQuestion: { not: null } },
          { selfCheckAnswer: { not: null } },
        ],
      },
      select: { id: true, selfCheckQuestion: true, selfCheckAnswer: true },
    });

    let cleared = 0;
    for (const row of rows) {
      const clean = isCleanSelfCheck(
        row.selfCheckQuestion && row.selfCheckAnswer
          ? { question: row.selfCheckQuestion, answer: row.selfCheckAnswer }
          : null,
      );
      if (clean) {
        continue;
      }

      await prisma.diagnosisResult.update({
        where: { id: row.id },
        data: { selfCheckQuestion: null, selfCheckAnswer: null },
      });
      cleared += 1;
    }

    console.log(
      `Cleared ${cleared} garbage self-checks of ${rows.length} populated rows.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
