import { afterEach, describe, expect, it, vi } from "vitest";

import { recallThreeLayerLearningExperiences } from "@/server/memory/learning-experience-recall/three-layer-recall";
import {
  refreshLearnerRetrievalText,
  type RetrievalTextRefreshProvider,
} from "@/server/memory/retrieval-text/refresh-retrieval-text";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import type { VectorStore } from "@/server/memory/store/vector-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("incremental retrieval-text closure", () => {
  it("turns a new Episode into searchable Tool material and refreshes stale source hashes", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const episode = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        kind: "review",
        title: "Binary Search boundary review",
        summary: "The interval did not shrink after assigning left to mid.",
        outcome: "improved",
        tags: "[]",
        salience: 0.9,
        sourceTraceIds: "[]",
        memoryOrigin: "learner",
      },
    });
    const rewrite = vi.fn(
      async (sources: Parameters<RetrievalTextRefreshProvider["rewrite"]>[0]) =>
        new Map(
          sources.map((source) => [
            source.sourceId,
            source.sourceText.join(" ").includes("strictly shrink")
              ? "In a prior binary-search review, the learner repaired the loop by making every non-matching interval strictly shrink."
              : "In a prior binary-search review, assigning left to mid prevented the interval from shrinking; the repair was to move past mid.",
          ]),
        ),
    );
    const provider: RetrievalTextRefreshProvider = {
      name: "mock-semantic-rewriter",
      rewrite,
    };

    const first = await refreshLearnerRetrievalText(db.prisma, {
      userId: user.id,
      episodeIds: [episode.id],
      provider,
    });
    expect(first.refreshedIds).toEqual([episode.id]);
    expect(rewrite).toHaveBeenCalledTimes(1);

    const ftsStore = createFtsStore(db.dbPath);
    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: user.id,
      ftsStore,
    });
    const recalled = await recallThreeLayerLearningExperiences({
      prisma: db.prisma,
      learnerId: user.id,
      ftsKeywords: ["interval", "shrinking"],
      failurePattern: "left remains mid and the interval stalls",
      ftsStore,
      embedClient: { model: "test", dim: 2, embed: async () => [[1, 0]] },
      vectorStore: {
        dim: 2,
        searchSimilar: () => [],
      } as unknown as VectorStore,
    });
    expect(recalled.experiences[0]?.experienceText).toContain("move past mid");

    const unchanged = await refreshLearnerRetrievalText(db.prisma, {
      userId: user.id,
      episodeIds: [episode.id],
      provider,
    });
    expect(unchanged.skippedIds).toEqual([episode.id]);
    expect(rewrite).toHaveBeenCalledTimes(1);

    await db.prisma.memoryEpisode.update({
      where: { id: episode.id },
      data: {
        summary: "The corrected bounds now strictly shrink every iteration.",
      },
    });
    const changed = await refreshLearnerRetrievalText(db.prisma, {
      userId: user.id,
      episodeIds: [episode.id],
      provider,
    });
    expect(changed.refreshedIds).toEqual([episode.id]);
    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(
      await db.prisma.memoryEpisode.findUniqueOrThrow({
        where: { id: episode.id },
        select: { retrievalText: true, retrievalTextVersion: true },
      }),
    ).toMatchObject({
      retrievalText: expect.stringContaining("strictly shrink"),
      retrievalTextVersion: 1,
    });
  });

  it("fails closed when semantic rewriting fails", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const episode = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        kind: "review",
        title: "Changed learning event",
        summary: "New evidence replaced the prior interpretation.",
        outcome: "improved",
        tags: "[]",
        salience: 0.8,
        sourceTraceIds: "[]",
        memoryOrigin: "learner",
        retrievalText: "An old retrieval card that must no longer be served.",
        retrievalTextVersion: 1,
        retrievalInputHash: "stale-hash",
      },
    });

    const result = await refreshLearnerRetrievalText(db.prisma, {
      userId: user.id,
      episodeIds: [episode.id],
      provider: {
        name: "failing-provider",
        rewrite: async () => {
          throw new Error("provider_unavailable");
        },
      },
    });
    expect(result.failed).toEqual([
      { sourceId: episode.id, reason: "provider_unavailable" },
    ]);
    expect(
      await db.prisma.memoryEpisode.findUniqueOrThrow({
        where: { id: episode.id },
        select: { retrievalTextVersion: true, retrievalInputHash: true },
      }),
    ).toEqual({ retrievalTextVersion: 0, retrievalInputHash: null });
  });

  it("refreshes a changed trusted L2 before its dependent active L3", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "weakness",
        tag: "binary-search-boundary",
        label: "Binary-search boundary updates",
        value: "The learner may retain mid without proving progress.",
        claimText: "The learner may retain mid without proving progress.",
        polarity: "negative",
        confidence: 0.8,
        evidenceCount: 2,
        status: "active",
        ...trustedL2FactFixture({
          mechanism: "binary-search-boundary",
          humanLabel: "Binary-search boundary updates",
          problemIds: [problem.id, "second-problem"],
        }),
      },
    });
    const slot = await db.prisma.synthesisSlot.create({
      data: {
        userId: user.id,
        slot: "weakness_patterns",
        synthesisKey: "binary-search-coaching",
        text: "Ask the learner to prove interval progress before changing a bound.",
        evidenceFactIds: JSON.stringify([fact.id]),
        confidence: 0.8,
        status: "active",
        memoryOrigin: "learner",
      },
    });
    const provider: RetrievalTextRefreshProvider = {
      name: "mock-layer-rewriter",
      rewrite: async (sources) =>
        new Map(
          sources.map((source) => [
            source.sourceId,
            source.layer === "l2_fact"
              ? "Across prior evidence, retaining mid without proving progress caused unreliable binary-search boundary updates."
              : "For future boundary searches, ask the learner to prove that every update makes the interval progress.",
          ]),
        ),
    };

    const result = await refreshLearnerRetrievalText(db.prisma, {
      userId: user.id,
      factIds: [fact.id],
      provider,
    });

    expect(result.refreshedIds).toEqual([fact.id, slot.id]);
    await expect(
      db.prisma.l2MemoryFact.findUniqueOrThrow({ where: { id: fact.id } }),
    ).resolves.toMatchObject({ retrievalTextVersion: 1 });
    await expect(
      db.prisma.synthesisSlot.findUniqueOrThrow({ where: { id: slot.id } }),
    ).resolves.toMatchObject({ retrievalTextVersion: 1 });
  });
});
