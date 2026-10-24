import { describe, expect, it } from "vitest";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
  hashSelectedTestSuite,
} from "@/server/code/code-hash";
import {
  resolveAuthoritativeRunContext,
  resolveWorkingRunContext,
  toCoachRunEvidenceView,
} from "@/server/agents/coach-agent/authoritative-run-context";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  TEST_LEARNER_MEMORY_ORIGIN,
} from "./memory-test-helpers";
import type { CodeRunResult } from "@/types/code-runner";

describe("resolveAuthoritativeRunContext", () => {
  it("ignores every Chat run source even when those rows are newer", async () => {
    const db = await createMemoryTestDb();

    try {
      const fixture = await createResolverFixture(db.prisma);
      await db.prisma.practiceRunLog.create({
        data: {
          userId: fixture.user.id,
          problemId: fixture.problem.id,
          codeDraftId: fixture.codeDraft.id,
          language: "Python",
          codeHash: fixture.codeHash,
          executionFingerprint: fixture.executionFingerprint,
          runOrdinal: 1,
          status: "timeout",
          passedCount: 0,
          totalCount: 3,
          summary: "0/3 selected tests; timeout",
          provider: "local_hot150",
          rawResultJson: JSON.stringify(timeoutResult()),
          createdAt: new Date("2026-07-10T10:00:00.000Z"),
        },
      });
      await db.prisma.runEvidence.createMany({
        data: ["chat_current_tool", "chat_candidate_tool", "chat_tool"].map(
          (source, index) => ({
            chatSessionId: fixture.chatSession.id,
            source,
            memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
            codeHash: fixture.codeHash,
            status: "passed_visible_tests",
            passedCount: 1,
            failedCount: 0,
            rawResultJson: JSON.stringify(passedOneResult()),
            createdAt: new Date(`2026-07-10T10:0${index + 1}:00.000Z`),
          }),
        ),
      });

      const selected = await resolveAuthoritativeRunContext(
        { chatSessionId: fixture.chatSession.id },
        db.prisma,
      );

      expect(selected).toMatchObject({
        storageSource: "practice_run",
        producer: "user_action",
        subject: "current_user_code",
        authority: "authoritative",
        scope: { kind: "selected_suite", totalCount: 3 },
        oracle: "stored_expected",
        executionFingerprint: fixture.executionFingerprint,
        result: {
          status: "timeout",
          passedCount: 0,
        },
      });
      expect(JSON.stringify(selected)).not.toContain("chat_current_tool");
      expect(JSON.stringify(selected)).not.toContain("chat_candidate_tool");
      expect(JSON.stringify(selected)).not.toContain('"source":"chat_tool"');
      const modelView = toCoachRunEvidenceView(selected!);
      expect(modelView).toMatchObject({
        source: "practice_run",
        authority: "authoritative",
        scope: { kind: "selected_suite", totalCount: 3 },
        status: "timeout",
      });
      expectNoModelHashLeak(modelView);
    } finally {
      await db.cleanup();
    }
  });

  it("chooses the newest allowed source between Practice Run and Review", async () => {
    const db = await createMemoryTestDb();

    try {
      const fixture = await createResolverFixture(db.prisma);
      await db.prisma.runEvidence.create({
        data: {
          reviewAttemptId: fixture.reviewAttempt.id,
          chatSessionId: fixture.chatSession.id,
          source: "review",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          codeHash: fixture.codeHash,
          executionFingerprint: fixture.executionFingerprint,
          status: "failed",
          passedCount: 0,
          failedCount: 1,
          rawResultJson: JSON.stringify(failedResult()),
          createdAt: new Date("2026-07-10T10:00:00.000Z"),
        },
      });
      await db.prisma.practiceRunLog.create({
        data: {
          userId: fixture.user.id,
          problemId: fixture.problem.id,
          codeDraftId: fixture.codeDraft.id,
          language: "Python",
          codeHash: fixture.codeHash,
          executionFingerprint: fixture.executionFingerprint,
          runOrdinal: 1,
          status: "timeout",
          passedCount: 0,
          totalCount: 3,
          summary: "0/3 selected tests; timeout",
          provider: "local_hot150",
          rawResultJson: JSON.stringify(timeoutResult()),
          createdAt: new Date("2026-07-10T10:01:00.000Z"),
        },
      });

      await expect(
        resolveAuthoritativeRunContext(
          { chatSessionId: fixture.chatSession.id },
          db.prisma,
        ),
      ).resolves.toMatchObject({ storageSource: "practice_run" });

      await db.prisma.runEvidence.create({
        data: {
          reviewAttemptId: fixture.reviewAttempt.id,
          chatSessionId: fixture.chatSession.id,
          source: "review",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          codeHash: fixture.codeHash,
          executionFingerprint: fixture.executionFingerprint,
          status: "passed_visible_tests",
          passedCount: 3,
          failedCount: 0,
          rawResultJson: JSON.stringify({
            ...passedOneResult(),
            passedCount: 3,
          }),
          createdAt: new Date("2026-07-10T10:02:00.000Z"),
        },
      });

      await expect(
        resolveAuthoritativeRunContext(
          { chatSessionId: fixture.chatSession.id },
          db.prisma,
        ),
      ).resolves.toMatchObject({
        storageSource: "review",
        authority: "authoritative",
        result: { status: "passed_visible_tests", passedCount: 3 },
      });
    } finally {
      await db.cleanup();
    }
  });

  it("prefers an older run that matches the current revision", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await createResolverFixture(db.prisma);
      await db.prisma.practiceRunLog.createMany({ data: [
        practiceRunData(fixture, failedResult(), fixture.codeHash, fixture.executionFingerprint, "2026-07-10T10:00:00.000Z"),
        practiceRunData(fixture, timeoutResult(), "sha256:other", "execfp:v1:sha256:other", "2026-07-10T11:00:00.000Z"),
      ] });
      const selected = await resolveAuthoritativeRunContext({
        chatSessionId: fixture.chatSession.id,
        currentScope: { codeHash: fixture.codeHash, executionFingerprint: fixture.executionFingerprint, suiteFingerprint: hashSelectedTestSuite(["case-1"]) },
      }, db.prisma);
      expect(selected?.result.status).toBe("failed");
    } finally { await db.cleanup(); }
  });
});

