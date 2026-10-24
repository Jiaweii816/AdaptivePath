import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { createVectorStore } from "@/server/memory/store/vector-store";
import type { EmbedClient } from "@/server/memory/retrieval/embed-client";
import {
  indexLearningExperienceCards,
  recallLearningExperienceCards,
} from "@/server/memory/learning-experience-recall/learning-experience-recall";
import type { LearningExperienceCard } from "@/server/memory/learning-experience-recall/contracts";
import { learningExperienceRecallToolArgsSchema } from "@/server/tools/chat-tools/chat-tool-contracts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("learning-experience recall Pilot", () => {
  it("uses runtime binary-search tag for FTS but requires semantic vector admission in each lane", async () => {
    const dbPath = tempDbPath();
    const fts = createFtsStore(dbPath);
    const vector = createVectorStore(dbPath, 2);
    const embed = semanticEmbedClient();
    const cards = fixtureCards();
    try {
      await indexLearningExperienceCards({
        cards,
        ftsStore: fts,
        vectorStore: vector,
        embedClient: embed,
      });
      const recalled = await recallLearningExperienceCards({
        cards,
        learnerId: "PatternCoachDev",
        problemTags: ["array", "binary-search"],
        failurePattern: "the interval stalls and repeats the left candidate",
        successPattern: "every branch strictly shrinks the closed interval",
        ftsStore: fts,
        vectorStore: vector,
        embedClient: embed,
      });

      expect(recalled.status).toBe("full");
      expect(recalled.algorithmTag).toBe("binary_search");
      expect(recalled.negative?.sourceProblem).toBe("Sqrt(x)");
      expect(recalled.positive?.sourceProblem).toBe("Search a 2D Matrix");
      expect(recalled.trace.ftsQuery).toBe("binary_search");
      expect(recalled.trace.lanes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            polarity: "negative",
            selectedId: "negative-stall",
            eligibleIds: ["negative-stall"],
          }),
          expect.objectContaining({
            polarity: "positive",
            selectedId: "positive-shrink",
            eligibleIds: ["positive-shrink"],
          }),
        ]),
      );
    } finally {
      fts.close();
      vector.close();
    }
  });

  it("does not let same-algorithm FTS matches become learner-facing cards without vectors", async () => {
    const dbPath = tempDbPath();
    const fts = createFtsStore(dbPath);
    const cards = fixtureCards();
    try {
      for (const card of cards) {
        fts.indexMemoryDocument({
          kind: "learning_experience_card",
          refId: card.id,
          learnerId: card.learnerId,
          content: `算法：${card.algorithmTag}\n${card.experienceText}`,
        });
      }
      const recalled = await recallLearningExperienceCards({
        cards,
        learnerId: "PatternCoachDev",
        problemTags: ["binary_search"],
        failurePattern: "the interval stalls",
        ftsStore: fts,
      });

      expect(recalled.status).toBe("vector_unavailable");
      expect(recalled.negative).toBeUndefined();
      expect(recalled.positive).toBeUndefined();
      expect(recalled.trace.lanes[0]?.ftsCandidateIds).toContain(
        "negative-stall",
      );
    } finally {
      fts.close();
    }
  });

  it("keeps experience-card embedding batches within the provider limit", async () => {
    const dbPath = tempDbPath();
    const fts = createFtsStore(dbPath);
    const vector = createVectorStore(dbPath, 2);
    const batchSizes: number[] = [];
    const cards = Array.from({ length: 12 }, (_, index) => ({
      ...fixtureCards()[index % 2]!,
      id: `batch-card-${index}`,
      provenance: {
        sourceProblem: `Problem ${index}`,
        evidenceRefs: [`run:${index}`],
      },
    }));
    try {
      await indexLearningExperienceCards({
        cards,
        ftsStore: fts,
        vectorStore: vector,
        embedClient: {
          model: "provider-cap-test",
          dim: 2,
          async embed(texts) {
            batchSizes.push(texts.length);
            if (texts.length > 10) throw new Error("batch too large");
            return texts.map(() => [1, 0]);
          },
        },
      });
      expect(batchSizes).toEqual([10, 2]);
    } finally {
      fts.close();
      vector.close();
    }
  });

  it("uses FTS as an algorithm scope gate and ranks same-tag cards by vector distance", async () => {
    const dbPath = tempDbPath();
    const fts = createFtsStore(dbPath);
    const vector = createVectorStore(dbPath, 2);
    const cards: LearningExperienceCard[] = [
      {
        id: "lexical-only-neighbor",
        learnerId: "PatternCoachDev",
        algorithmTag: "binary_search",
        polarity: "negative",
        experienceText: "A lexical-neighbor binary-search failure.",
        provenance: {
          sourceProblem: "Lexical neighbor",
          evidenceRefs: ["run:lexical"],
        },
      },
      {
        id: "semantic-neighbor",
        learnerId: "PatternCoachDev",
        algorithmTag: "binary_search",
        polarity: "negative",
        experienceText: "A semantic-neighbor terminal candidate failure.",
        provenance: {
          sourceProblem: "Semantic neighbor",
          evidenceRefs: ["run:semantic"],
        },
      },
    ];
    const embed: EmbedClient = {
      model: "scope-gate-test",
      dim: 2,
      async embed(texts) {
        return texts.map((text) => {
          if (text.includes("semantic-neighbor") || text.includes("specific"))
            return [1, 0];
          return [0, 1];
        });
      },
    };
    try {
      await indexLearningExperienceCards({
        cards,
        ftsStore: fts,
        vectorStore: vector,
        embedClient: embed,
      });
      const recalled = await recallLearningExperienceCards({
        cards,
        learnerId: "PatternCoachDev",
        problemTags: ["binary-search"],
        failurePattern: "specific terminal candidate failure",
        ftsStore: fts,
        vectorStore: vector,
        embedClient: embed,
      });
      const lane = recalled.trace.lanes.find(
        (item) => item.polarity === "negative",
      );
      expect(lane?.rankedCandidates).toEqual([
        expect.objectContaining({
          id: "semantic-neighbor",
          ftsMatched: true,
          distance: 0,
        }),
        expect.objectContaining({
          id: "lexical-only-neighbor",
          ftsMatched: true,
        }),
      ]);
    } finally {
      fts.close();
      vector.close();
    }
  });

  it("does not infer an algorithm tag from the LLM pattern", async () => {
    const dbPath = tempDbPath();
    const fts = createFtsStore(dbPath);
    const vector = createVectorStore(dbPath, 2);
    try {
      const recalled = await recallLearningExperienceCards({
        cards: fixtureCards(),
        learnerId: "PatternCoachDev",
        problemTags: ["array"],
        failurePattern: "this text says binary search but tags do not",
        ftsStore: fts,
        vectorStore: vector,
        embedClient: semanticEmbedClient(),
      });
      expect(recalled.status).toBe("algorithm_tag_unavailable");
      expect(recalled.negative).toBeUndefined();
    } finally {
      fts.close();
      vector.close();
    }
  });

  it("keeps eval-only cards in the ranking trace but never selects them", async () => {
    const dbPath = tempDbPath();
    const fts = createFtsStore(dbPath);
    const vector = createVectorStore(dbPath, 2);
    const cards = [
      ...fixtureCards(),
      {
        id: "eval-only-stall",
        learnerId: "PatternCoachDev",
        algorithmTag: "binary_search",
        polarity: "negative" as const,
        answerEligible: false,
        evalOnly: true,
        experienceText:
          "A legacy record says a closed interval stalled on the same candidate.",
        provenance: {
          sourceProblem: "Legacy binary search",
          evidenceRefs: ["legacy:untrusted"],
        },
      },
    ];
    try {
      await indexLearningExperienceCards({
        cards,
        ftsStore: fts,
        vectorStore: vector,
        embedClient: semanticEmbedClient(),
      });
      const recalled = await recallLearningExperienceCards({
        cards,
        learnerId: "PatternCoachDev",
        problemTags: ["binary-search"],
        failurePattern: "the interval stalls and repeats the left candidate",
        ftsStore: fts,
        vectorStore: vector,
        embedClient: semanticEmbedClient(),
      });

      const negativeLane = recalled.trace.lanes.find(
        (lane) => lane.polarity === "negative",
      );
      expect(negativeLane?.rankedCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "eval-only-stall",
            answerEligible: false,
          }),
        ]),
      );
      expect(negativeLane?.eligibleIds).not.toContain("eval-only-stall");
      expect(recalled.negative?.sourceProblem).toBe("Sqrt(x)");
    } finally {
      fts.close();
      vector.close();
    }
  });

  it("rejects model attempts to provide runtime-owned scope fields", () => {
    expect(
      learningExperienceRecallToolArgsSchema.safeParse({
        ftsKeywords: ["left = mid"],
        failurePattern: "stalls",
        userId: "not-allowed",
      }).success,
    ).toBe(false);
    expect(
      learningExperienceRecallToolArgsSchema.safeParse({
        ftsKeywords: ["left = mid + 1"],
        problemId: "not-allowed",
        algorithmTag: "binary_search",
        successPattern: "strictly shrinks",
      }).success,
    ).toBe(false);
  });
});

