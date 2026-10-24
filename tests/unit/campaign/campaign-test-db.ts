import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { applyPrismaMigrations } from "../prisma-test-utils";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

export async function createCampaignTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "patterncoach-campaign-r1-1-"));
  const dbPath = join(dir, "campaign.db");
  const raw = new Database(dbPath);
  applyPrismaMigrations(raw);
  raw.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  const migrationNames = readdirSync(join(process.cwd(), "prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const insertMigration = raw.prepare(
    `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
     VALUES (?, 'test', current_timestamp, ?, 1)`,
  );
  for (const migrationName of migrationNames) insertMigration.run(`test-${migrationName}`, migrationName);
  raw.close();
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
  });
  return {
    dir,
    dbPath,
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(dir, { force: true, recursive: true });
    },
  };
}
