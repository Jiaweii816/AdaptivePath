import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { recallThreeLayerLearningExperiences } from "@/server/memory/learning-experience-recall/three-layer-recall";
import type { FtsStore } from "@/server/memory/store/fts-store";
import type { MemoryRetrievalDocument } from "@/server/memory/store/retrieval-document-store";
import type { VectorStore } from "@/server/memory/store/vector-store";

describe("three-layer learning-experience recall", () => {
  it("fuses lexical and two semantic lanes, then collapses one evidence family into one slot", async () => {
    const documents = [
      doc(
        "episode-a",
        "review_episode",
        "episode",
        ["activity-a", "review:review-a"],
        "过去在 Sqrt(x) 中，left = mid 让区间不再缩小。",
      ),
      doc(
        "fact-a",
        "l2_fact",
        "fact",
        ["hashed-evidence-a", "review:review-a"],
        "反复证据表明：保留 mid 前必须证明它仍可能是答案。",
      ),
      doc(
        "slot-a",
        "l3_synthesis",
        "synthesis",
        ["hashed-evidence-a", "review:review-a"],
        "辅导时先让学习者说清 mid 是否仍是候选。",
      ),
      doc(
        "episode-b",
        "review_episode",
        "episode",
        ["cluster-b"],
        "过去在 Search Insert 中用 half-open lower bound 成功收缩区间。",
      ),
      {
        ...doc(
          "legacy-fallback",
          "review_episode",
          "episode",
          ["cluster-c"],
          "不应进入新 Tool。",
        ),
        retrievalTextVersion: 0,
      },
    ];
    const ftsStore = {
      searchMemoryFts: () => [
        { refId: "fact-a", kind: "fact", rank: -2 },
        { refId: "episode-b", kind: "episode", rank: -1 },
      ],
    } as unknown as FtsStore;
    const vectorStore = {
      dim: 2,
      searchSimilar: (embedding: number[]) =>
        embedding[0] === 1
          ? [
              { refId: "episode-a", kind: "episode", distance: 0.9 },
              { refId: "episode-b", kind: "episode", distance: 0.95 },
            ]
          : [
              { refId: "slot-a", kind: "synthesis", distance: 0.8 },
              { refId: "episode-b", kind: "episode", distance: 0.9 },
            ],
    } as unknown as VectorStore;
    const embedClient = {
      model: "test",
      dim: 2,
      embed: async (texts: string[]) =>
        texts.map((text) => (text.includes("失败经验") ? [1, 0] : [0, 1])),
    };

    const result = await recallThreeLayerLearningExperiences({
      prisma: {} as PrismaClient,
      learnerId: "learner",
      ftsKeywords: ["left = mid", "interval does not shrink"],
      failurePattern: "left remains mid, so the closed interval can stall",
      successPattern: "move past mid so every iteration strictly shrinks",
      ftsStore,
      vectorStore,
      embedClient,
      documents,
    });

    expect(result.status).toBe("full");
    expect(result.experiences).toHaveLength(2);
    const threeLayerBundle = result.experiences.find(
      (experience) => experience.sourceLayers.length === 3,
    );
    expect(threeLayerBundle).toMatchObject({
      sourceLayers: ["episode", "l2_fact", "l3_synthesis"],
    });
    expect(threeLayerBundle?.experienceText).toContain("Sqrt(x)");
    expect(
      result.experiences.some((experience) =>
        experience.experienceText.includes("Search Insert"),
      ),
    ).toBe(true);
    expect(result.trace.selectedDocumentIds.flat()).not.toContain(
      "review_episode:legacy-fallback",
    );
  });
});

function doc(
  id: string,
  sourceKind: MemoryRetrievalDocument["sourceKind"],
  ftsKind: MemoryRetrievalDocument["ftsKind"],
  evidenceClusterIds: string[],
  description: string,
): MemoryRetrievalDocument {
  return {
    documentId: `${sourceKind}:${id}`,
    rootMemoryId: id,
    sourceKind,
    sourceRefId: id,
    title:
      sourceKind === "review_episode"
        ? description.split("，")[0]!
        : "Learner memory",
    description,
    searchableAliases: [],
    learnerId: "learner",
    origin: "learner",
    truthClass: sourceKind === "review_episode" ? "historical" : "trusted",
    status: "active",
    role:
      sourceKind === "review_episode"
        ? "episode"
        : sourceKind === "l3_synthesis"
          ? "synthesis"
          : "weakness",
    canonicalMechanisms: [],
    problemIds: [],
    evidenceClusterIds,
    evidenceClusterCount: evidenceClusterIds.length,
    distinctProblemCount: 0,
    updatedAt: "2026-08-11T00:00:00.000Z",
    contentVersion: 1,
    contentHash: id,
    retrievalTextVersion: 1,
    ftsKind,
  };
}
