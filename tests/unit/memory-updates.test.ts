import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDatabase } from "../../prisma/seed";
import { buildCoachMemoryContext } from "@/server/memory";
import {
  appendL1TraceEvent,
  appendL1TraceEvents,
} from "@/server/memory/l1-trace/append-trace";
import { getRecentL1Trace } from "@/server/memory/l1-trace/get-recent-traces";
import {
  arbitrateFactCandidates,
  mapMemoryUpdateCandidateToFactCandidates,
} from "@/server/memory/store/fact-store";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import {
  runReflection,
  type RunReflectionArgs,
} from "@/server/agents/memory-agent/tasks/reflect";
import { enqueueReflection } from "@/server/jobs/enqueue-reflection";
import {
  activityExtractionInputSchema,
  buildActivityExtractionPrompt,
  createMockActivityExtractionProvider,
  runActivityExtraction,
} from "@/server/memory/extraction";
import { sealChatOnlyActivityCluster } from "@/server/memory/activity-clusters";
import { l1MemoryEventTypeSchema } from "@/types/memory";
import { TEST_LEARNER_MEMORY_ORIGIN } from "./memory-test-helpers";
import { applyPrismaMigrations } from "./prisma-test-utils";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

const tempDirs: string[] = [];
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

it("offers canonical mechanism candidates in the extraction prompt", () => {
  const prompt = buildActivityExtractionPrompt(
    activityExtractionInputSchema.parse({
      cluster: {
        id: "c1",
        kind: "review_rooted",
        inputHash: "h",
        independentEvidenceKey: "k",
        problemId: "p1",
        problemTitle: "Coin Change",
        problemTags: ["dynamic-programming"],
        candidateMechanismKeys: ["dynamic_programming_state_transition"],
        startedAt: "2026-07-22T01:00:00.000Z",
        endedAt: null,
      },
      items: [
        {
          ordinal: 0,
          sourceType: "l1_event",
          sourceId: "t1",
          speaker: "learner",
          occurredAt: "2026-07-22T01:00:00.000Z",
          text: "dp 状态定义写错了。",
          evidenceTraceIds: ["t1"],
        },
      ],
      allowedLearnerEvidenceTraceIds: ["t1"],
    }),
  );

  expect(prompt).toContain("dynamic_programming_state_transition");
  expect(prompt).toContain("Choose 0-2 keys");
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
});