describe("resolveWorkingRunContext", () => {
  it("resumes matching learner-code tool evidence but excludes candidate code", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await createResolverFixture(db.prisma);
      const suiteFingerprint = hashSelectedTestSuite(["case-1"]);
      await db.prisma.runEvidence.createMany({ data: [
        { chatSessionId: fixture.chatSession.id, source: "chat_current_tool", memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN, codeHash: fixture.codeHash, executionFingerprint: fixture.executionFingerprint, status: "timeout", passedCount: 0, failedCount: 1, rawResultJson: chatToolRunResult(timeoutResult(), suiteFingerprint) },
        { chatSessionId: fixture.chatSession.id, source: "chat_candidate_tool", memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN, codeHash: "sha256:candidate", executionFingerprint: "execfp:v1:sha256:candidate", status: "passed_visible_tests", passedCount: 1, failedCount: 0, rawResultJson: JSON.stringify(passedOneResult()) },
      ] });
      const result = await resolveWorkingRunContext({ chatSessionId: fixture.chatSession.id, currentScope: { codeHash: fixture.codeHash, executionFingerprint: fixture.executionFingerprint, suiteFingerprint } }, db.prisma);
      expect(result).toMatchObject({ alignment: "exact", evidence: { storageSource: "chat_current_tool", authority: "advisory", suiteFingerprint } });
    } finally { await db.cleanup(); }
  });

  it("returns stale visible working evidence when its code no longer matches", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await createResolverFixture(db.prisma);
      const suiteFingerprint = hashSelectedTestSuite(["case-1"]);
      const stale = await db.prisma.runEvidence.create({
        data: {
          chatSessionId: fixture.chatSession.id,
          source: "chat_current_tool",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          codeHash: "sha256:older-code",
          executionFingerprint: "execfp:v1:sha256:older-code",
          status: "timeout",
          passedCount: 0,
          failedCount: 1,
          rawResultJson: chatToolRunResult(timeoutResult(), suiteFingerprint),
        },
      });

      await expect(
        resolveWorkingRunContext({
          chatSessionId: fixture.chatSession.id,
          currentScope: {
            codeHash: fixture.codeHash,
            executionFingerprint: fixture.executionFingerprint,
            suiteFingerprint,
          },
        }, db.prisma),
      ).resolves.toMatchObject({ alignment: "stale", evidence: { id: stale.id } });
    } finally { await db.cleanup(); }
  });

  it("does not resume working evidence from before the clear boundary", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await createResolverFixture(db.prisma);
      const suiteFingerprint = hashSelectedTestSuite(["case-1"]);
      await db.prisma.runEvidence.create({
        data: {
          chatSessionId: fixture.chatSession.id,
          source: "chat_current_tool",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          codeHash: fixture.codeHash,
          executionFingerprint: fixture.executionFingerprint,
          status: "timeout",
          passedCount: 0,
          failedCount: 1,
          rawResultJson: chatToolRunResult(timeoutResult(), suiteFingerprint, 2),
        },
      });
      await db.prisma.chatSession.update({
        where: { id: fixture.chatSession.id },
        data: {
          clearedBeforeSequence: 2,
          clearedAt: new Date("2026-07-10T10:01:00.000Z"),
        },
      });

      await expect(
        resolveWorkingRunContext({
          chatSessionId: fixture.chatSession.id,
          currentScope: {
            codeHash: fixture.codeHash,
            executionFingerprint: fixture.executionFingerprint,
            suiteFingerprint,
          },
        }, db.prisma),
      ).resolves.toEqual({ alignment: "none" });
    } finally { await db.cleanup(); }
  });

  it("does not resume legacy working evidence that predates a clear", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await createResolverFixture(db.prisma);
      const suiteFingerprint = hashSelectedTestSuite(["case-1"]);
      await db.prisma.runEvidence.create({
        data: {
          chatSessionId: fixture.chatSession.id,
          source: "chat_current_tool",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          codeHash: fixture.codeHash,
          executionFingerprint: fixture.executionFingerprint,
          status: "timeout",
          passedCount: 0,
          failedCount: 1,
          rawResultJson: chatToolRunResult(timeoutResult(), suiteFingerprint),
          createdAt: new Date("2026-07-10T10:00:00.000Z"),
        },
      });
      await db.prisma.chatSession.update({
        where: { id: fixture.chatSession.id },
        data: {
          clearedBeforeSequence: 2,
          clearedAt: new Date("2026-07-10T10:01:00.000Z"),
        },
      });

      await expect(
        resolveWorkingRunContext({
          chatSessionId: fixture.chatSession.id,
          currentScope: {
            codeHash: fixture.codeHash,
            executionFingerprint: fixture.executionFingerprint,
            suiteFingerprint,
          },
        }, db.prisma),
      ).resolves.toEqual({ alignment: "none" });
    } finally { await db.cleanup(); }
  });

  it("resumes working evidence created after the clear boundary", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await createResolverFixture(db.prisma);
      const suiteFingerprint = hashSelectedTestSuite(["case-1"]);
      await db.prisma.chatSession.update({
        where: { id: fixture.chatSession.id },
        data: {
          clearedBeforeSequence: 2,
          clearedAt: new Date("2026-07-10T10:01:00.000Z"),
        },
      });
      await db.prisma.runEvidence.create({
        data: {
          chatSessionId: fixture.chatSession.id,
          source: "chat_current_tool",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          codeHash: fixture.codeHash,
          executionFingerprint: fixture.executionFingerprint,
          status: "timeout",
          passedCount: 0,
          failedCount: 1,
          rawResultJson: chatToolRunResult(timeoutResult(), suiteFingerprint, 3),
        },
      });

      await expect(
        resolveWorkingRunContext({
          chatSessionId: fixture.chatSession.id,
          currentScope: {
            codeHash: fixture.codeHash,
            executionFingerprint: fixture.executionFingerprint,
            suiteFingerprint,
          },
        }, db.prisma),
      ).resolves.toMatchObject({ alignment: "exact" });
    } finally { await db.cleanup(); }
  });
});

