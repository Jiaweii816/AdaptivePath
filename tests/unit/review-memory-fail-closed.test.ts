import { afterEach, describe, expect, it, vi } from "vitest";
import { loadReviewMemoryContext } from "@/server/agents/coach-agent/review-memory";
import type { FtsStore } from "@/server/memory/store/fts-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("Review memory retrieval failures", () => {
  it("marks retrieval failed instead of reporting an empty lookup as healthy", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const ftsStore: FtsStore = {
      indexMemoryDocument: vi.fn(),
      removeMemoryDocument: vi.fn(),
      reconcileMemoryDocuments: vi.fn(() => ({ indexed: 0, removed: 0 })),
      searchMemoryFts: vi.fn(() => {
        throw new Error("fts projection unavailable");
      }),
      close: vi.fn(),
    };

    const memory = await loadReviewMemoryContext(db.prisma, {
        userId: user.id,
        problemId: problem.id,
        problemTags: ["binary_search"],
        queryText: "help with binary search",
        profile: {
          strongPatterns: [],
          weakPatterns: [],
          outputPreferences: [],
        },
        ftsStore,
      });

    expect(memory.retrievalStatus).toBe("failed");
    expect(memory.teachableMemories).toEqual([]);
  });
});
