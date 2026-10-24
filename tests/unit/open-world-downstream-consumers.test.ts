import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildEnglishCoachSummary,
  buildCommonMistakes,
  buildDynamicSkillProfile,
  formatLatestSynthesis,
} from "@/features/profile/profile-data";
import { readLearnerClaimSemantics } from "@/server/memory/claims/learner-claim-semantics";
import { buildInterviewDossier } from "@/server/mock-interview/build-interview-dossier";
import {
  projectLearnerClaimToPlannerWeaknessTags,
  weaknessMechanismMatchesProblem,
} from "@/server/planner/planner-service";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
});

describe("open-world learner claim semantics", () => {
  it("prefers v2 polarity, natural language, topic hints, and optional mechanisms", () => {
    const semantics = readLearnerClaimSemantics({
      factType: "knowledge_state",
      tag: "claim_opaque_hash_that_must_not_surface",
      label: "legacy fallback",
      claimText: "The learner forgets visited marking before graph DFS recursion.",
      polarity: "negative",
      scopeJson: JSON.stringify({
        level: "cross_problem",
        topicHints: ["graph DFS", "visited state"],
      }),
      mechanismKeysJson: "[]",
      integrityVersion: 2,
    });

    expect(semantics).toMatchObject({
      version: "open_world_v2",
      polarity: "negative",
      statement: "The learner forgets visited marking before graph DFS recursion.",
      topicHints: ["graph DFS", "visited state"],
      mechanismKeys: [],
      displayTopics: ["graph DFS", "visited state"],
    });
    expect(semantics.projectionTerms.join(" ")).not.toContain("opaque_hash");
  });
});

describe("Profile open-world projection", () => {
  it("shows earned graph/tree/depth topics dynamically before self-reported onboarding rows", () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const skillProfile = buildDynamicSkillProfile({
      strongPatterns: ["Sliding Window", "Two Pointers"],
      weakPatterns: ["Dynamic Programming"],
      memoryFacts: [
        claimFact({
          polarity: "negative",
          claimText: "The learner twice omitted visited marking before DFS recursion.",
          topicHints: ["graph DFS", "visited state"],
          lastSeenAt: now,
        }),
        claimFact({
          polarity: "positive",
          claimText: "The learner reliably contracts recursion depth before implementation.",
          topicHints: ["tree recursion", "depth contraction"],
          lastSeenAt: new Date(now.getTime() - 1_000),
        }),
      ],
    });

    expect(skillProfile.slice(0, 4)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Graph DFS", status: "Watch" }),
        expect.objectContaining({ name: "Visited State", status: "Watch" }),
        expect.objectContaining({ name: "Tree Recursion", status: "Strong" }),
        expect.objectContaining({ name: "Depth Contraction", status: "Strong" }),
      ]),
    );
    const firstSelfReported = skillProfile.findIndex((row) =>
      row.source.startsWith("Self-reported"),
    );
    expect(firstSelfReported).toBeGreaterThanOrEqual(4);
  });

  it("includes any negative-polarity claim in common mistakes and preserves Chinese L3 text", () => {
    const fact = claimFact({
      polarity: "negative",
      claimText: "图 DFS 中仍会忘记在递归前标记 visited。",
      topicHints: ["图 DFS", "visited 状态"],
      lastSeenAt: new Date("2026-07-20T12:00:00Z"),
    });
    const mistakes = buildCommonMistakes([
      { ...fact, lastEvidenceSummary: "第二道图题再次出现。", problem: null },
    ]);

    expect(mistakes).toEqual([
      expect.objectContaining({
        tag: "图 DFS",
        label: "图 DFS 中仍会忘记在递归前标记 visited。",
      }),
    ]);
    expect(
      formatLatestSynthesis([
        {
          slot: "weakness_patterns",
          text: "跨图题时，visited 标记仍需要在递归前主动检查。",
        },
      ]),
    ).toContain("跨图题时，visited 标记仍需要在递归前主动检查。");
  });

  it("projects a concise English-only coach briefing for the Profile screenshot surface", () => {
    const summary = buildEnglishCoachSummary({
      hasSynthesis: true,
      skillProfile: [
        {
          name: "Graph Traversal",
          status: "Strong",
          source: "图遍历表现稳定",
          confidence: 0.9,
          evidenceCount: 8,
          lastSeenAt: new Date("2026-07-20T12:00:00Z"),
        },
        {
          name: "Sliding Window Invariant",
          status: "Watch",
          source: "左指针更新仍需检查",
          confidence: 0.82,
          evidenceCount: 5,
          lastSeenAt: new Date("2026-07-20T12:00:00Z"),
        },
      ],
      commonMistakes: [],
    });

    expect(summary).toHaveLength(3);
    expect(
      summary.map((item) => `${item.subject} ${item.detail}`).join(" "),
    ).not.toMatch(
      /[\u3400-\u9fff]/,
    );
    expect(summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Leading strength",
          subject: "Graph Traversal",
        }),
        expect.objectContaining({
          label: "Watch area",
          subject: "Sliding Window Invariant",
        }),
      ]),
    );
  });
});

