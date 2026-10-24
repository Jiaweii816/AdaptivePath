import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDatabase } from "../../prisma/seed";
import { applyPrismaMigrations } from "./prisma-test-utils";
import type { CoachReviewInput } from "@/server/agents/coach-agent/coach-agent.types";
import type { CodeRunResult } from "@/types/code-runner";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

const tempDirs: string[] = [];
const originalEnv = {
  CODE_RUNNER_PROVIDER: process.env.CODE_RUNNER_PROVIDER,
  COACH_PROVIDER: process.env.COACH_PROVIDER,
  REFLECTION_PROVIDER: process.env.REFLECTION_PROVIDER,
  PATTERNCOACH_MEMORY_ORIGIN: process.env.PATTERNCOACH_MEMORY_ORIGIN,
  DATABASE_URL: process.env.DATABASE_URL,
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  restoreEnv();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("review pipeline memory persistence", () => {
  it("persists one Review activity cluster, primary Episode, and queued extraction receipt without direct L2", async () => {
    const prisma = await createSeededClient();

    try {
      const { reviewPipeline, enqueueReflection, enqueueChatConsolidation } =
        await loadReviewPipeline(prisma);
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "search-insert-position" },
      });
      const selectedTests = await prisma.problemTestCase.findMany({
        where: { problemId: problem.id, isVisible: true },
        take: 1,
      });

      const result = await reviewPipeline({
        problemId: problem.id,
        language: "Python",
        code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
        selectedTestCaseIds: selectedTests.map((test) => test.id),
        userQuestion: "帮我看看边界",
        responseLanguage: "zh",
      });

      const review = await prisma.reviewAttempt.findUnique({
        where: { id: result.reviewAttemptId },
        include: {
          runEvidences: true,
          diagnosisResult: true,
          problemHistories: true,
          chatMessages: true,
        },
      });
      const trace = await prisma.l1MemoryEvent.findMany({
        where: { reviewAttemptId: result.reviewAttemptId },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
      });
      const l2Facts = await prisma.l2MemoryFact.findMany({
        where: { sourceReviewAttemptId: result.reviewAttemptId },
      });

      expect(review?.runEvidences[0]?.status).toBe("passed_visible_tests");
      expect(review?.runEvidences[0]?.codeHash).toMatch(/^sha256:/);
      expect(review?.runEvidences[0]?.executionFingerprint).toMatch(
        /^execfp:v1:sha256:/,
      );
      expect(review?.diagnosisResult?.userIssueSummary).toBeTruthy();
      expect(review?.problemHistories).toHaveLength(1);
      expect(review?.chatMessages).toHaveLength(1);
      const reviewMessageMetadata = JSON.parse(
        review?.chatMessages[0]?.metadataJson ?? "{}",
      );
      expect(reviewMessageMetadata.workspace).toMatchObject({
        currentCodeHash: review?.runEvidences[0]?.codeHash,
        currentCodeAuthoritativeRunStatus:
          "authoritative_run_matches_current_code",
      });
      expect(trace.map((event) => event.eventType)).toEqual([
        "review_attempt",
        "run_evidence",
        "diagnosis",
        "coach_reply",
      ]);
      expect(result.coachReply).toContain("所选本地可见测试");
      expect(result.coachReply).toContain("不是 LeetCode 官方判定");
      expect(result.coachReply).not.toContain("###");
      expect(l2Facts).toHaveLength(0);
      const cluster = await prisma.memoryActivityCluster.findUniqueOrThrow({
        where: { rootReviewAttemptId: result.reviewAttemptId },
      });
      const episode = await prisma.memoryEpisode.findFirstOrThrow({
        where: { activityClusterId: cluster.id },
      });
      const receipt = await prisma.memoryExtractionReceipt.findUniqueOrThrow({
        where: {
          activityClusterId_extractorVersion: {
            activityClusterId: cluster.id,
            extractorVersion: "activity-memory-v1",
          },
        },
      });
      expect(episode.kind).toBe("review");
      expect(receipt.status).toBe("queued");
      expect(enqueueReflection).not.toHaveBeenCalled();
      expect(enqueueChatConsolidation).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("clusters repeated failed runs, Coach chat, and a passing Review as one evidence unit", async () => {
    const prisma = await createSeededClient();

    try {
      const { reviewPipeline } = await loadReviewPipeline(prisma);
      const user = await prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "search-insert-position" },
      });
      const selectedTests = await prisma.problemTestCase.findMany({
        where: { problemId: problem.id, isVisible: true },
        take: 1,
      });
      const session = await prisma.chatSession.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          title: problem.title,
          memoryOrigin: "learner",
        },
      });
      for (const runOrdinal of [1, 2]) {
        await prisma.practiceRunLog.create({
          data: {
            userId: user.id,
            problemId: problem.id,
            language: "Python",
            codeSnapshot: `# failed revision ${runOrdinal}`,
            codeHash: `failed-${runOrdinal}`,
            executionFingerprint: `failed-fingerprint-${runOrdinal}`,
            runOrdinal,
            selectedTestCaseIds: JSON.stringify(
              selectedTests.map((test) => test.id),
            ),
            status: "failed",
            passedCount: 0,
            totalCount: 1,
            summary: "failed visible test",
            provider: "local_hot150",
          },
        });
      }
      await prisma.chatMessage.createMany({
        data: [
          {
            sessionId: session.id,
            role: "user",
            contentMarkdown: "为什么一直失败？",
            sequence: 1,
            memoryOrigin: "learner",
          },
          {
            sessionId: session.id,
            role: "assistant",
            contentMarkdown: "先检查循环不变量，再修改代码。",
            sequence: 2,
            memoryOrigin: "learner",
          },
        ],
      });

      const result = await reviewPipeline({
        problemId: problem.id,
        language: "Python",
        code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
        selectedTestCaseIds: selectedTests.map((test) => test.id),
        responseLanguage: "zh",
      });
      const cluster = await prisma.memoryActivityCluster.findUniqueOrThrow({
        where: { rootReviewAttemptId: result.reviewAttemptId },
        include: { items: true, episodes: true, extractionReceipts: true },
      });

      expect(result.runResult.status).toBe("passed_visible_tests");
      expect(cluster.items.filter((item) => item.sourceType === "practice_run"))
        .toHaveLength(2);
      expect(cluster.items.filter((item) => item.sourceType === "chat_message"))
        .toHaveLength(3);
      expect(cluster.episodes).toHaveLength(1);
      expect(cluster.extractionReceipts).toHaveLength(1);
      expect(cluster.extractionReceipts[0]?.status).toBe("queued");
      await expect(prisma.memoryActivityCluster.count()).resolves.toBe(1);
      await expect(prisma.memoryEpisode.count()).resolves.toBe(1);
      await expect(prisma.l2MemoryFact.count()).resolves.toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rolls back the review outcome if memory trace persistence fails inside the transaction", async () => {
    const prisma = await createSeededClient();

    try {
      const { reviewPipeline, enqueueReflection } =
        await loadReviewPipeline(prisma, { failTraceAppend: true });
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "search-insert-position" },
      });
      const selectedTests = await prisma.problemTestCase.findMany({
        where: { problemId: problem.id, isVisible: true },
        take: 1,
      });

      await expect(
        reviewPipeline({
          problemId: problem.id,
          language: "Python",
          code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
          selectedTestCaseIds: selectedTests.map((test) => test.id),
          responseLanguage: "zh",
        }),
      ).rejects.toThrow("trace boom");

      await expect(prisma.reviewAttempt.count()).resolves.toBe(0);
      await expect(prisma.runEvidence.count()).resolves.toBe(0);
      await expect(prisma.diagnosisResult.count()).resolves.toBe(0);
      await expect(prisma.problemHistory.count()).resolves.toBe(0);
      await expect(prisma.chatMessage.count()).resolves.toBe(0);
      // This fixture has no browser/workspace TraceContext, so the normalized
      // runtime event titled "Coach memory assembly" is intentionally absent.
      // The retired retrieval_trace L1 contract must not be recreated just to
      // survive the rolled-back Review write transaction.
      const legacyRetrievalTrace = await loadFormalTraceProjection(prisma, {
        eventTypes: ["retrieval_trace"],
      });
      expect(legacyRetrievalTrace).toEqual([]);
      await expect(prisma.l2MemoryFact.count()).resolves.toBe(0);
      await expect(prisma.memoryEpisode.count()).resolves.toBe(0);
      await expect(prisma.memoryActivityCluster.count()).resolves.toBe(0);
      await expect(prisma.memoryExtractionReceipt.count()).resolves.toBe(0);
      expect(enqueueReflection).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("persists run evidence and degraded reply when the review provider throws", async () => {
    const prisma = await createSeededClient();

    try {
      const { reviewPipeline, enqueueReflection } =
        await loadReviewPipeline(prisma, { providerThrows: true });
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "search-insert-position" },
      });
      const selectedTests = await prisma.problemTestCase.findMany({
        where: { problemId: problem.id, isVisible: true },
        take: 1,
      });

      const result = await reviewPipeline({
        problemId: problem.id,
        language: "Python",
        code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
        selectedTestCaseIds: selectedTests.map((test) => test.id),
        responseLanguage: "zh",
      });

      expect(result.ok).toBe(true);
      expect(result.degraded?.tier).toBe(3);
      expect(result.degraded?.memorySkipped).toBe(true);
      expect(result.runResult.status).toBe("passed_visible_tests");
      expect(result.coachReply).toContain("教练模型这次不可用");
      expect(result.coachReply).not.toContain("###");

      const review = await prisma.reviewAttempt.findUnique({
        where: { id: result.reviewAttemptId },
        include: {
          runEvidences: true,
          diagnosisResult: true,
          chatMessages: true,
        },
      });
      const l2Facts = await prisma.l2MemoryFact.findMany({
        where: { sourceReviewAttemptId: result.reviewAttemptId },
      });
      const trace = await prisma.l1MemoryEvent.findMany({
        where: { reviewAttemptId: result.reviewAttemptId },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
      });

      expect(review?.runEvidences[0]?.rawResultJson).toContain(
        "passed_visible_tests",
      );
      expect(review?.diagnosisResult?.memoryUpdateCandidateJson).toContain(
        "No strength/skill candidate",
      );
      expect(review?.chatMessages[0]?.metadataJson).toContain('"tier":3');
      expect(trace.map((event) => event.eventType)).toEqual([
        "review_attempt",
        "run_evidence",
        "diagnosis",
        "coach_reply",
      ]);
      expect(l2Facts).toHaveLength(0);
      expect(enqueueReflection).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("stores null self-check fields when diagnosis self-check contains banned residue", async () => {
    const prisma = await createSeededClient();

    try {
      const failedRun: CodeRunResult = {
        status: "failed",
        failureProvenance: "user_code",
        passedCount: 0,
        failedCount: 1,
        stdout: "",
        stderr: "",
        actualOutput: "2",
        expectedOutput: "1",
        firstFailedCase: {
          id: "case-1",
          label: "sample",
          input: { nums: [1, 3, 5, 6], target: 2 },
          expected: 1,
          actual: 2,
        },
        testResults: [],
        rawResult: { providerUsed: "local_hot150" },
      };
      const coachReview = vi.fn(async (input: CoachReviewInput) => {
        // Review now loads real learner memory through the Coach facade
        // (spec 2026-07-14-unified-coach-memory-retrieval §6.2): the seeded
        // try onboarding profile must reach the review LLM input instead of
        // the empty object the pipeline used to hand over.
        expect(input.memory.outputPreferences.length).toBeGreaterThan(0);
        expect(input.memory.teachableMemories.length).toBeLessThanOrEqual(2);
        expect(
          input.memory.teachableMemories.every(
            (memory) =>
              memory.learnerSignalBasis === "self_reported" ||
              memory.learnerSignalBasis === "earned_evidence" ||
              memory.learnerSignalBasis === "saved_by_learner",
          ),
        ).toBe(true);
        expect(input.memory).not.toHaveProperty("strengths");
        expect(input.memory).not.toHaveProperty("weaknesses");
        expect(input.sessionPlan).toBeUndefined();

        return {
          diagnosis: {
            problemSlug: "search-insert-position",
            runStatus: "failed",
            userIssueSummary: "Visible case failed.",
            coachSummary: "Use the first >= target boundary.",
            mistakeTags: ["binary_search_boundary_mistake"],
            skillTags: ["binary-search"],
            selfCheck: {
              question:
                "遇到 Wrong Answer: expected [1], actual [2] 时检查什么？",
              answer:
                "Evidence-only review generated because the coach model did not return usable structured JSON.",
            },
            memoryUpdateCandidate: { facts: [], summary: "No facts." },
          },
          coachReply:
            "根因:插入位置返回偏右。\n最小改法:把它看成找第一个 >= target 的位置,循环结束 return left。\n如果你愿意，我可以在 Chat 里带你走一遍这个失败用例。",
        };
      });
      const { reviewPipeline, runCodeWithTests } = await loadReviewPipeline(
        prisma,
        {
          coachReview,
          runResults: [failedRun],
        },
      );
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "search-insert-position" },
      });
      const selectedTests = await prisma.problemTestCase.findMany({
        where: { problemId: problem.id, isVisible: true },
        take: 1,
      });

      const result = await reviewPipeline({
        problemId: problem.id,
        language: "Python",
        code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 2",
        selectedTestCaseIds: selectedTests.map((test) => test.id),
        responseLanguage: "zh",
      });

      const review = await prisma.reviewAttempt.findUniqueOrThrow({
        where: { id: result.reviewAttemptId },
        include: { diagnosisResult: true },
      });
      const storedDiagnosis = JSON.parse(
        review.diagnosisResult?.diagnosisJson ?? "{}",
      ) as { selfCheck?: unknown };

      expect(runCodeWithTests).toHaveBeenCalledTimes(1);
      expect(coachReview).toHaveBeenCalledTimes(1);
      expect(result.diagnosis.selfCheck).toBeNull();
      expect(review.diagnosisResult?.selfCheckQuestion).toBeNull();
      expect(review.diagnosisResult?.selfCheckAnswer).toBeNull();
      expect(storedDiagnosis.selfCheck).toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("short-circuits unavailable runner evidence but still seals the auditable Review activity", async () => {
    const prisma = await createSeededClient();

    try {
      const coachReview = vi.fn();
      const runnerError: CodeRunResult = {
        status: "runner_error",
        failureProvenance: "network",
        passedCount: 0,
        failedCount: 0,
        stdout: "",
        stderr: "ECONNRESET",
        testResults: [],
        rawResult: { providerUsed: "mock" },
      };
      const { reviewPipeline, enqueueReflection, runCodeWithTests } =
        await loadReviewPipeline(prisma, {
          coachReview,
          runResults: [runnerError],
        });
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "search-insert-position" },
      });
      const selectedTests = await prisma.problemTestCase.findMany({
        where: { problemId: problem.id, isVisible: true },
        take: 1,
      });

      const result = await reviewPipeline({
        problemId: problem.id,
        language: "Python",
        code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
        selectedTestCaseIds: selectedTests.map((test) => test.id),
        responseLanguage: "zh",
      });

      const review = await prisma.reviewAttempt.findUniqueOrThrow({
        where: { id: result.reviewAttemptId },
        include: {
          runEvidences: true,
          diagnosisResult: true,
          problemHistories: true,
        },
      });
      const rawResult = JSON.parse(review.runEvidences[0]?.rawResultJson ?? "{}");

      expect(runCodeWithTests).toHaveBeenCalledTimes(1);
      expect(coachReview).not.toHaveBeenCalled();
      expect(result.evidence.evidenceVerdict?.evidenceClass).toBe(
        "evidence_unavailable",
      );
      expect(result.degraded?.memorySkipped).toBe(true);
      expect(result.coachReply).toContain("不能判断");
      expect(result.coachReply).not.toContain("###");
      expect(review.runEvidences[0]?.status).toBe("runner_error");
      expect(rawResult.rawResult.evidenceVerdict.evidenceClass).toBe(
        "evidence_unavailable",
      );
      expect(review.diagnosisResult?.mistakeTags).toBe("[]");
      expect(review.problemHistories[0]?.failedCaseSummary).toBe(
        "execution evidence unavailable",
      );
      await expect(
        prisma.l2MemoryFact.count({
          where: { sourceReviewAttemptId: result.reviewAttemptId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.memoryEpisode.count(),
      ).resolves.toBe(0);
      await expect(prisma.memoryActivityCluster.count()).resolves.toBe(1);
      await expect(prisma.memoryExtractionReceipt.count()).resolves.toBe(1);
      expect(enqueueReflection).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("runs a non-demo runnable Hot-150 Python Review through the local evidence contract", async () => {
    const prisma = await createSeededClient();

    try {
      const problem = await prisma.problem.findFirstOrThrow({
        where: {
          isDemoSupported: false,
          localRunStatus: "runnable",
          testCases: { some: { isVisible: true } },
        },
      });
      const selectedTest = await prisma.problemTestCase.findFirstOrThrow({
        where: { problemId: problem.id, isVisible: true },
      });
      const localRun: CodeRunResult = {
        status: "failed",
        failureProvenance: "user_code",
        passedCount: 0,
        failedCount: 1,
        stdout: "",
        stderr: "",
        actualOutput: "local-actual",
        expectedOutput: "local-expected",
        firstFailedCase: {
          id: selectedTest.id,
          label: selectedTest.label,
          input: JSON.parse(selectedTest.inputJson),
          expected: JSON.parse(selectedTest.expectedJson),
          actual: "local-actual",
        },
        testResults: [],
        rawResult: { providerUsed: "local_hot150" },
      };
      const coachReview = vi.fn(async (input: CoachReviewInput) => {
        expect(input.problem.slug).toBe(problem.slug);
        expect(input.language).toBe("Python");
        expect(input.runResult).toMatchObject({
          status: "failed",
          actualOutput: "local-actual",
          expectedOutput: "local-expected",
        });
        expect(input.evidenceVerdict).toMatchObject({
          evidenceClass: "local_only",
          capabilities: {
            canVerdict: true,
            canWriteMistakeMemory: true,
            canWriteEpisode: true,
          },
        });

        return {
          diagnosis: {
            problemSlug: problem.slug,
            runStatus: "failed",
            userIssueSummary:
              "The selected local visible case produced a different output.",
            coachSummary: "Trace the first differing state in this visible case.",
            mistakeTags: [],
            skillTags: JSON.parse(problem.tags),
            selfCheck: null,
            memoryUpdateCandidate: {
              facts: [],
              summary: "No durable mechanism candidate from this fixture.",
            },
          },
          coachReply:
            "所选本地可见用例的实际输出与预期不同。这不是 LeetCode 官方判定。先定位第一个跑偏的状态，再重跑同一用例。",
        };
      });
      const { reviewPipeline, enqueueReflection, runCodeWithTests } =
        await loadReviewPipeline(prisma, {
          coachReview,
          runResults: [localRun],
        });

      const result = await reviewPipeline({
        problemId: problem.id,
        language: "Python",
        code: `class Solution:\n    def ${problem.methodName}(self, *args):\n        return None`,
        selectedTestCaseIds: [selectedTest.id],
        responseLanguage: "zh",
      });

      expect(runCodeWithTests).toHaveBeenCalledTimes(1);
      expect(coachReview).toHaveBeenCalledTimes(1);
      expect(result.problem.slug).toBe(problem.slug);
      expect(result.evidence.evidenceVerdict).toMatchObject({
        evidenceClass: "local_only",
        providerUsed: "local_hot150",
      });
      expect(result.coachReply).toContain("本地可见");
      const episode = await prisma.memoryEpisode.findFirstOrThrow({
        where: { userId: (await prisma.user.findUniqueOrThrow({ where: { handle: "try" } })).id },
      });
      expect(episode.problemId).toBe(problem.id);
      expect(episode.summary).toContain("selected local visible tests only");
      expect(episode.activityClusterId).not.toBeNull();
      expect(enqueueReflection).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("uses static Review when remote LeetCode is unavailable and does not run local fallback", async () => {
    const prisma = await createSeededClient();

    try {
      const primaryUnavailable: CodeRunResult = {
        status: "runner_error",
        failureProvenance: "judge_service",
        passedCount: 0,
        failedCount: 0,
        stdout: "",
        stderr: "LeetCode unavailable",
        testResults: [],
        rawResult: { providerUsed: "lc_submit" },
      };
      const unusedLocalFailed: CodeRunResult = {
        status: "failed",
        failureProvenance: "user_code",
        passedCount: 0,
        failedCount: 1,
        stdout: "",
        stderr: "",
        actualOutput: "0",
        expectedOutput: "2",
        firstFailedCase: {
          id: "case-1",
          label: "sample",
          input: { nums: [1, 3], target: 2 },
          expected: 2,
          actual: 0,
        },
        testResults: [],
        rawResult: { providerUsed: "piston_fallback" },
      };
      const coachReview = vi.fn(async (input: CoachReviewInput) => {
        expect(input.evidenceVerdict).toMatchObject({
          evidenceClass: "evidence_unavailable",
          providerUsed: "lc_submit",
          status: "runner_error",
        });
        return {
        diagnosis: {
          problemSlug: "search-insert-position",
          runStatus: "runner_error",
          userIssueSummary: "Remote LeetCode evidence was unavailable.",
          coachSummary: "Static review: the boundary return deserves manual verification.",
          mistakeTags: [],
          skillTags: ["binary-search"],
          selfCheck: null,
          memoryUpdateCandidate: {
            facts: [],
            summary: "Static remote-unavailable review does not write evidence facts.",
          },
        },
        coachReply:
          "远程 LeetCode 评测暂时不可用，当前为静态代码审查，并非官方判定结果。建议您点击左侧 LeetCode 链接提交代码以获取官方正式评测。\n\n静态看，这段代码需要重点确认循环结束后返回的边界是否等于第一个大于等于 target 的位置；建议手动验证 target 落在两个数之间和 target 大于所有元素的用例。",
        };
      });
      const { reviewPipeline, enqueueReflection, runCodeWithTests } =
        await loadReviewPipeline(prisma, {
          coachReview,
          runResults: [primaryUnavailable, unusedLocalFailed],
        });
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "search-insert-position" },
      });
      const selectedTests = await prisma.problemTestCase.findMany({
        where: { problemId: problem.id, isVisible: true },
        take: 1,
      });

      const result = await reviewPipeline({
        problemId: problem.id,
        language: "Python",
        code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
        selectedTestCaseIds: selectedTests.map((test) => test.id),
        responseLanguage: "zh",
      });

      const review = await prisma.reviewAttempt.findUniqueOrThrow({
        where: { id: result.reviewAttemptId },
        include: { runEvidences: true, diagnosisResult: true, problemHistories: true },
      });

      expect(runCodeWithTests).toHaveBeenCalledTimes(1);
      expect(coachReview).toHaveBeenCalledTimes(1);
      expect(result.runResult.status).toBe("runner_error");
      expect(result.evidence.evidenceVerdict?.evidenceClass).toBe(
        "evidence_unavailable",
      );
      expect(result.evidence.evidenceVerdict?.providerUsed).toBe("lc_submit");
      expect(result.evidence.evidenceSource).toContain("LeetCode judge evidence");
      expect(result.coachReply).toContain("远程 LeetCode 评测暂时不可用");
      expect(result.coachReply).toContain("静态代码审查");
      expect(result.coachReply).not.toContain("所选本地可见测试");
      expect(result.diagnosis.mistakeTags).toEqual([]);
      expect(result.diagnosis.memoryUpdateCandidate.facts).toHaveLength(0);
      expect(result.degraded?.memorySkipped).toBe(true);
      expect(review.runEvidences[0]?.rawResultJson).not.toContain(
        "remote_unavailable_local_fallback",
      );
      expect(review.diagnosisResult?.mistakeTags).toBe("[]");
      expect(review.diagnosisResult?.selfCheckQuestion).toBeNull();
      expect(review.diagnosisResult?.selfCheckAnswer).toBeNull();
      expect(review.problemHistories[0]?.nextRecommendation).toContain(
        "Retry Review My Code after execution evidence is available",
      );
      await expect(
        prisma.l2MemoryFact.count({
          where: { sourceReviewAttemptId: result.reviewAttemptId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.memoryEpisode.count(),
      ).resolves.toBe(0);
      await expect(prisma.memoryActivityCluster.count()).resolves.toBe(1);
      await expect(prisma.memoryExtractionReceipt.count()).resolves.toBe(1);
      expect(enqueueReflection).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("ignores local passing fallback fixtures when remote LeetCode is unavailable", async () => {
    const prisma = await createSeededClient();

    try {
      const primaryUnavailable: CodeRunResult = {
        status: "runner_error",
        failureProvenance: "judge_service",
        passedCount: 0,
        failedCount: 0,
        stdout: "",
        stderr: "LeetCode unavailable",
        testResults: [],
        rawResult: { providerUsed: "lc_submit" },
      };
      const unusedLocalPassed: CodeRunResult = {
        status: "passed_visible_tests",
        failureProvenance: "user_code",
        passedCount: 1,
        failedCount: 0,
        stdout: "",
        stderr: "",
        durationMs: 9,
        testResults: [],
        rawResult: { providerUsed: "piston_fallback" },
      };
      const coachReview = vi.fn(async (input: CoachReviewInput) => {
        expect(input.evidenceVerdict).toMatchObject({
          evidenceClass: "evidence_unavailable",
          providerUsed: "lc_submit",
          status: "runner_error",
        });
        return {
          diagnosis: {
            problemSlug: "search-insert-position",
            runStatus: "runner_error",
            userIssueSummary: "Remote LeetCode evidence was unavailable.",
            coachSummary: "Static review only.",
            mistakeTags: [],
            skillTags: ["binary-search"],
            selfCheck: null,
            memoryUpdateCandidate: {
              facts: [],
              summary: "No execution-backed memory facts.",
            },
          },
          coachReply:
            "远程 LeetCode 评测暂时不可用，当前为静态代码审查，并非官方判定结果。建议您点击左侧 LeetCode 链接提交代码以获取官方正式评测。\n\n静态看，这段代码的二分边界写法需要用插入到中间和末尾的用例手动核对。",
        };
      });
      const { reviewPipeline, enqueueReflection, runCodeWithTests } =
        await loadReviewPipeline(prisma, {
          coachReview,
          runResults: [primaryUnavailable, unusedLocalPassed],
        });
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: "search-insert-position" },
      });
      const selectedTests = await prisma.problemTestCase.findMany({
        where: { problemId: problem.id, isVisible: true },
        take: 1,
      });

      const result = await reviewPipeline({
        problemId: problem.id,
        language: "Python",
        code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
        selectedTestCaseIds: selectedTests.map((test) => test.id),
        responseLanguage: "zh",
      });
      const review = await prisma.reviewAttempt.findUniqueOrThrow({
        where: { id: result.reviewAttemptId },
        include: { runEvidences: true, diagnosisResult: true },
      });

      expect(runCodeWithTests).toHaveBeenCalledTimes(1);
      expect(coachReview).toHaveBeenCalledTimes(1);
      expect(coachReview.mock.calls[0]?.[0].evidenceVerdict).toMatchObject({
        evidenceClass: "evidence_unavailable",
        status: "runner_error",
      });
      expect(result.runResult.status).toBe("runner_error");
      expect(result.evidence.evidenceVerdict?.evidenceClass).toBe(
        "evidence_unavailable",
      );
      expect(result.coachReply).toContain("远程 LeetCode 评测暂时不可用");
      expect(result.coachReply).toContain("静态代码审查");
      expect(result.coachReply).not.toContain("所选本地可见测试");
      expect(result.coachReply).not.toContain("###");
      expect(result.diagnosis.mistakeTags).toEqual([]);
      expect(result.diagnosis.memoryUpdateCandidate.facts).toEqual([]);
      expect(result.degraded?.memorySkipped).toBe(true);
      expect(review.runEvidences[0]?.rawResultJson).not.toContain(
        "remote_unavailable_local_fallback",
      );
      expect(review.diagnosisResult?.mistakeTags).toBe("[]");
      await expect(
        prisma.l2MemoryFact.count({
          where: { sourceReviewAttemptId: result.reviewAttemptId },
        }),
      ).resolves.toBe(0);
      await expect(prisma.memoryEpisode.count()).resolves.toBe(0);
      await expect(prisma.memoryActivityCluster.count()).resolves.toBe(1);
      await expect(prisma.memoryExtractionReceipt.count()).resolves.toBe(1);
      expect(enqueueReflection).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("queues two independent Review clusters without foreground L2 promotion", async () => {
    const prisma = await createSeededClient();

    try {
      const localPassed: CodeRunResult = {
        status: "passed_visible_tests",
        failureProvenance: "user_code",
        passedCount: 1,
        failedCount: 0,
        stdout: "",
        stderr: "",
        testResults: [],
        rawResult: { providerUsed: "local_hot150" },
      };
      const coachReview = vi.fn(async (input: CoachReviewInput) => ({
        diagnosis: {
          problemSlug: input.problem.slug,
          runStatus: "passed_visible_tests" as const,
          userIssueSummary:
            "The learner revision passed the selected local visible tests.",
          coachSummary:
            "The interval invariant stayed consistent on the selected visible cases.",
          mistakeTags: [],
          skillTags: ["binary-search"],
          selfCheck: null,
          memoryUpdateCandidate: {
            facts: [
              {
                factType: "strength",
                tag: "binary_search_boundary",
                label: "Preserves the binary-search interval invariant",
                confidence: 0.7,
                evidenceSummary:
                  "The learner revision preserved the interval invariant across the selected local visible tests.",
              },
            ],
            summary: "Evidence-scoped binary-search strength proposal.",
          },
        },
        coachReply:
          "The selected local visible tests passed; this is not an official hidden-test verdict.",
      }));
      const { reviewPipeline } = await loadReviewPipeline(prisma, {
        coachReview,
        runResults: [localPassed, localPassed],
      });
      const problems = await prisma.problem.findMany({
        where: {
          slug: {
            in: ["search-insert-position", "search-in-rotated-sorted-array"],
          },
        },
        include: { testCases: { where: { isVisible: true }, take: 1 } },
        orderBy: { slug: "asc" },
      });
      expect(problems).toHaveLength(2);

      for (const [index, problem] of problems.entries()) {
        await reviewPipeline({
          problemId: problem.id,
          language: "Python",
          code: `class Solution:\n    def solve(self, values, target):\n        marker = ${index}\n        return marker`,
          selectedTestCaseIds: problem.testCases.map((test) => test.id),
          responseLanguage: "en",
        });

        await expect(prisma.l2MemoryFact.count()).resolves.toBe(0);
        await expect(prisma.memoryActivityCluster.count()).resolves.toBe(
          index + 1,
        );
        await expect(prisma.memoryExtractionReceipt.count()).resolves.toBe(
          index + 1,
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function createSeededClient() {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
  const dir = mkdtempSync(join(tmpdir(), "patterncoach-review-memory-"));
  tempDirs.push(dir);

  const databasePath = join(dir, "review-memory.db");
  process.env.DATABASE_URL = `file:${databasePath}`;
  const db = new Database(databasePath);
  applyPrismaMigrations(db);
  db.close();

  const adapter = new PrismaBetterSqlite3({ url: databasePath });
  const prisma = new PrismaClient({ adapter });
  await seedDatabase(prisma);

  return prisma;
}

async function loadReviewPipeline(
  prisma: PrismaClient,
  options: {
    coachReview?: ReturnType<typeof vi.fn>;
    failTraceAppend?: boolean;
    providerThrows?: boolean;
    runResults?: CodeRunResult[];
  } = {},
) {
  process.env.CODE_RUNNER_PROVIDER = "mock";
  process.env.COACH_PROVIDER = "mock";
  process.env.REFLECTION_PROVIDER = "mock";
  const enqueueReflection = vi.fn();
  const enqueueChatConsolidation = vi.fn();
  const enqueueEmbedBackfill = vi.fn();
  const runCodeWithTests = options.runResults
    ? vi.fn()
    : undefined;

  if (runCodeWithTests && options.runResults) {
    for (const result of options.runResults) {
      runCodeWithTests.mockResolvedValueOnce(result);
    }
    runCodeWithTests.mockResolvedValue(options.runResults.at(-1));
  }

  vi.resetModules();
  vi.doMock("@/server/db/prisma", () => ({
    default: prisma,
    prisma,
  }));
  vi.doMock("@/server/jobs/enqueue-reflection", () => ({
    enqueueReflection,
  }));
  vi.doMock("@/server/jobs/enqueue-chat-consolidation", () => ({
    enqueueChatConsolidation,
  }));
  vi.doMock("@/server/jobs/enqueue-embed-backfill", () => ({
    enqueueEmbedBackfill,
  }));

  if (runCodeWithTests) {
    vi.doMock("@/server/tools/code-runner/run-code-with-tests", async () => {
      const actual = await vi.importActual<
        typeof import("@/server/tools/code-runner/run-code-with-tests")
      >("@/server/tools/code-runner/run-code-with-tests");

      return {
        ...actual,
        runCodeWithTests,
      };
    });
  } else {
    vi.doUnmock("@/server/tools/code-runner/run-code-with-tests");
  }

  if (options.providerThrows || options.coachReview) {
    const review = options.providerThrows
      ? vi.fn().mockRejectedValue(new Error("provider boom"))
      : options.coachReview;

    vi.doMock("@/server/agents/coach-agent/coach-provider", () => ({
      getCoachProvider: () => ({
        review,
        chat: vi.fn(),
      }),
    }));
  } else {
    vi.doUnmock("@/server/agents/coach-agent/coach-provider");
  }

  if (options.failTraceAppend) {
    vi.doMock("@/server/memory/l1-trace/append-trace", async () => {
      const actual = await vi.importActual<
        typeof import("@/server/memory/l1-trace/append-trace")
      >("@/server/memory/l1-trace/append-trace");

      return {
        ...actual,
        appendL1TraceEvents: vi
          .fn()
          .mockRejectedValue(new Error("trace boom")),
      };
    });
  } else {
    vi.doUnmock("@/server/memory/l1-trace/append-trace");
  }

  const reviewPipelineModule = await import(
    "@/server/agents/coach-agent/review-pipeline"
  );
  const { createMockCodeRunnerProvider } = await import(
    "@/server/tools/code-runner/mock-runner"
  );
  const deterministicFixtureProvider = createMockCodeRunnerProvider();
  const simulatedLocalProvider = {
    run: async (
      input: Parameters<typeof deterministicFixtureProvider.run>[0],
    ) => {
      const result = await deterministicFixtureProvider.run(input);
      return {
        ...result,
        rawResult: {
          ...(result.rawResult &&
          typeof result.rawResult === "object" &&
          !Array.isArray(result.rawResult)
            ? result.rawResult
            : {}),
          providerUsed: "local_hot150",
          unitFixture: true,
        },
      };
    },
  };

  return {
    reviewPipeline: (
      rawInput: unknown,
      deps?: Parameters<typeof reviewPipelineModule.reviewPipeline>[1],
    ) =>
      reviewPipelineModule.reviewPipeline(
        {
          ...(rawInput as Record<string, unknown>),
          browserInstanceId: "unit-review-memory-tab",
          clientOccurredAt: "2026-07-12T18:00:00.000Z",
        },
        {
          // This foreground-persistence suite removes its SQLite fixture as
          // soon as each assertion finishes. Activity extraction is covered
          // in its own worker tests, so prevent fire-and-forget work from
          // racing that cleanup here.
          backgroundJobsPolicy: "disabled",
          ...deps,
          codeRunnerProvider:
            deps?.codeRunnerProvider ??
            (options.runResults ? undefined : simulatedLocalProvider),
        },
      ),
    enqueueReflection,
    enqueueChatConsolidation,
    runCodeWithTests,
  };
}

function restoreEnv() {
  restoreEnvValue("CODE_RUNNER_PROVIDER", originalEnv.CODE_RUNNER_PROVIDER);
  restoreEnvValue("COACH_PROVIDER", originalEnv.COACH_PROVIDER);
  restoreEnvValue(
    "REFLECTION_PROVIDER",
    originalEnv.REFLECTION_PROVIDER,
  );
  restoreEnvValue(
    "PATTERNCOACH_MEMORY_ORIGIN",
    originalEnv.PATTERNCOACH_MEMORY_ORIGIN,
  );
  restoreEnvValue("DATABASE_URL", originalEnv.DATABASE_URL);
}

function restoreEnvValue(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
