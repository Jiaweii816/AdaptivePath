import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../prisma/seed";
import { applyPrismaMigrations } from "./prisma-test-utils";
import {
  TEST_LEARNER_MEMORY_ORIGIN,
  trustedL2FactFixture,
} from "./memory-test-helpers";
import { hot150Problems } from "@/data/hot150";
import { buildCoachMemoryContext } from "@/server/memory";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import { findPracticeProblemChatTool } from "@/server/tools/chat-tools/find-practice-problem-tool";
import { getAlgorithmHintChatTool } from "@/server/tools/chat-tools/get-algorithm-hint-tool";
import { pastMistakeRecallChatTool } from "@/server/tools/chat-tools/history-recall-tool";
import { lookupApiReferenceChatTool } from "@/server/tools/chat-tools/lookup-api-reference-tool";
import {
  runVerifyProposedRepairChatTool,
  runCurrentCodeChatTool,
} from "@/server/tools/chat-tools/run-code-tool";
import { resolveWorkingRunContext } from "@/server/agents/coach-agent/authoritative-run-context";
import { hashCodeForRun } from "@/server/code/code-hash";
import {
  dispatchPreparedChatToolCall,
  prepareChatToolCall,
} from "@/server/tools/chat-tools/chat-tool-dispatch";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

const tempDirs: string[] = [];
const originalRunnerProvider = process.env.CODE_RUNNER_PROVIDER;