describe("memory updates", () => {
  it("marks extraction partial when one observation cites disallowed evidence", async () => {
    const prisma = await createSeededClient();
    let ftsStore: ReturnType<typeof createFtsStore> | undefined;

    try {
      const fixture = await createReviewFixture(prisma);
      await prisma.chatMessage.createMany({
        data: [
          {
            sessionId: fixture.chatSession.id,
            role: "user",
            contentMarkdown: "I forgot the binary-search insertion boundary again.",
            sequence: 1,
            memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          },
          {
            sessionId: fixture.chatSession.id,
            role: "assistant",
            contentMarkdown: "Keep the invariant tied to the first valid index.",
            sequence: 2,
            memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          },
        ],
      });
      const learnerTrace = await appendL1TraceEvent(prisma, {
        ...fixture.traceBase,
        eventType: "chat_user_message",
        content: "I forgot the binary-search insertion boundary again.",
      });
      const cluster = await sealChatOnlyActivityCluster(prisma, {
        chatSessionId: fixture.chatSession.id,
        startMessageSequence: 1,
        endMessageSequence: 2,
        boundaryReason: "explicit_exit",
        additionalSourceItems: [
          {
            sourceType: "l1_event",
            sourceId: learnerTrace.id,
            evidenceRole: "trace",
          },
        ],
      });
      const ftsDir = mkdtempSync(join(tmpdir(), "pc-memory-fts-"));
      tempDirs.push(ftsDir);
      ftsStore = createFtsStore(join(ftsDir, "fts.db"));
      const provider = createMockActivityExtractionProvider({
        output: {
          episode: {
            title: "Partial citation extraction",
            summary: "One valid observation and one bad citation.",
            outcome: "improved",
            tags: ["binary search"],
            salience: 0.5,
            evidenceTraceIds: [learnerTrace.id],
          },
          observations: [
            {
              claimType: "mistake",
              claimText: "The learner forgot the insertion boundary invariant.",
              polarity: "negative",
              scope: {
                level: "mechanism",
                problemIds: [fixture.problem.id],
                topicHints: ["binary search insertion boundary"],
              },
              mechanismKeys: [],
              evidenceStrength: "observed",
              evidenceTraceIds: [learnerTrace.id],
            },
            {
              claimType: "mistake",
              claimText: "This observation cites evidence that was never supplied.",
              polarity: "negative",
              scope: {
                level: "mechanism",
                problemIds: [fixture.problem.id],
                topicHints: ["binary search insertion boundary"],
              },
              mechanismKeys: [],
              evidenceStrength: "observed",
              evidenceTraceIds: ["trace-hallucinated"],
            },
          ],
          coverage: { status: "complete" },
        },
      });

      const result = await runActivityExtraction(prisma, {
        activityClusterId: cluster.cluster.id,
        provider,
        ftsStore,
      });

      expect(result.receiptStatus).toBe("partial");
      expect(result.observationIds).toHaveLength(1);
      expect(result.rejectedObservations).toEqual([
        {
          index: 1,
          reason: "observation_evidence_not_allowed:trace-hallucinated",
        },
      ]);
      await expect(
        prisma.memoryExtractionReceipt.findUniqueOrThrow({
          where: { id: result.receiptId },
        }),
      ).resolves.toMatchObject({ status: "partial" });
      await expect(
        prisma.memoryClaimObservation.count({
          where: { activityClusterId: cluster.cluster.id },
        }),
      ).resolves.toBe(1);
      const rejection = await prisma.l1MemoryEvent.findFirstOrThrow({
        where: {
          eventType: "fact_rejected",
          source: "memory_agent:extract_activity",
        },
        select: { content: true, eventJson: true },
      });
      expect(rejection.content).toContain("trace-hallucinated");
      expect(JSON.stringify(rejection.eventJson)).toContain(
        "trace-hallucinated",
      );
    } finally {
      ftsStore?.close();
      await prisma.$disconnect();
    }
  });

  it("keeps semantic L1 event types runtime-validated and rejects telemetry-only traces", async () => {
    const prisma = await createSeededClient();

    try {
      const fixture = await createReviewFixture(prisma);

      expect(l1MemoryEventTypeSchema.safeParse("tool_call").success).toBe(false);
      expect(l1MemoryEventTypeSchema.safeParse("tool_result").success).toBe(false);
      expect(l1MemoryEventTypeSchema.safeParse("chat_history_cleared").success).toBe(true);
      expect(l1MemoryEventTypeSchema.safeParse("memory_synthesis_failed").success).toBe(true);
      await expect(
        appendL1TraceEvent(prisma, {
          ...fixture.traceBase,
          eventType: "not_a_real_event" as never,
        }),
      ).rejects.toThrow();

      await expect(
        prisma.l1MemoryEvent.count({
          where: { userId: fixture.user.id },
        }),
      ).resolves.toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("appends L1 review and chat events as one ordered trace", async () => {
    const prisma = await createSeededClient();

    try {
      const fixture = await createReviewFixture(prisma);
      const base = Date.parse("2026-06-09T12:00:00.000Z");

      await appendL1TraceEvents(prisma, [
        {
          ...fixture.traceBase,
          eventType: "review_attempt",
          content: "Review My Code",
          occurredAt: new Date(base),
        },
        {
          ...fixture.traceBase,
          eventType: "run_evidence",
          content: "failed: 0 passed, 1 failed",
          occurredAt: new Date(base + 1),
        },
        {
          ...fixture.traceBase,
          eventType: "diagnosis",
          content: "Boundary update is too aggressive.",
          occurredAt: new Date(base + 2),
        },
        {
          ...fixture.traceBase,
          eventType: "coach_reply",
          content: "Try returning left first.",
          occurredAt: new Date(base + 3),
        },
      ]);
      await appendL1TraceEvent(prisma, {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        chatSessionId: fixture.chatSession.id,
        eventType: "chat_user_message",
        content: "为什么 return left?",
        occurredAt: new Date(base + 4),
      });
      await appendL1TraceEvent(prisma, {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        chatSessionId: fixture.chatSession.id,
        eventType: "chat_reply",
        content: "因为 left 表示第一个可插入位置。",
        occurredAt: new Date(base + 5),
      });

      const trace = await getRecentL1Trace(prisma, {
        userId: fixture.user.id,
        chatSessionId: fixture.chatSession.id,
      });

      expect(trace.map((event) => event.eventType)).toEqual([
        "review_attempt",
        "run_evidence",
        "diagnosis",
        "coach_reply",
        "chat_user_message",
        "chat_reply",
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("upserts repeated L2 diagnosis facts without overwriting the origin problem", async () => {
    const prisma = await createSeededClient();

    try {
      const first = await createReviewFixture(prisma);
      const secondProblem = await prisma.problem.create({
        data: {
          slug: "binary-search-recurrence",
          title: "Binary Search Recurrence",
          methodName: "search",
          tags: JSON.stringify(["binary-search", "array"]),
        },
      });
      const secondDraft = await prisma.codeDraft.create({
        data: {
          userId: first.user.id,
          problemId: secondProblem.id,
          language: "Python",
          content: "class Solution: pass",
        },
      });
      const secondSession = await prisma.chatSession.create({
        data: {
          userId: first.user.id,
          problemId: secondProblem.id,
          title: secondProblem.title,
          primaryLanguage: "zh",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        },
      });
      const firstTrace = await appendVerifiedReviewRunTrace(prisma, {
        userId: first.user.id,
        problemId: first.problem.id,
        chatSessionId: first.chatSession.id,
        reviewAttemptId: first.reviewAttempt.id,
        content: "First review exposed a boundary transition error.",
        status: "failed",
        executionFingerprint: "binary-boundary-revision-1",
      });
      const firstArbitration = await arbitrateFactCandidates(prisma, {
        userId: first.user.id,
        problemId: first.problem.id,
        reviewAttemptId: first.reviewAttempt.id,
        source: "review_diagnosis",
        candidates: mapMemoryUpdateCandidateToFactCandidates({
          evidenceTraceIds: [firstTrace.id],
          candidate: {
            facts: [
              {
                factType: "mistake",
                tag: "binary_search_boundary_mistake",
                label:
                  "Moves the binary-search boundary past the first valid insertion position.",
                confidence: 0.7,
                evidenceSummary: "Returned one index too far right.",
              },
            ],
          },
        }),
      });
      const firstFact = firstArbitration.updated[0];
      const secondReview = await prisma.reviewAttempt.create({
        data: {
          userId: first.user.id,
          problemId: secondProblem.id,
          chatSessionId: secondSession.id,
          codeDraftId: secondDraft.id,
          language: "Python",
          codeSnapshot: secondDraft.content,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        },
      });
      const secondTrace = await appendVerifiedReviewRunTrace(prisma, {
        userId: first.user.id,
        problemId: secondProblem.id,
        chatSessionId: secondSession.id,
        reviewAttemptId: secondReview.id,
        content: "A later review exposed the same boundary transition error.",
        status: "failed",
        executionFingerprint: "binary-boundary-revision-2",
      });
      const secondArbitration = await arbitrateFactCandidates(prisma, {
        userId: first.user.id,
        problemId: secondProblem.id,
        reviewAttemptId: secondReview.id,
        source: "review_diagnosis",
        candidates: mapMemoryUpdateCandidateToFactCandidates({
          evidenceTraceIds: [secondTrace.id],
          candidate: {
            facts: [
              {
                factType: "mistake",
                tag: "binary_search_boundary_mistake",
                label:
                  "Moves the binary-search boundary past the first valid insertion position.",
                confidence: 0.9,
                evidenceSummary: "Again kept the wrong boundary candidate.",
              },
            ],
          },
        }),
      });
      const secondFact = secondArbitration.updated[0];

      const facts = await prisma.l2MemoryFact.findMany({
        where: {
          userId: first.user.id,
          factType: "mistake",
          tag: "binary_search_invariant",
        },
      });
      const evidenceTraceIds = JSON.parse(
        facts[0]?.evidenceTraceIds ?? "[]",
      ) as string[];

      expect(firstFact?.id).toBe(secondFact?.id);
      expect(facts).toHaveLength(1);
      expect(facts[0]?.problemId).toBe(first.problem.id);
      expect(facts[0]?.evidenceCount).toBe(2);
      expect(facts[0]?.confidence).toBeCloseTo(0.58);
      expect(facts[0]?.sourceReviewAttemptId).toBe(first.reviewAttempt.id);
      expect(facts[0]?.lastEvidenceSummary).toBe(
        "Again kept the wrong boundary candidate.",
      );
      expect(evidenceTraceIds).toEqual(
        expect.arrayContaining([firstTrace.id, secondTrace.id]),
      );
    } finally {
      await prisma.$disconnect();
    }
  });

  it("reads coach memory through parsed JSON tags and deduped L2 context", async () => {
    const prisma = await createSeededClient();

    try {
      const fixture = await createReviewFixture(prisma);
      const unrelatedProblem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "two-sum" },
      });
      const evidenceProblem = await prisma.problem.create({
        data: {
          slug: "binary-search-memory-context",
          title: "Binary Search Memory Context",
          methodName: "search",
          tags: JSON.stringify(["binary-search", "array"]),
        },
      });
      const failedTrace = await appendVerifiedReviewRunTrace(prisma, {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        chatSessionId: fixture.chatSession.id,
        reviewAttemptId: fixture.reviewAttempt.id,
        content: "The first failed review supplied mistake evidence.",
        status: "failed",
        executionFingerprint: "memory-context-failed-revision-1",
      });
      const passedTrace = await appendVerifiedReviewRunTrace(prisma, {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        chatSessionId: fixture.chatSession.id,
        reviewAttemptId: fixture.reviewAttempt.id,
        content: "A separate successful revision supplied earned-skill evidence.",
        status: "passed_visible_tests",
        executionFingerprint: "memory-context-passed-revision-1",
      });
      const memoryFacts = {
        facts: [
          {
            factType: "mistake",
            tag: "binary_search_boundary_mistake",
            label:
              "Moves the binary-search boundary past the first valid insertion position.",
            confidence: 0.7,
            evidenceSummary:
              "The returned insertion point remained one position to the right after the boundary update.",
          },
          {
            factType: "strength",
            tag: "array_traversal_strength",
            label: "Traverses arrays consistently without losing the current index.",
            confidence: 0.8,
            evidenceSummary:
              "The learner preserved the active array index through each traversal step.",
          },
          {
            factType: "skill",
            tag: "lower_bound_skill",
            label: "Explains lower-bound reasoning using a stable search invariant.",
            confidence: 0.6,
            evidenceSummary:
              "The learner tied each boundary move to the first-valid-position invariant.",
          },
        ],
      };
      const [firstMistakeArbitration, firstSkillArbitration] = await Promise.all([
        arbitrateFactCandidates(prisma, {
          userId: fixture.user.id,
          problemId: fixture.problem.id,
          reviewAttemptId: fixture.reviewAttempt.id,
          source: "review_diagnosis",
          candidates: mapMemoryUpdateCandidateToFactCandidates({
            evidenceTraceIds: [failedTrace.id],
            candidate: { facts: [memoryFacts.facts[0]!] },
          }),
        }),
        arbitrateFactCandidates(prisma, {
          userId: fixture.user.id,
          problemId: fixture.problem.id,
          reviewAttemptId: fixture.reviewAttempt.id,
          source: "review_diagnosis",
          candidates: mapMemoryUpdateCandidateToFactCandidates({
            evidenceTraceIds: [passedTrace.id],
            candidate: { facts: memoryFacts.facts.slice(1) },
          }),
        }),
      ]);
      const firstMemoryArbitration = {
        updated: [
          ...firstMistakeArbitration.updated,
          ...firstSkillArbitration.updated,
        ],
        rejected: [
          ...firstMistakeArbitration.rejected,
          ...firstSkillArbitration.rejected,
        ],
      };
      const evidenceSession = await prisma.chatSession.create({
        data: {
          userId: fixture.user.id,
          problemId: evidenceProblem.id,
          title: evidenceProblem.title,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        },
      });
      const evidenceReview = await prisma.reviewAttempt.create({
        data: {
          userId: fixture.user.id,
          problemId: evidenceProblem.id,
          chatSessionId: evidenceSession.id,
          language: "Python",
          codeSnapshot: "class Solution: pass",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        },
      });
      const failedSecondTrace = await appendVerifiedReviewRunTrace(prisma, {
        userId: fixture.user.id,
        problemId: evidenceProblem.id,
        chatSessionId: evidenceSession.id,
        reviewAttemptId: evidenceReview.id,
        content:
          "A second binary-search problem supplied independent mistake evidence.",
        status: "failed",
        executionFingerprint: "memory-context-failed-revision-2",
      });
      const passedSecondTrace = await appendVerifiedReviewRunTrace(prisma, {
        userId: fixture.user.id,
        problemId: evidenceProblem.id,
        chatSessionId: evidenceSession.id,
        reviewAttemptId: evidenceReview.id,
        content:
          "A successful revision on the second problem supplied earned-skill evidence.",
        status: "passed_visible_tests",
        executionFingerprint: "memory-context-passed-revision-2",
      });
      const [secondMistakeArbitration, secondSkillArbitration] =
        await Promise.all([
          arbitrateFactCandidates(prisma, {
            userId: fixture.user.id,
            problemId: evidenceProblem.id,
            source: "review_diagnosis",
            candidates: mapMemoryUpdateCandidateToFactCandidates({
              evidenceTraceIds: [failedSecondTrace.id],
              candidate: { facts: [memoryFacts.facts[0]!] },
            }),
          }),
          arbitrateFactCandidates(prisma, {
            userId: fixture.user.id,
            problemId: evidenceProblem.id,
            source: "review_diagnosis",
            candidates: mapMemoryUpdateCandidateToFactCandidates({
              evidenceTraceIds: [passedSecondTrace.id],
              candidate: { facts: memoryFacts.facts.slice(1) },
            }),
          }),
        ]);
      const secondMemoryArbitration = {
        updated: [
          ...secondMistakeArbitration.updated,
          ...secondSkillArbitration.updated,
        ],
        rejected: [
          ...secondMistakeArbitration.rejected,
          ...secondSkillArbitration.rejected,
        ],
      };
      await createProblemHistory(prisma, fixture, {
        problemId: unrelatedProblem.id,
        problemTags: ["hash-table"],
        coachSummary: "Unrelated hash-table history.",
      });
      await createProblemHistory(prisma, fixture, {
        problemId: fixture.problem.id,
        problemTags: ["array", "binary-search"],
        coachSummary: "Relevant binary-search history.",
      });

      const ftsDir = mkdtempSync(join(tmpdir(), "pc-memory-fts-"));
      tempDirs.push(ftsDir);
      const ftsStore = createFtsStore(join(ftsDir, "fts.db"));
      await reconcileLearnerMemoryRetrievalDocuments(prisma, {
        userId: fixture.user.id,
        ftsStore,
      });
      const profile = {
        displayName: "try",
        preferredLanguages: ["Python"],
        strongPatterns: ["Array traversal"],
        weakPatterns: ["Binary Search boundaries"],
        explanationStyle: [],
        outputPreferences: ["Short answer", "Short answer"],
      };
      const memory = await buildCoachMemoryContext(prisma, {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        problemTags: ["binary-search"],
        queryText: "Search Insert binary search",
        entry: { kind: "review" },
        profile,
        ftsStore,
      });
      const emptyTagMemory = await buildCoachMemoryContext(prisma, {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        problemTags: [],
        queryText: "Search Insert",
        entry: { kind: "review" },
        profile: {
          strongPatterns: [],
          weakPatterns: [],
          outputPreferences: [],
        },
        ftsStore,
      });
      ftsStore.close();

      const durableState = await prisma.l2MemoryFact.findMany({
        where: { userId: fixture.user.id },
        select: {
          factType: true,
          tag: true,
          status: true,
          confidence: true,
          evidenceCount: true,
          memoryOrigin: true,
          validationJson: true,
        },
      });
      const factRejections = await prisma.l1MemoryEvent.findMany({
        where: { userId: fixture.user.id, eventType: "fact_rejected" },
        select: { content: true, eventJson: true },
      });
      expect(factRejections).toEqual([]);
      expect(firstMemoryArbitration.updated).toHaveLength(3);
      expect(
        firstMemoryArbitration.updated.every(
          (fact) => fact.status === "candidate" && fact.evidenceCount === 1,
        ),
      ).toBe(true);
      expect(secondMemoryArbitration.updated).toHaveLength(3);
      expect(
        secondMemoryArbitration.updated.every(
          (fact) => fact.status === "active" && fact.evidenceCount === 2,
        ),
      ).toBe(true);
      expect(durableState).toHaveLength(3);
      expect(
        durableState.every(
          (fact) =>
            fact.status === "active" &&
            fact.evidenceCount === 2 &&
            fact.memoryOrigin === TEST_LEARNER_MEMORY_ORIGIN,
        ),
      ).toBe(true);
      const earnedCandidates = memory.candidates.filter(
        (candidate) => candidate.source === "l2_fact",
      );
      expect(earnedCandidates.map((candidate) => candidate.teachingText)).toEqual(
        expect.arrayContaining([
          "Moves the binary-search boundary past the first valid insertion position.",
          "Traverses arrays consistently without losing the current index.",
          "Explains lower-bound reasoning using a stable search invariant.",
        ]),
      );
      expect(earnedCandidates.map((candidate) => candidate.teachingText).join(" "))
        .not.toMatch(/binary_search_boundary_mistake|array_traversal_strength/);
      expect(memory.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "onboarding_profile",
            truthClass: "self_reported_profile",
            teachingText:
              "The learner described Binary Search boundaries as an area to strengthen.",
          }),
        ]),
      );
      expect(memory.brief.outputPreferences).toEqual(["Short answer"]);
      expect(memory.brief.teachableMemories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "recurring_mistake",
            cue:
              "Moves the binary-search boundary past the first valid insertion position.",
            learnerSignalBasis: "earned_evidence",
          }),
        ]),
      );
      expect(memory.brief.teachableMemories).toHaveLength(2);
      expect(
        new Set(memory.brief.teachableMemories.map((item) => item.kind)).size,
      ).toBe(2);
      expect(JSON.stringify(memory.brief)).not.toContain(
        "Relevant binary-search history.",
      );
      expect(memory.decisions).toContainEqual(
        expect.objectContaining({
          selected: false,
          reason: "same_problem_stale_narrative",
        }),
      );
      expect(JSON.stringify(emptyTagMemory.brief)).not.toContain(
        "Relevant binary-search history.",
      );
    } finally {
      await prisma.$disconnect();
    }
  });

  it("appends an L1 failure trace when fire-and-forget reflection fails", async () => {
    const prisma = await createSeededClient();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const fixture = await createReviewFixture(prisma);
      let scheduledTask: (() => void) | undefined;

      enqueueReflection(
        prisma,
        {
          userId: fixture.user.id,
          problemId: fixture.problem.id,
          reviewAttemptId: fixture.reviewAttempt.id,
          changedFactIds: ["fact_1"],
        },
        {
          schedule(task) {
            scheduledTask = task;
          },
          async run() {
            throw new Error("Qwen is unavailable");
          },
        },
      );

      scheduledTask?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const failureTrace = await prisma.l1MemoryEvent.findFirst({
        where: {
          userId: fixture.user.id,
          eventType: "memory_synthesis_failed",
        },
      });

      expect(failureTrace?.content).toBe("Qwen is unavailable");
      expect(JSON.parse(failureTrace?.eventJson ?? "{}")).toMatchObject({
        changedFactIds: ["fact_1"],
      });
    } finally {
      consoleError.mockRestore();
      await prisma.$disconnect();
    }
  });

  it("schedules reflection without awaiting the background run", () => {
    const prisma = {} as Parameters<typeof runReflection>[0];
    const args: RunReflectionArgs = {
      userId: "user_1",
      problemId: "problem_1",
    };
    let scheduledTask: (() => void) | undefined;
    let started = false;
    let finished = false;
    let finishRun: (() => void) | undefined;
    const runPromise = new Promise<void>((resolve) => {
      finishRun = resolve;
    });

    enqueueReflection(prisma, args, {
      schedule(task) {
        scheduledTask = task;
      },
      async run() {
        started = true;
        await runPromise;
        finished = true;
      },
    });

    expect(started).toBe(false);
    scheduledTask?.();
    expect(started).toBe(true);
    expect(finished).toBe(false);

    finishRun?.();
    return expect(runPromise.then(() => finished)).resolves.toBe(true);
  });
});

