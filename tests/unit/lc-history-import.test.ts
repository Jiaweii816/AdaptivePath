import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importLeetCodeHistory } from "../../scripts/import-lc-history";
import { seedDatabase } from "../../prisma/seed";
import { applyPrismaMigrations } from "./prisma-test-utils";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("importLeetCodeHistory", () => {
  it("maps accepted Hot-150 submissions into stable solved L2 facts", async () => {
    const prisma = await createSeededClient();
    const client = {
      getRecentSubmissions: vi.fn().mockResolvedValue([
        {
          title: "Two Sum",
          titleSlug: "two-sum",
          timestamp: "1760000000",
          statusDisplay: "Accepted",
          lang: "python3",
        },
        {
          title: "Merge Intervals",
          titleSlug: "merge-intervals",
          timestamp: "1760000100",
          statusDisplay: "Wrong Answer",
          lang: "python3",
        },
        {
          title: "Not Hot 150",
          titleSlug: "contains-duplicate",
          timestamp: "1760000200",
          statusDisplay: "Accepted",
          lang: "python3",
        },
      ]),
    };

    try {
      const preview = await importLeetCodeHistory({
        username: "try",
        prismaClient: prisma,
        client,
      });
      expect(preview).toMatchObject({ acceptedHot150: 1, imported: 0 });
      expect(await prisma.l2MemoryFact.count()).toBe(0);

      const first = await importLeetCodeHistory({
        username: "try",
        prismaClient: prisma,
        client,
        dryRun: false,
        memoryOrigin: "learner",
      });
      const second = await importLeetCodeHistory({
        username: "try",
        prismaClient: prisma,
        client,
        dryRun: false,
        memoryOrigin: "learner",
      });
      const facts = await prisma.l2MemoryFact.findMany({
        where: { factType: "solved" },
      });

      expect(first).toMatchObject({
        scanned: 3,
        acceptedHot150: 1,
        imported: 1,
      });
      expect(second.imported).toBe(1);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        factType: "solved",
        tag: "two-sum",
        evidenceCount: 1,
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function createSeededClient() {
  const dir = mkdtempSync(join(tmpdir(), "patterncoach-lc-history-"));
  tempDirs.push(dir);

  const databasePath = join(dir, "lc-history.db");
  const db = new Database(databasePath);
  applyPrismaMigrations(db);
  db.close();

  const adapter = new PrismaBetterSqlite3({ url: databasePath });
  const prisma = new PrismaClient({ adapter });
  await seedDatabase(prisma);

  return prisma;
}