afterEach(() => {
  if (originalRunnerProvider === undefined) {
    delete process.env.CODE_RUNNER_PROVIDER;
  } else {
    process.env.CODE_RUNNER_PROVIDER = originalRunnerProvider;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("chat tools", () => {
  it("runs candidate code through the runner entrypoint and persists candidate-origin run evidence", async () => {
    process.env.CODE_RUNNER_PROVIDER = "mock";
    const prisma = await createSeededClient();

    try {
      const fixture = await createReviewFixture(prisma);
      const beforeReviewCount = await prisma.reviewAttempt.count();
      const result = await runVerifyProposedRepairChatTool(
        {
          candidateCode: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
          language: "Python",
          repair: {
            diagnosis: "The placeholder return does not produce the required pair.",
            changedSymbol: "Solution.twoSum",
            edits: [{
              before: "return []",
              after: "return [0, 1]",
              reason: "Return the tested complement pair for this focused repair.",
            }],
            expectedBehavior: "The custom complement case returns [0, 1].",
          },
          tests: [
            {
              label: "custom complement",
              input: { nums: [2, 7, 11, 15], target: 9 },
              expected: [0, 1],
            },
          ],
        },
        {
          prisma,
          userId: fixture.user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          chatSessionId: fixture.chatSession.id,
          toolCallId: "tool-call-1",
          problem: fixture.problem,
          problemTags: ["array", "hashmap"],
          workspace: {
            code: "class Solution:\n    def twoSum(self, nums, target):\n        return []",
            language: "Python",
          },
        },
      );

      if (!result.repairValidated) {
        throw new Error(`Expected repair validation, got ${result.reason}`);
      }

      const storedEvidence = await prisma.runEvidence.findUniqueOrThrow({
        where: { id: result.runEvidenceId },
      });

      expect(result.result.status).toBe("passed_visible_tests");
      expect(storedEvidence.source).toBe("chat_candidate_tool");
      expect(storedEvidence.toolCallId).toBe("tool-call-1");
      expect(storedEvidence.chatSessionId).toBe(fixture.chatSession.id);
      expect(storedEvidence.codeHash).toMatch(/^sha256:/);
      expect(storedEvidence.executionFingerprint).toMatch(
        /^execfp:v1:sha256:/,
      );
      expect(result.codeHash).toBe(storedEvidence.codeHash);
      expect(result.executionFingerprint).toBe(
        storedEvidence.executionFingerprint,
      );
      expectNoModelHashLeak(result.llmObservation);
      expect(result.llmObservation).toMatchObject({
        producer: "assistant_tool",
        subject: "assistant_candidate",
        authority: "advisory",
        scope: { kind: "specific_examples", totalCount: 1 },
        oracle: "provided_expected",
      });
      expect(result.codeOrigin).toBe("assistant_candidate");
      expect(result.evidenceKind).toBe("candidate_run");
      expect(result.reviewAttemptId).toBeNull();
      expectMockCapabilities(result.evidenceVerdict);
      expectMockCapabilities(
        JSON.parse(storedEvidence.rawResultJson).rawResult.evidenceVerdict,
      );
      await expect(prisma.reviewAttempt.count()).resolves.toBe(
        beforeReviewCount,
      );
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rejects a copied editor program before it reaches the runner or RunEvidence", async () => {
    const prisma = await createSeededClient();

    try {
      const fixture = await createReviewFixture(prisma);
      const currentCode =
        "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]";
      const beforeEvidence = await prisma.runEvidence.count();
      const result = await runVerifyProposedRepairChatTool(
        {
          candidateCode: `from typing import List\n\n${currentCode}`,
          language: "Python",
          repair: {
            diagnosis: "Reproduce the learner's current logic.",
            changedSymbol: "Solution.twoSum",
            edits: [{
              before: "return [0, 1]",
              after: "return [0, 1]",
              reason: "No execution-relevant edit was made.",
            }],
            expectedBehavior: "The copied code would have the same behavior.",
          },
        },
        {
          prisma,
          userId: fixture.user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          chatSessionId: fixture.chatSession.id,
          toolCallId: "tool-call-copy",
          problem: fixture.problem,
          problemTags: ["array", "hashmap"],
          workspace: { code: currentCode, language: "Python" },
        },
      );

      expect(result).toMatchObject({
        repairValidated: false,
        reason: "candidate_is_not_a_repair",
        llmObservation: {
          observationKind: "proposed_repair_rejected",
        },
      });
      await expect(prisma.runEvidence.count()).resolves.toBe(beforeEvidence);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("persists mock current-code Chat runs without verdict or durable-write capabilities", async () => {
    process.env.CODE_RUNNER_PROVIDER = "mock";
    const prisma = await createSeededClient();

    try {
      const fixture = await createReviewFixture(prisma);
      const code =
        "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]";
      const codeHash = hashCodeForRun({ language: "Python", code });
      const result = await runCurrentCodeChatTool(
        {
          tests: [
            {
              label: "custom complement",
              input: { nums: [2, 7, 11, 15], target: 9 },
              expected: [0, 1],
            },
          ],
        },
        {
          prisma,
          userId: fixture.user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          chatSessionId: fixture.chatSession.id,
          toolCallId: "tool-call-current-1",
          userMessageSequence: 1,
          problem: fixture.problem,
          problemTags: ["array", "hashmap"],
          workspace: {
            code,
            language: "Python",
            codeHash,
            selectedTests: [],
          },
        },
      );
      const storedEvidence = await prisma.runEvidence.findUniqueOrThrow({
        where: { id: result.runEvidenceId },
      });

      expect(result.result.status).toBe("passed_visible_tests");
      expect(storedEvidence.source).toBe("chat_current_tool");
      expect(storedEvidence.codeHash).toBe(codeHash);
      expect(storedEvidence.executionFingerprint).toMatch(
        /^execfp:v1:sha256:/,
      );
      expect(result.executionFingerprint).toBe(
        storedEvidence.executionFingerprint,
      );
      expect(result.evidenceVerdict.capabilities.canVerdict).toBe(false);
      expectMockCapabilities(result.evidenceVerdict);
      expectMockCapabilities(
        JSON.parse(storedEvidence.rawResultJson).rawResult.evidenceVerdict,
      );
      const chatRunContext = JSON.parse(
        storedEvidence.rawResultJson,
      ).rawResult.chatRunContext;
      expect(chatRunContext).toMatchObject({ userMessageSequence: 1 });
      expect(chatRunContext.suiteFingerprint).toMatch(/^sha256:/);
      await expect(
        resolveWorkingRunContext({
          chatSessionId: fixture.chatSession.id,
          currentScope: {
            codeHash,
            executionFingerprint: storedEvidence.executionFingerprint ?? undefined,
            suiteFingerprint: chatRunContext.suiteFingerprint,
          },
        }, prisma),
      ).resolves.toMatchObject({
        alignment: "exact",
        evidence: { id: storedEvidence.id },
      });
      expectNoModelHashLeak(result.llmObservation);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("ranks human-readable past-mistake items without raw tag filtering", async () => {
    const prisma = await createSeededClient();

    try {
      const fixture = await createReviewFixture(prisma);
      const user = fixture.user;
      await prisma.l2MemoryFact.createMany({
        data: [
          {
            userId: user.id,
            problemId: fixture.problem.id,
            factType: "mistake",
            tag: "binary_search_invariant",
            ...trustedL2FactFixture({
              mechanism: "binary_search_invariant",
              humanLabel: "Updates the wrong binary-search boundary",
            }),
            label: "Binary search boundary mistake",
            confidence: 0.8,
            evidenceCount: 2,
            value: JSON.stringify({
              evidenceTraceIds: ["trace-1"],
              evidenceSummaries: ["Returned too far right."],
            }),
            lastEvidenceSummary: "Returned too far right.",
          },
          {
            userId: user.id,
            problemId: fixture.problem.id,
            factType: "mistake",
            tag: "sliding_window_invariant",
            ...trustedL2FactFixture({
              mechanism: "sliding_window_invariant",
              humanLabel: "Moves the sliding-window left edge backward",
            }),
            label: "Sliding window left rollback",
            confidence: 0.7,
            evidenceCount: 1,
            value: JSON.stringify({
              evidenceTraceIds: ["trace-2"],
              evidenceSummaries: ["Moved left backwards."],
            }),
            lastEvidenceSummary: "Moved left backwards.",
          },
        ],
      });
      const ftsDir = mkdtempSync(join(tmpdir(), "patterncoach-history-tool-"));
      tempDirs.push(ftsDir);
      const ftsStore = createFtsStore(join(ftsDir, "history.db"));
      await reconcileLearnerMemoryRetrievalDocuments(prisma, {
        userId: user.id,
        ftsStore,
      });
      const memoryAssembly = await buildCoachMemoryContext(prisma, {
        userId: user.id,
        problemId: fixture.problem.id,
        problemTags: ["binary_search", "sliding_window"],
        queryText: "Which past binary search mistake is relevant?",
        entry: { kind: "recall_tool" },
        profile: {
          strongPatterns: [],
          weakPatterns: [],
          outputPreferences: [],
        },
        ftsStore,
      });
      const context = {
        prisma,
        userId: user.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        memoryAssembly,
        chatSessionId: fixture.chatSession.id,
        problem: toolProblemContext(fixture.problem),
        problemTags: ["binary_search", "sliding_window"],
      };
      const full = await pastMistakeRecallChatTool(
        { query: "past mistakes" },
        context,
      );
      const focused = await pastMistakeRecallChatTool(
        {
          query: "binary search boundary mistake",
          searchHints: ["unknown hint must stay soft"],
        },
        context,
      );
      const runtimeAuthoritative = await pastMistakeRecallChatTool(
        {
          query: "DP state-transition mistake",
          searchHints: ["wrong model hint"],
        },
        {
          ...context,
          userMessageContent:
            "Which past binary search boundary mistake is relevant?",
        },
      );

      expect(full.items).toEqual([]);
      expect(focused.items).toEqual([]);
      expect(runtimeAuthoritative.items).toEqual([]);
      expect(JSON.stringify(full.items)).not.toMatch(
        /binary_search_boundary_mistake|sliding_window_left_rollback/,
      );
      ftsStore.close();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("recommends practice from hot150 first, falls back to extended, and excludes completed ids", async () => {
    const prisma = await createSeededClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
    });

    try {
      const reinforce = await findPracticeProblemChatTool(
        {
          mode: "reinforce",
          tags: ["sliding-window"],
          completed_ids: ["3"],
        },
        {
          prisma,
          userId: user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          problemTags: ["sliding-window"],
        },
      );
      const fallback = await findPracticeProblemChatTool(
        {
          mode: "advance",
          tags: ["union-find-advanced"],
          completed_ids: [],
        },
        {
          prisma,
          userId: user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          problemTags: [],
        },
      );

      expect(reinforce.suggestions.length).toBeGreaterThanOrEqual(2);
      expect(reinforce.suggestions.length).toBeLessThanOrEqual(3);
      expect(reinforce.recommendationScope).toBe("hot150_same_type");
      expect(reinforce.suggestions.every((item) => item.tags.includes("sliding-window"))).toBe(true);
      expect(reinforce.suggestions.every((item) => item.tier === "hot150")).toBe(true);
      expect(reinforce.suggestions.map((item) => item.leetcodeNumber)).not.toContain(3);
      expect(fallback.usedFallback).toBe(true);
      expect(fallback.recommendationScope).toBe("extended_fallback");
      expect(fallback.suggestions[0]).toMatchObject({
        slug: "number-of-provinces",
        tier: "extended",
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("keeps explicit same-pattern practice inside Hot-150 until that pattern is exhausted", async () => {
    const prisma = await createSeededClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
    });

    try {
      const result = await findPracticeProblemChatTool(
        {
          mode: "reinforce",
          tags: ["hashmap", "hot150"],
          completed_ids: ["1"],
        },
        {
          prisma,
          userId: user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          problemTags: ["hashmap", "top-interview-150"],
        },
      );

      expect(result.searchedTags).toEqual(["hashmap"]);
      expect(result.recommendationScope).toBe("hot150_same_type");
      expect(result.usedFallback).toBe(false);
      expect(result.suggestions).toHaveLength(3);
      expect(result.suggestions.every((item) => item.tier === "hot150")).toBe(true);
      expect(result.suggestions.every((item) => item.tags.includes("hashmap"))).toBe(true);
      expect(result.suggestions.map((item) => item.leetcodeNumber)).not.toContain(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("filters noisy broad tags through the current Hot-150 section", async () => {
    const prisma = await createSeededClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
    });
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: "two-sum" },
    });

    try {
      const result = await findPracticeProblemChatTool(
        {
          mode: "reinforce",
          tags: ["hashmap", "array"],
          completed_ids: ["1"],
        },
        {
          prisma,
          userId: user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          problem: {
            slug: problem.slug,
            leetcodeNumber: problem.leetcodeNumber,
          },
          problemTags: ["array", "hashmap", "top-interview-150"],
        },
      );

      expect(result.searchedTags).toEqual(["hashmap"]);
      expect(result.recommendationScope).toBe("hot150_same_type");
      expect(result.suggestions.every((item) => item.section === "Hashmap")).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("uses extended same-pattern problems only after the Hot-150 pattern is completed", async () => {
    const prisma = await createSeededClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
    });

    try {
      await markHot150SectionCompleted(prisma, user.id, "Hashmap");

      const result = await findPracticeProblemChatTool(
        {
          mode: "reinforce",
          tags: ["hashmap"],
          completed_ids: [],
        },
        {
          prisma,
          userId: user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          problemTags: ["hashmap"],
        },
      );

      expect(result.recommendationScope).toBe("extended_same_type");
      expect(result.usedFallback).toBe(true);
      expect(result.transitionMessage).toContain("Hot-150 has no remaining hashmap");
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.every((item) => item.tier === "extended")).toBe(true);
      expect(result.suggestions.every((item) => item.tags.includes("hashmap"))).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("moves a general next-problem request to the next Hot-150 type after the current type is complete", async () => {
    const prisma = await createSeededClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
    });
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: "two-sum" },
    });

    try {
      await markHot150SectionCompleted(prisma, user.id, "Hashmap");

      const result = await findPracticeProblemChatTool(
        {
          mode: "advance",
          tags: ["array", "hashmap"],
          completed_ids: [],
        },
        {
          prisma,
          userId: user.id,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          problem: {
            slug: problem.slug,
            leetcodeNumber: problem.leetcodeNumber,
          },
          problemTags: ["array", "hashmap"],
        },
      );

      expect(result.searchedTags).toEqual(["hashmap"]);
      expect(result.recommendationScope).toBe("hot150_next_type");
      expect(result.usedFallback).toBe(false);
      expect(result.transitionMessage).toContain("Hot-150 hashmap is complete");
      expect(result.transitionMessage).toContain("Intervals");
      expect(result.suggestions.map((item) => item.section)).toEqual([
        "Intervals",
        "Intervals",
        "Intervals",
      ]);
      expect(result.suggestions.every((item) => item.tier === "hot150")).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("advances generic algorithm hint policy per user and problem, capped at level 3", async () => {
    const prisma = await createSeededClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
    });

    try {
      const context = { prisma, userId: user.id };
      const first = await getAlgorithmHintChatTool(
        { problem_slug: "search-insert-position" },
        context,
      );
      const second = await getAlgorithmHintChatTool(
        { problem_slug: "search-insert-position" },
        context,
      );
      const third = await getAlgorithmHintChatTool(
        { problem_slug: "search-insert-position" },
        context,
      );
      const capped = await getAlgorithmHintChatTool(
        { problem_slug: "search-insert-position" },
        context,
      );
      const otherProblem = await getAlgorithmHintChatTool(
        { problem_slug: "two-sum" },
        context,
      );

      expect(first.level).toBe(1);
      expect(second.level).toBe(2);
      expect(third.level).toBe(3);
      expect(capped.level).toBe(3);
      expect(capped.capped).toBe(true);
      expect(otherProblem.level).toBe(1);
      expect(first.hintPolicy?.mode).toBe("algorithm_or_data_structure");
      expect(second.hintPolicy?.mode).toBe("implementation_strategy");
      expect(third.hintPolicy?.mode).toBe("pseudocode");
      expect(first.message).toContain("does not provide a problem-specific answer");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("returns a generic hint policy for cached non-demo Hot-150 problems", async () => {
    const prisma = await createSeededClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
    });
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: "valid-parentheses" },
    });

    try {
      expect(problem.isDemoSupported).toBe(false);

      const result = await getAlgorithmHintChatTool(
        { problem_slug: "valid-parentheses", focus: "choosing the right data structure" },
        {
          prisma,
          userId: user.id,
          chatSessionId: "chat-1",
          toolCallId: "tool-call-1",
          workspace: { codeHash: "sha256:abc" },
        },
      );

      expect(result).toMatchObject({
        found: true,
        problemSlug: "valid-parentheses",
        title: "Valid Parentheses",
        level: 1,
        previousLevel: 0,
        maxLevel: 3,
        capped: false,
        focus: "choosing the right data structure",
        telemetry: {
          chatSessionId: "chat-1",
          toolCallId: "tool-call-1",
          currentCodeHash: "sha256:abc",
          eventKind: "algorithm_hint_progressed",
        },
      });
      expect(result.problemTags?.length).toBeGreaterThan(0);
      expect(result.hint?.content).toContain("Level 1 hint");
      expect(result.hintPolicy?.mustAvoid).toContain("Do not give pseudocode.");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("uses the active problem when the LLM omits problem_slug", async () => {
    const prisma = await createSeededClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
    });
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: "merge-intervals" },
    });

    try {
      const result = await getAlgorithmHintChatTool(
        {},
        {
          prisma,
          userId: user.id,
          problem: {
            id: problem.id,
            slug: problem.slug,
            title: problem.title,
          },
          problemTags: ["array", "intervals"],
        },
      );

      expect(result.found).toBe(true);
      expect(result.problemSlug).toBe("merge-intervals");
      expect(result.problemTags).toEqual(["array", "intervals"]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("looks up local API references and returns safe not-found results", async () => {
    await expect(
      lookupApiReferenceChatTool({
        language: "Python",
        topic: "collections",
      }),
    ).resolves.toMatchObject({
      found: true,
      entry: { topic: "collections" },
    });
    await expect(
      lookupApiReferenceChatTool({
        language: "C++",
        topic: "unordered_map",
      }),
    ).resolves.toMatchObject({
      found: true,
      entry: { topic: "unordered_map" },
    });
    await expect(
      lookupApiReferenceChatTool({
        language: "Python",
        topic: "队列",
      }),
    ).resolves.toMatchObject({
      found: true,
      entry: { topic: "deque" },
    });
    await expect(
      lookupApiReferenceChatTool({
        language: "Python",
        topic: "bisect",
      }),
    ).resolves.toMatchObject({
      found: false,
      availableTopics: expect.arrayContaining(["deque", "collections", "heapq"]),
    });
  });

  it("dispatches a model-planned durable write without reparsing lexical intent", async () => {
    const prisma = await createSeededClient();

    try {
      const fixture = await createReviewFixture(prisma);
      const prepared = prepareChatToolCall({
        id: "dispatcher-model-planned-save",
        name: "save_mistake_book_entry",
        arguments: {
          title: "Two-pointer invariant",
          guideMarkdown:
            "Keep the window invariant explicit before moving a pointer.",
        },
      });

      const dispatched = await dispatchPreparedChatToolCall(prepared, {
        prisma,
        userId: fixture.user.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        chatSessionId: fixture.chatSession.id,
        userMessageContent: "Please organize this lesson for later.",
        problem: fixture.problem,
        problemTags: ["array", "hash_table"],
      });

      expect(dispatched).toMatchObject({
        name: "save_mistake_book_entry",
        result: { saved: true, entryId: expect.any(String) },
      });
      await expect(
        prisma.mistakeBookEntry.count({
          where: {
            userId: fixture.user.id,
            problemId: fixture.problem.id,
          },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.l1MemoryEvent.count({
          where: {
            chatSessionId: fixture.chatSession.id,
            eventType: "mistake_book_entry",
          },
        }),
      ).resolves.toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });
});

function expectNoModelHashLeak(value: unknown) {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain("sha256:");
  expect(serialized).not.toContain('"codeHash"');
  expect(serialized).not.toContain('"executionFingerprint"');
  expect(serialized).not.toContain('"executedCodeHash"');
  expect(serialized).not.toContain('"currentCodeHash"');
}

function toolProblemContext(problem: {
  id: string;
  slug: string;
  title: string;
  methodName: string;
}) {
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    leetcodeNumber: null,
    methodName: problem.methodName,
    inputContractJson: "{}",
    outputContractJson: "{}",
    isDemoSupported: true,
    localRunStatus: "runnable",
    localRunStatusMessage: null,
    comparisonStrategy: "exact",
    comparisonConfigJson: "{}",
    contractKind: "pure_function",
  };
}

function expectMockCapabilities(value: unknown) {
  expect(value).toMatchObject({
    capabilities: {
      canVerdict: false,
      canWriteMistakeMemory: false,
      canWriteEpisode: false,
      canSignalPlanner: false,
      canUseFailureSalience: false,
    },
  });
}

async function createSeededClient() {
  const dir = mkdtempSync(join(tmpdir(), "patterncoach-chat-tools-"));
  tempDirs.push(dir);

  const databasePath = join(dir, "chat-tools.db");
  const db = new Database(databasePath);
  applyPrismaMigrations(db);
  db.close();

  const adapter = new PrismaBetterSqlite3({ url: databasePath });
  const prisma = new PrismaClient({ adapter });
  await seedDatabase(prisma);

  return prisma;
}

async function markHot150SectionCompleted(
  prisma: PrismaClient,
  userId: string,
  section: string,
) {
  const problems = await prisma.problem.findMany({
    where: {
      leetcodeNumber: {
        in: hot150Problems
          .filter((problem) => problem.section === section)
          .map((problem) => problem.leetcodeNumber),
      },
    },
    orderBy: { leetcodeNumber: "asc" },
  });

  for (const problem of problems) {
    const chatSession = await prisma.chatSession.create({
      data: {
        userId,
        problemId: problem.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        title: problem.title,
        primaryLanguage: "en",
      },
    });
    const reviewAttempt = await prisma.reviewAttempt.create({
      data: {
        userId,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        language: "Python",
        codeSnapshot: "",
      },
    });

    await prisma.problemHistory.create({
      data: {
        userId,
        problemId: problem.id,
        reviewAttemptId: reviewAttempt.id,
        chatSessionId: chatSession.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        language: "Python",
        problemTags: problem.tags,
        runStatus: "passed_visible_tests",
      },
    });
  }
}

async function createReviewFixture(prisma: PrismaClient) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { handle: "try" },
  });
  const problem = await prisma.problem.findUniqueOrThrow({
    where: { slug: "two-sum" },
  });
  const testCase = await prisma.problemTestCase.findFirstOrThrow({
    where: { problemId: problem.id, isVisible: true },
  });
  const codeDraft = await prisma.codeDraft.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      language: "Python",
      content: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
    },
  });
  const chatSession = await prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      title: problem.title,
      primaryLanguage: "en",
    },
  });

  await prisma.reviewAttempt.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      codeDraftId: codeDraft.id,
      language: "Python",
      codeSnapshot: codeDraft.content,
      selectedTestCaseIds: JSON.stringify([testCase.id]),
      selectedTestsJson: JSON.stringify([
        {
          id: testCase.id,
          label: testCase.label,
          input: JSON.parse(testCase.inputJson),
          expected: JSON.parse(testCase.expectedJson),
          source: testCase.source,
        },
      ]),
    },
  });

  return {
    user,
    problem,
    chatSession,
  };
}
