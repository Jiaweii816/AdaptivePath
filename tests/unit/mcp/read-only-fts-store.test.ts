import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReadOnlyFtsStore } from "@/mcp/read-only-fts-store";

const require = createRequire(import.meta.url);

type SetupDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
  };
  close(): void;
};

type SetupDatabaseConstructor = new (path: string) => SetupDatabase;

const Database = require("better-sqlite3") as SetupDatabaseConstructor;
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(name = "memory.db") {
  const directory = mkdtempSync(join(tmpdir(), "pc-mcp-ro-fts-"));
  directories.push(directory);
  return join(directory, name);
}

function createDatabase(path: string, withFts: boolean) {
  const database = new Database(path);
  if (withFts) {
    database.exec(`CREATE VIRTUAL TABLE memory_fts USING fts5(
      content,
      kind UNINDEXED,
      ref_id UNINDEXED,
      learner_id UNINDEXED,
      tokenize = 'unicode61'
    )`);
  }
  return database;
}

describe("createReadOnlyFtsStore", () => {
  it("requires an existing database file", () => {
    expect(() => createReadOnlyFtsStore(databasePath("missing.db"))).toThrow(
      /existing SQLite database/i,
    );
  });

  it("reports a missing memory_fts table without creating it", () => {
    const path = databasePath();
    createDatabase(path, false).close();

    const store = createReadOnlyFtsStore(path);
    expect(() =>
      store.searchMemoryFts("binary boundary", { limit: 5 }),
    ).toThrow(/memory_fts table does not exist/i);
    store.close();

    const verification = new Database(path);
    const table = verification
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get("memory_fts");
    expect(table).toBeUndefined();
    verification.close();
  });

  it("searches the existing learner-scoped index and rejects every write API", () => {
    const path = databasePath();
    const setup = createDatabase(path, true);
    setup
      .prepare(
        "INSERT INTO memory_fts (content, kind, ref_id, learner_id) VALUES (?, ?, ?, ?)",
      )
      .run("binary search boundary", "fact", "fact-1", "user-1");
    setup.close();

    const store = createReadOnlyFtsStore(path);
    expect(
      store.searchMemoryFts("binary boundary", {
        kind: "fact",
        learnerId: "user-1",
        limit: 5,
      }),
    ).toEqual([{ refId: "fact-1", kind: "fact", rank: expect.any(Number) }]);
    expect(() =>
      store.indexMemoryDocument({
        kind: "fact",
        refId: "fact-2",
        content: "must fail",
        learnerId: "user-1",
      }),
    ).toThrow(/read-only MCP FTS store/i);
    expect(() => store.removeMemoryDocument("fact-1")).toThrow(
      /read-only MCP FTS store/i,
    );
    expect(() =>
      store.reconcileMemoryDocuments({ kind: "fact", documents: [] }),
    ).toThrow(/read-only MCP FTS store/i);
    store.close();
  });
});
