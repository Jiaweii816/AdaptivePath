import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "../src/lib/env";
import { DEFAULT_DATABASE_URL } from "../src/server/db/sqlite-path";
import { scrubToolProtocolData } from "../src/server/llm/scrub-tool-protocol-data";

async function main() {
  loadLocalEnv();
  const apply = process.argv.includes("--apply");
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const report = await scrubToolProtocolData(prisma, { apply });
    console.log(JSON.stringify(report, null, 2));
    if (!apply && (report.scrubbedMessages || report.scrubbedTracePayloads)) {
      console.log("Dry run only. Re-run with --apply to persist the scrub.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
