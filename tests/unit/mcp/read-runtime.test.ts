import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReadOnlyMcpRuntime,
  createReadOnlyPrismaClient,
} from "@/mcp/read-runtime";

const require = createRequire(import.meta.url);

type SetupDatabase = {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown };
  close(): void;
};

type SetupDatabaseConstructor = new (path: string) => SetupDatabase;

const Database = require("better-sqlite3") as SetupDatabaseConstructor;
const directories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRuntimeDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "pc-mcp-runtime-"));
  directories.push(directory);
  const path = join(directory, "runtime.db");
  const database = new Database(path);
  database.exec(`
    CREATE TABLE User (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Problem (
      id TEXT PRIMARY KEY,
      leetcodeNumber INTEGER UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
    );
    CREATE VIRTUAL TABLE memory_fts USING fts5(
      content,
      kind UNINDEXED,
      ref_id UNINDEXED,
      learner_id UNINDEXED,
      tokenize = 'unicode61'
    );
  `);
  database
    .prepare("INSERT INTO User (id, handle) VALUES (?, ?)")
    .run("user-dev", "PatternCoachDev");
  database
    .prepare(
      "INSERT INTO Problem (id, leetcodeNumber, slug, title, tags) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      "problem-704",
      704,
      "binary-search",
      "Binary Search",
      JSON.stringify(["Array", "Binary Search"]),
    );
  database.close();
  return { directory, path, databaseUrl: `file:${path}` };
}

describe("read-only MCP runtime", () => {
  it("fails fast without an explicit DATABASE_URL and resolves an explicit relative read path", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => createReadOnlyMcpRuntime()).toThrow(
      /explicit DATABASE_URL/i,
    );
    const fixture = createRuntimeDatabase();
    const runtime = createReadOnlyMcpRuntime({
      databaseUrl: "file:./runtime.db",
      cwd: fixture.directory,
    });
    await expect(runtime.resolveLearner("PatternCoachDev")).resolves.toEqual({
      userId: "user-dev",
      handle: "PatternCoachDev",
    });
    await runtime.close();
  });

  it("resolves only an explicit external handle and a real problem slug", async () => {
    const fixture = createRuntimeDatabase();
    const runtime = createReadOnlyMcpRuntime({ databaseUrl: fixture.databaseUrl });

    await expect(
      runtime.resolveLearnerContext({
        handle: "PatternCoachDev",
        problemSlug: "binary-search",
      }),
    ).resolves.toEqual({
      userId: "user-dev",
      handle: "PatternCoachDev",
      activeProblem: {
        id: "problem-704",
        slug: "binary-search",
        title: "Binary Search",
        leetcodeNumber: 704,
        tags: ["Array", "Binary Search"],
      },
    });
    await expect(
      runtime.resolveLearnerContext({
        handle: "Iris904",
        problemSlug: "binary-search",
      }),
    ).rejects.toThrow(/learner handle was not found/i);
    await expect(runtime.resolveLearner("PatternCoachDev")).resolves.toEqual({
      userId: "user-dev",
      handle: "PatternCoachDev",
    });
    await expect(runtime.resolveProblem("missing-problem")).rejects.toThrow(
      /problem slug was not found/i,
    );
    await runtime.close();
  });

  it("opens Prisma through a database-enforced read-only connection", async () => {
    const fixture = createRuntimeDatabase();
    const prisma = createReadOnlyPrismaClient(fixture.databaseUrl);

    await expect(
      prisma.user.create({ data: { handle: "MustNotPersist" } }),
    ).rejects.toThrow(/readonly|read-only/i);
    await prisma.$disconnect();
  });

});