async function createSeededClient() {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = TEST_LEARNER_MEMORY_ORIGIN;
  const dir = mkdtempSync(join(tmpdir(), "patterncoach-memory-"));
  tempDirs.push(dir);

  const databasePath = join(dir, "memory.db");
  const db = new Database(databasePath);
  applyPrismaMigrations(db);
  db.close();

  const adapter = new PrismaBetterSqlite3({ url: databasePath });
  const prisma = new PrismaClient({ adapter });
  await seedDatabase(prisma);

  return prisma;
}

async function createReviewFixture(prisma: PrismaClient) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { handle: "try" },
  });
  const problem = await prisma.problem.findUniqueOrThrow({
    where: { slug: "search-insert-position" },
  });
  const codeDraft = await prisma.codeDraft.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      language: "Python",
      content: "class Solution: pass",
    },
  });
  const chatSession = await prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      title: problem.title,
      primaryLanguage: "zh",
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    },
  });
  const reviewAttempt = await prisma.reviewAttempt.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      codeDraftId: codeDraft.id,
      language: "Python",
      codeSnapshot: codeDraft.content,
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    },
  });

  return {
    user,
    problem,
    codeDraft,
    chatSession,
    reviewAttempt,
    traceBase: {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      reviewAttemptId: reviewAttempt.id,
      source: "unit_test",
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    },
  };
}