describe("Planner open-world projection", () => {
  it("uses negative v2 semantic terms softly and never projects the opaque claim hash", () => {
    const tags = projectLearnerClaimToPlannerWeaknessTags({
      factType: "knowledge_state",
      tag: "claim_704f6a9d2c4e",
      claimText: "The learner forgets visited marking before graph DFS recursion.",
      polarity: "negative",
      scopeJson: JSON.stringify({
        level: "cross_problem",
        topicHints: ["graph DFS", "visited state"],
      }),
      mechanismKeysJson: "[]",
      integrityVersion: 2,
    });

    expect(tags).toEqual(
      expect.arrayContaining(["graph_dfs", "visited_state"]),
    );
    expect(tags.some((tag) => tag.includes("704f6a9d2c4e"))).toBe(false);
    const unknownNaturalLanguageTag = tags.find((tag) =>
      tag.startsWith("the_learner_forgets"),
    );
    expect(unknownNaturalLanguageTag).toBeDefined();
    expect(
      weaknessMechanismMatchesProblem(unknownNaturalLanguageTag!, [
        "array",
        "two_pointers",
      ]),
    ).toBe(false);
    expect(
      projectLearnerClaimToPlannerWeaknessTags({
        factType: "knowledge_state",
        tag: "claim_positive",
        claimText: "Depth contraction is a demonstrated strength.",
        polarity: "positive",
        scopeJson: JSON.stringify({ topicHints: ["depth contraction"] }),
        mechanismKeysJson: "[]",
        integrityVersion: 2,
      }),
    ).toEqual([]);
  });
});

describe("Mock Interview dossier open-world projection", () => {
  it("places positive and negative knowledge_state claims by polarity", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({
      data: { handle: "OpenWorldInterviewLearner" },
    });
    const problems = await Promise.all([
      createProblem("interview-tree-claim"),
      createProblem("interview-graph-claim"),
    ]);
    await Promise.all([
      createTrustedClaim({
        userId: user.id,
        problemIds: problems.map((problem) => problem.id),
        suffix: "tree-depth",
        polarity: "positive",
        claimText: "The learner reliably uses depth contraction in tree recursion.",
        topicHints: ["tree recursion", "depth contraction"],
      }),
      createTrustedClaim({
        userId: user.id,
        problemIds: problems.map((problem) => problem.id),
        suffix: "graph-visited",
        polarity: "negative",
        claimText: "The learner repeatedly omits visited marking before graph DFS recursion.",
        topicHints: ["graph DFS", "visited state"],
      }),
    ]);

    const dossier = await buildInterviewDossier(db.prisma, {
      userId: user.id,
      focusTags: ["graph"],
      responseLanguage: "en",
    });

    expect(dossier.strongSignals[0]).toBe(
      "The learner reliably uses depth contraction in tree recursion.",
    );
    expect(dossier.weakSignals[0]).toBe(
      "The learner repeatedly omits visited marking before graph DFS recursion.",
    );
    expect(dossier.recentMistakes[0]).toContain("visited marking");
    expect(dossier.strongSignals.join(" ")).not.toContain("claim_");
    expect(dossier.weakSignals.join(" ")).not.toContain("claim_");
  });
});

function claimFact(args: {
  polarity: "positive" | "negative";
  claimText: string;
  topicHints: string[];
  lastSeenAt: Date;
}) {
  return {
    factType: "knowledge_state",
    tag: `claim_${args.polarity}_${args.topicHints.length}`,
    label: args.claimText,
    value: args.claimText,
    claimText: args.claimText,
    polarity: args.polarity,
    scopeJson: JSON.stringify({
      level: "cross_problem",
      topicHints: args.topicHints,
      problemIds: [],
    }),
    mechanismKeysJson: "[]",
    integrityVersion: 2,
    confidence: 0.68,
    evidenceCount: 2,
    lastSeenAt: args.lastSeenAt,
  };
}

function createProblem(slug: string) {
  return db!.prisma.problem.create({
    data: {
      slug,
      title: slug.replaceAll("-", " "),
      methodName: "solve",
      tags: JSON.stringify(["graph", "tree"]),
    },
  });
}

function createTrustedClaim(args: {
  userId: string;
  problemIds: string[];
  suffix: string;
  polarity: "positive" | "negative";
  claimText: string;
  topicHints: string[];
}) {
  const clusterKey = `claim:v1:opaque-${args.suffix}`;
  return db!.prisma.l2MemoryFact.create({
    data: {
      userId: args.userId,
      problemId: args.problemIds[0],
      factType: "knowledge_state",
      tag: `claim_${args.suffix}`,
      label: args.claimText,
      value: args.claimText,
      claimText: args.claimText,
      polarity: args.polarity,
      scopeJson: JSON.stringify({
        level: "cross_problem",
        problemIds: args.problemIds,
        topicHints: args.topicHints,
      }),
      mechanismKeysJson: "[]",
      integrityVersion: 2,
      clusterKey,
      confidence: 0.68,
      evidenceCount: 2,
      status: "active",
      memoryOrigin: "learner",
      validationJson: JSON.stringify({
        integrity: {
          version: 1,
          origin: "learner",
          subject: "learner_behavior",
          mechanism: clusterKey,
          humanLabel: args.claimText,
          portability: "portable",
          promotionStatus: "trusted",
          evidenceClusters: args.problemIds.map((problemId, index) => ({
            key: `activity-${args.suffix}-${index + 1}`,
            problemId,
            reviewAttemptId: null,
            revisionKey: `revision-${args.suffix}-${index + 1}`,
            transition: "reinforce",
            evidenceTraceIds: [`trace-${args.suffix}-${index + 1}`],
          })),
        },
      }),
    },
  });
}