function fixtureCards(): LearningExperienceCard[] {
  return [
    {
      id: "negative-stall",
      learnerId: "PatternCoachDev",
      algorithmTag: "binary_search",
      polarity: "negative",
      experienceText:
        "A closed binary-search interval stalled because left stayed on the same candidate.",
      provenance: { sourceProblem: "Sqrt(x)", evidenceRefs: ["run:negative"] },
    },
    {
      id: "positive-shrink",
      learnerId: "PatternCoachDev",
      algorithmTag: "binary_search",
      polarity: "positive",
      experienceText:
        "Each closed-interval branch strictly shrank the interval and skipped mid.",
      provenance: {
        sourceProblem: "Search a 2D Matrix",
        evidenceRefs: ["run:positive"],
      },
    },
  ];
}

function semanticEmbedClient(): EmbedClient {
  return {
    model: "semantic-test",
    dim: 2,
    async embed(texts) {
      return texts.map((text) => {
        const lower = text.toLowerCase();
        if (lower.includes("stall") || lower.includes("repeat")) return [1, 0];
        if (
          lower.includes("strict") ||
          lower.includes("shrink") ||
          lower.includes("skip")
        )
          return [0, 1];
        return [0.5, 0.5];
      });
    },
  };
}

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "pc-learning-experience-"));
  dirs.push(dir);
  return join(dir, "pilot.sqlite");
}