async function appendVerifiedReviewRunTrace(
  prisma: PrismaClient,
  args: {
    userId: string;
    problemId: string;
    chatSessionId: string;
    reviewAttemptId: string;
    content: string;
    status: "failed" | "passed_visible_tests";
    executionFingerprint: string;
  },
) {
  const reviewAttempt = await prisma.reviewAttempt.findUniqueOrThrow({
    where: { id: args.reviewAttemptId },
    select: { codeSnapshot: true, language: true },
  });
  if (reviewAttempt.language !== "Python") {
    throw new Error("Verified Review test fixtures must use Python.");
  }
  const executionFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code: reviewAttempt.codeSnapshot,
  });
  const failed = args.status === "failed";
  const evidenceVerdict = {
    evidenceClass: "verdict_bearing",
    status: args.status,
    providerUsed: "leetcode",
    capabilities: {
      canVerdict: true,
      canWriteMistakeMemory: failed,
      canWriteEpisode: true,
      canSignalPlanner: true,
      canUseFailureSalience: failed,
    },
  };
  const stored = await prisma.runEvidence.create({
    data: {
      reviewAttemptId: args.reviewAttemptId,
      chatSessionId: args.chatSessionId,
      source: "review",
      executionFingerprint,
      status: args.status,
      rawResultJson: JSON.stringify({ evidenceVerdict }),
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    },
  });
  return appendL1TraceEvent(prisma, {
    userId: args.userId,
    problemId: args.problemId,
    chatSessionId: args.chatSessionId,
    reviewAttemptId: args.reviewAttemptId,
    source: "review_pipeline",
    eventType: "run_evidence",
    content: args.content,
    memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    eventJson: {
      runEvidenceId: stored.id,
      status: args.status,
      executionFingerprint,
      evidenceVerdict,
    },
  });
}

async function createProblemHistory(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof createReviewFixture>>,
  args: {
    problemId: string;
    problemTags: string[];
    coachSummary: string;
  },
) {
  const reviewAttempt = await prisma.reviewAttempt.create({
    data: {
      userId: fixture.user.id,
      problemId: args.problemId,
      chatSessionId: fixture.chatSession.id,
      codeDraftId: fixture.codeDraft.id,
      language: "Python",
      codeSnapshot: fixture.codeDraft.content,
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    },
  });

  return prisma.problemHistory.create({
    data: {
      userId: fixture.user.id,
      problemId: args.problemId,
      reviewAttemptId: reviewAttempt.id,
      chatSessionId: fixture.chatSession.id,
      language: "Python",
      problemTags: JSON.stringify(args.problemTags),
      runStatus: "failed",
      coachSummary: args.coachSummary,
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    },
  });
}
