import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createVectorStore } from "@/server/memory/store/vector-store";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "pc-vec-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

describe("vector-store", () => {
  it("filters by learner before LIMIT so foreign vectors cannot crowd out owned memory", () => {
    const store = createVectorStore(tempDbPath(), 4);
    try {
      for (let index = 0; index < 25; index += 1) {
        store.upsertEmbedding({
          kind: "fact",
          refId: `foreign-${index}`,
          learnerId: "foreign-user",
          embedding: [1, 0, 0, 0],
        });
      }
      store.upsertEmbedding({
        kind: "fact",
        refId: "owned",
        learnerId: "target-user",
        embedding: [0.99, 0.01, 0, 0],
      });

      expect(
        store.searchSimilar([1, 0, 0, 0], {
          kind: "fact",
          learnerId: "target-user",
          limit: 1,
        }),
      ).toEqual([expect.objectContaining({ refId: "owned" })]);
    } finally {
      store.close();
    }
  });

  it("loads sqlite-vec through the Node CJS entrypoint used by Next server bundles", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/server/memory/store/vector-store.ts"),
      "utf8",
    );
    const nextConfig = readFileSync(
      resolve(process.cwd(), "next.config.ts"),
      "utf8",
    );

    expect(source).not.toContain('import * as sqliteVec from "sqlite-vec"');
    expect(source).toContain('require("sqlite-vec")');
    expect(nextConfig).toContain('serverExternalPackages: ["sqlite-vec"]');
  });

  it("upserts embeddings and returns nearest neighbours by cosine distance", () => {
    const store = createVectorStore(tempDbPath(), 4);
    store.upsertEmbedding({ kind: "episode", refId: "e1", embedding: [1, 0, 0, 0] });
    store.upsertEmbedding({ kind: "episode", refId: "e2", embedding: [0, 1, 0, 0] });
    store.upsertEmbedding({ kind: "fact", refId: "f1", embedding: [1, 0.1, 0, 0] });

    const hits = store.searchSimilar([1, 0, 0, 0], { kind: "episode", limit: 2 });
    expect(hits[0]?.refId).toBe("e1");
    expect(hits.map((hit) => hit.refId)).not.toContain("f1");
    store.close();
  });

  it("re-upserting the same refId replaces the old vector instead of duplicating", () => {
    const store = createVectorStore(tempDbPath(), 4);
    store.upsertEmbedding({ kind: "episode", refId: "e1", embedding: [1, 0, 0, 0] });
    store.upsertEmbedding({ kind: "episode", refId: "e1", embedding: [0, 0, 0, 1] });

    const hits = store.searchSimilar([0, 0, 0, 1], { kind: "episode", limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.refId).toBe("e1");
    store.close();
  });

  it("removeEmbedding deletes by refId", () => {
    const store = createVectorStore(tempDbPath(), 4);
    store.upsertEmbedding({ kind: "episode", refId: "e1", embedding: [1, 0, 0, 0] });
    store.removeEmbedding("e1");
    expect(store.searchSimilar([1, 0, 0, 0], { limit: 5 })).toEqual([]);
    store.close();
  });
});