function chatToolRunResult(
  result: CodeRunResult,
  suiteFingerprint: string,
  userMessageSequence?: number,
) {
  return JSON.stringify({
    ...result,
    rawResult: {
      chatRunContext: {
        suiteFingerprint,
        ...(userMessageSequence === undefined ? {} : { userMessageSequence }),
      },
    },
  });
}

async function createResolverFixture(
  prisma: Awaited<ReturnType<typeof createMemoryTestDb>>["prisma"],
) {
  const { user, problem, chatSession } = await seedMinimalUserAndProblem(prisma);
  const code = "class Solution:\n    def search(self, nums, target):\n        return -1";
  const codeHash = hashCodeForRun({ language: "Python", code });
  const executionFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code,
  });
  const codeDraft = await prisma.codeDraft.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      language: "Python",
      content: code,
    },
  });
  const reviewAttempt = await prisma.reviewAttempt.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      codeDraftId: codeDraft.id,
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      language: "Python",
      codeSnapshot: code,
    },
  });

  return {
    user,
    problem,
    chatSession,
    codeDraft,
    reviewAttempt,
    code,
    codeHash,
    executionFingerprint,
  };
}

function practiceRunData(
  fixture: Awaited<ReturnType<typeof createResolverFixture>>,
  result: CodeRunResult,
  codeHash: string,
  executionFingerprint: string,
  createdAt: string,
) {
  return {
    userId: fixture.user.id,
    problemId: fixture.problem.id,
    codeDraftId: fixture.codeDraft.id,
    language: "Python",
    codeHash,
    executionFingerprint,
    runOrdinal: Math.floor(Date.parse(createdAt) / 1_000),
    status: result.status,
    passedCount: result.passedCount,
    totalCount: 1,
    summary: "1 selected test",
    provider: "local_hot150",
    selectedTestCaseIds: JSON.stringify(["case-1"]),
    rawResultJson: JSON.stringify(result),
    createdAt: new Date(createdAt),
  };
}

function timeoutResult(): CodeRunResult {
  return {
    status: "timeout",
    failureProvenance: "user_code",
    passedCount: 0,
    failedCount: 3,
    stdout: "",
    stderr: "Execution timed out",
    testResults: [],
    rawResult: { providerUsed: "local_hot150" },
  };
}

function failedResult(): CodeRunResult {
  return {
    status: "failed",
    failureProvenance: "user_code",
    passedCount: 0,
    failedCount: 1,
    stdout: "",
    stderr: "",
    actualOutput: "-1",
    expectedOutput: "0",
    testResults: [],
    rawResult: { providerUsed: "local_hot150" },
  };
}

function passedOneResult(): CodeRunResult {
  return {
    status: "passed_visible_tests",
    failureProvenance: "user_code",
    passedCount: 1,
    failedCount: 0,
    stdout: "",
    stderr: "",
    testResults: [],
    rawResult: { providerUsed: "mock" },
  };
}

function expectNoModelHashLeak(value: unknown) {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain("sha256:");
  expect(serialized).not.toContain("codeHash");
  expect(serialized).not.toContain("executionFingerprint");
  expect(serialized).not.toContain("rawResult");
}
