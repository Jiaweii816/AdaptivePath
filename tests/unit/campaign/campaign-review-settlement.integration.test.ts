import type OpenAI from "openai";
import type { CampaignTaskItem } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDatabase } from "../../../prisma/seed";
import { DIAGNOSIS_SENTINEL } from "@/server/agents/coach-agent/review-output-protocol";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { reviewPipeline } from "@/server/agents/coach-agent/review-pipeline";
import { CampaignCoreService } from "@/server/campaign/services/campaign-core-service";
import { startOrResumeCampaignTaskItemAttempt } from "@/server/campaign/services/task-evidence-binding";
import { buildActiveIdentityKey } from "@/server/observability/workspace-session";
import { recordPlannerOutcome } from "@/server/planner/planner-service";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";
import { createMockCodeRunnerProvider } from "@/server/tools/code-runner/mock-runner";
import {
  createLocalVisibleCodeRunnerFixtureProvider,
  createMemoryTestDb,
  type MemoryTestDb,
} from "../memory-test-helpers";

let database: MemoryTestDb | undefined;
const originalOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "test";
});

afterEach(async () => {
  vi.restoreAllMocks();
  await database?.cleanup();
  database = undefined;
  if (originalOrigin === undefined) delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  else process.env.PATTERNCOACH_MEMORY_ORIGIN = originalOrigin;
});

async function fixture(withCampaign = true, preferredRole?: string) {
  database = await createMemoryTestDb();
  await seedDatabase(database.prisma);
  const user = await database.prisma.user.findUniqueOrThrow({ where: { handle: "try" } });
  const service = new CampaignCoreService(database.prisma, {
    now: () => new Date("2026-08-03T09:00:00.000Z"),
  });
  let taskItem: CampaignTaskItem | null = null;
  if (withCampaign) {
    const campaign = await service.materializeInitialCampaign({
      userId: user.id,
      goal: {
        endDate: "2026-12-01",
        dailyQuestionBudget: 3,
        timezone: "America/Chicago",
        language: "Python",
        selfReportedWeakNodes: [],
        preferredNodes: [],
      },
    });
    const daily = await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
    });
    if ("kind" in daily) throw new Error("Expected DailyTask");
    taskItem = daily.items.find((item) => item.slotRole === preferredRole) ?? daily.items[0]!;
  }
  const problem = await database.prisma.problem.findUniqueOrThrow({
    where: { slug: taskItem?.problemSlug ?? "search-insert-position" },
  });
  const testCases = await database.prisma.problemTestCase.findMany({
    where: { problemId: problem.id, isVisible: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const testCase = testCases[0]!;
  const browserInstanceId = withCampaign ? "campaign-m3a-tab-a" : "ordinary-m3a-tab";
  const workspace = await database.prisma.problemWorkspaceSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      browserInstanceId,
      activeIdentityKey: buildActiveIdentityKey({
        userId: user.id,
        problemId: problem.id,
        browserInstanceId,
        memoryOrigin: "test",
      }),
      startTrigger: "review",
      captureLevel: "full",
      memoryOrigin: "test",
    },
  });
  if (taskItem) {
    await startOrResumeCampaignTaskItemAttempt(database.prisma, {
      userId: user.id,
      taskItemId: taskItem.id,
      workspaceSessionId: workspace.id,
      now: new Date("2026-08-03T09:30:00.000Z"),
    });
  }
  return { prisma: database.prisma, user, service, taskItem, problem, testCase, testCases, browserInstanceId, workspace };
}

describe("Campaign Review and self-rating binding", () => {
  it("persists Review evidence on the correct Attempt and settles from server-owned evidence", async () => {
    const f = await fixture();
    const review = await reviewPipeline(reviewInput(f), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "passed_visible_tests"),
      codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
      backgroundJobsPolicy: "disabled",
    });
    const attemptBeforeRating = await f.prisma.campaignTaskItemAttempt.findFirstOrThrow();
    expect(attemptBeforeRating).toMatchObject({
      reviewAttemptId: review.reviewAttemptId,
      evidenceProblemSlug: f.problem.slug,
      evidenceSubject: "current_user_code",
      evidenceScope: "selected_suite",
      evidenceAuthority: "authoritative",
      evidenceCanVerdict: true,
      verdict: "passed_visible_tests",
      completedAt: null,
    });
    expect(attemptBeforeRating.executionFingerprint).toMatch(/^execfp:v1:sha256:/);
    expect(attemptBeforeRating.selectedSuiteFingerprint).toMatch(/^sha256:/);

    const outcome = await recordPlannerOutcome({
      reviewAttemptId: review.reviewAttemptId,
      problemHistoryId: review.problemHistoryId,
      selfRating: "hesitated",
    }, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") });

    expect(outcome.campaignSettlement).toMatchObject({ kind: "settled", positiveForMastery: true });
    expect(await f.prisma.campaignTaskItemSettlement.findUniqueOrThrow({
      where: { taskItemId: f.taskItem!.id },
    })).toMatchObject({ passed: true, selfRating: "hesitated", positiveForMastery: true });
    expect((await f.prisma.campaignTaskItemAttempt.findFirstOrThrow()).completedAt).not.toBeNull();
    expect((await f.prisma.campaignTaskItem.findUniqueOrThrow({ where: { id: f.taskItem!.id } })).status)
      .toBe("settled");
  });

  it("creates a neutral Settlement for static Review plus easy rating without repair or streak reset", async () => {
    const f = await fixture();
    const priorItem = await f.prisma.campaignTaskItem.findFirstOrThrow({
      where: {
        dailyTaskId: f.taskItem!.dailyTaskId,
        nodeId: f.taskItem!.nodeId,
        id: { not: f.taskItem!.id },
      },
    });
    const priorAttempt = await f.service.startTaskItemAttempt({ taskItemId: priorItem.id });
    await f.service.settleTaskItem({
      campaignId: (await f.prisma.campaignDailyTask.findUniqueOrThrow({
        where: { id: f.taskItem!.dailyTaskId },
      })).campaignId,
      taskItemId: priorItem.id,
      attemptId: priorAttempt.id,
      settledAt: new Date("2026-08-03T09:35:00.000Z"),
      normalized: {
        reviewCompleted: true,
        passed: true,
        selfRating: "easy",
        evidenceCanVerdict: true,
        evidenceMatchesCurrentRevision: true,
        evidenceMatchesTaskProblem: true,
      },
    });
    const review = await reviewPipeline(reviewInput(f), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "runner_error"),
      codeRunnerProvider: createMockCodeRunnerProvider({
        outcome: { kind: "runner_error", stderr: "fixture unavailable" },
      }),
      backgroundJobsPolicy: "disabled",
    });
    const outcome = await recordPlannerOutcome({
      reviewAttemptId: review.reviewAttemptId,
      problemHistoryId: review.problemHistoryId,
      selfRating: "easy",
    }, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") });
    const settlement = await f.prisma.campaignTaskItemSettlement.findUniqueOrThrow({
      where: { taskItemId: f.taskItem!.id },
    });

    expect(outcome.campaignSettlement.kind).toBe("settled");
    expect(settlement).toMatchObject({
      passed: false,
      selfRating: "easy",
      positiveForMastery: false,
      negativeOutcome: false,
    });
    expect(await f.prisma.campaignRepairQueueItem.count()).toBe(0);
    expect((await f.prisma.campaignLearnerNodeState.findFirstOrThrow({
      where: { nodeId: f.taskItem!.nodeId },
    })).latestPositiveStreak).toBe(1);
  });

  it("treats static Review plus unsolved as formal negative evidence and enqueues target repair", async () => {
    const f = await fixture(true, "target");
    const review = await reviewPipeline(reviewInput(f), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "runner_error"),
      codeRunnerProvider: createMockCodeRunnerProvider({ outcome: { kind: "runner_error" } }),
      backgroundJobsPolicy: "disabled",
    });
    await recordPlannerOutcome({
      reviewAttemptId: review.reviewAttemptId,
      problemHistoryId: review.problemHistoryId,
      selfRating: "unsolved",
    }, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") });

    expect(await f.prisma.campaignTaskItemSettlement.findFirstOrThrow()).toMatchObject({
      positiveForMastery: false,
      negativeOutcome: true,
      settlementVersion: 2,
    });
    expect(await f.prisma.campaignRepairQueueItem.findFirstOrThrow()).toMatchObject({
      reason: "target_negative",
      status: "pending",
    });
  });

  it("settles remote-unavailable Review from the same workspace full local visible pass", async () => {
    const f = await fixture();
    const request = reviewInput(f);
    const executionFingerprint = fingerprintCodeForExecution({ language: "Python", code: request.code });
    const localResult = {
      status: "passed_visible_tests",
      passedCount: f.testCases.length,
      failedCount: 0,
      stdout: "",
      stderr: "",
      testResults: [],
      rawResult: {
        providerUsed: "local_hot150",
        evidenceVerdict: {
          evidenceClass: "local_only",
          replyMode: "local_fallback",
          capabilities: {
            canVerdict: true,
            canWriteMistakeMemory: false,
            canWriteEpisode: false,
            canSignalPlanner: true,
            canUseFailureSalience: true,
          },
          status: "passed_visible_tests",
          providerUsed: "local_hot150",
          scopeLabel: "local visible-test evidence",
          modelInstruction: "Visible tests only.",
        },
      },
    };
    const localRun = await f.prisma.practiceRunLog.create({
      data: {
        userId: f.user.id,
        problemId: f.problem.id,
        language: "Python",
        runOrdinal: 1,
        selectedTestCaseIds: JSON.stringify(f.testCases.map((test) => test.id)),
        status: "passed_visible_tests",
        passedCount: f.testCases.length,
        totalCount: f.testCases.length,
        summary: "all local visible tests passed",
        provider: "local_hot150",
        rawResultJson: JSON.stringify(localResult),
        codeHash: "test-code-hash",
        executionFingerprint,
        codeSnapshot: request.code,
        createdAt: new Date("2026-08-03T09:40:00.000Z"),
      },
    });
    await f.prisma.agentTraceRun.create({
      data: {
        id: "campaign-local-run-trace",
        userId: f.user.id,
        problemId: f.problem.id,
        workspaceSessionId: f.workspace.id,
        path: "practice_run",
        actionKind: "practice_run",
        memoryOrigin: "test",
        status: "succeeded",
        processInstanceId: "test",
        runId: localRun.id,
        startedAt: new Date("2026-08-03T09:40:00.000Z"),
        endedAt: new Date("2026-08-03T09:40:01.000Z"),
      },
    });
    const review = await reviewPipeline(request, {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "runner_error"),
      codeRunnerProvider: createMockCodeRunnerProvider({ outcome: { kind: "runner_error" } }),
      backgroundJobsPolicy: "disabled",
    });
    const outcome = await recordPlannerOutcome({
      reviewAttemptId: review.reviewAttemptId,
      problemHistoryId: review.problemHistoryId,
      selfRating: "easy",
    }, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") });

    expect(outcome.campaignSettlement).toMatchObject({ kind: "settled", positiveForMastery: true });
    expect(await f.prisma.campaignTaskItemSettlement.findFirstOrThrow()).toMatchObject({
      passed: true,
      positiveForMastery: true,
      settlementVersion: 2,
      evidenceSource: "local_visible_run",
      evidenceReferenceId: localRun.id,
      evidenceClass: "local_only",
      evidenceAuthority: "advisory",
      evidenceScope: "full_visible_suite",
      evidenceSubject: "current_user_code",
    });
    expect(await f.prisma.campaignTaskItemAttempt.findFirstOrThrow()).toMatchObject({
      evidenceClass: "local_only",
      evidenceAuthority: "advisory",
      evidenceScope: "full_visible_suite",
      verdict: "passed_visible_tests",
    });
  });

  it("leaves every Campaign table unchanged for an ordinary Review and self-rating", async () => {
    const f = await fixture(false);
    const review = await reviewPipeline(reviewInput(f), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "passed_visible_tests"),
      codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
      backgroundJobsPolicy: "disabled",
    });
    const outcome = await recordPlannerOutcome({
      reviewAttemptId: review.reviewAttemptId,
      problemHistoryId: review.problemHistoryId,
      selfRating: "easy",
    }, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") });

    expect(outcome.campaignSettlement).toEqual({ kind: "not_campaign" });
    expect(await f.prisma.campaignTaskItemAttempt.count()).toBe(0);
    expect(await f.prisma.campaignTaskItemSettlement.count()).toBe(0);
    expect(await f.prisma.campaignRepairQueueItem.count()).toBe(0);
  });

  it("derives a target failure from persisted evidence and enqueues one repair", async () => {
    const f = await fixture(true, "target");
    const review = await reviewPipeline(reviewInput(f), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "failed"),
      codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider({
        outcome: { kind: "failed", actual: 0, expected: 1 },
      }),
      backgroundJobsPolicy: "disabled",
    });
    await recordPlannerOutcome({
      reviewAttemptId: review.reviewAttemptId,
      problemHistoryId: review.problemHistoryId,
      selfRating: "struggled",
      passed: true,
      positiveForMastery: true,
    } as never, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") });

    expect(await f.prisma.campaignTaskItemSettlement.findFirstOrThrow()).toMatchObject({
      passed: false,
      positiveForMastery: false,
      negativeOutcome: true,
    });
    expect(await f.prisma.campaignRepairQueueItem.findMany()).toMatchObject([
      { triggerTaskItemId: f.taskItem!.id, reason: "target_negative", status: "pending" },
    ]);
  });

  it("keeps two tab Reviews isolated and allows only one Settlement winner", async () => {
    const f = await fixture();
    const browserB = "campaign-m3a-tab-b";
    const workspaceB = await f.prisma.problemWorkspaceSession.create({
      data: {
        userId: f.user.id,
        problemId: f.problem.id,
        browserInstanceId: browserB,
        activeIdentityKey: buildActiveIdentityKey({
          userId: f.user.id,
          problemId: f.problem.id,
          browserInstanceId: browserB,
          memoryOrigin: "test",
        }),
        startTrigger: "review",
        captureLevel: "full",
        memoryOrigin: "test",
      },
    });
    await startOrResumeCampaignTaskItemAttempt(f.prisma, {
      userId: f.user.id,
      taskItemId: f.taskItem!.id,
      workspaceSessionId: workspaceB.id,
      now: new Date("2026-08-03T09:31:00.000Z"),
    });
    const [reviewA, reviewB] = await Promise.all([
      reviewPipeline(reviewInput(f), {
        prisma: f.prisma,
        coachProvider: coachProvider(f.problem.slug, "passed_visible_tests"),
        codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
        backgroundJobsPolicy: "disabled",
      }),
      reviewPipeline(reviewInput(f, { browserInstanceId: browserB, code: "class Solution:\n    def solve(self, *args):\n        return 2" }), {
        prisma: f.prisma,
        coachProvider: coachProvider(f.problem.slug, "passed_visible_tests"),
        codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
        backgroundJobsPolicy: "disabled",
      }),
    ]);
    const attempts = await f.prisma.campaignTaskItemAttempt.findMany({ orderBy: { startedAt: "asc" } });
    expect(attempts.map((attempt) => attempt.reviewAttemptId).sort()).toEqual(
      [reviewA.reviewAttemptId, reviewB.reviewAttemptId].sort(),
    );
    expect(new Set(attempts.map((attempt) => attempt.executionFingerprint)).size).toBe(2);

    const results = await Promise.all([
      recordPlannerOutcome({
        reviewAttemptId: reviewA.reviewAttemptId,
        problemHistoryId: reviewA.problemHistoryId,
        selfRating: "easy",
      }, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") }),
      recordPlannerOutcome({
        reviewAttemptId: reviewB.reviewAttemptId,
        problemHistoryId: reviewB.problemHistoryId,
        selfRating: "easy",
      }, { db: f.prisma, now: new Date("2026-08-03T10:00:01.000Z") }),
    ]);
    expect(results.map((result) => result.campaignSettlement.kind).sort()).toEqual([
      "already_settled",
      "settled",
    ]);
    expect(await f.prisma.campaignTaskItemSettlement.count()).toBe(1);
    expect(await f.prisma.campaignTaskReceipt.count()).toBe(1);
  });

  it("uses latest Review before settlement and rejects a late rating for the replaced Review", async () => {
    const f = await fixture();
    const first = await reviewPipeline(reviewInput(f), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "passed_visible_tests"),
      codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
      backgroundJobsPolicy: "disabled",
    });
    const second = await reviewPipeline(reviewInput(f, {
      code: "class Solution:\n    def solve(self, *args):\n        return 3",
    }), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "passed_visible_tests"),
      codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
      backgroundJobsPolicy: "disabled",
    });
    expect((await f.prisma.campaignTaskItemAttempt.findFirstOrThrow()).reviewAttemptId)
      .toBe(second.reviewAttemptId);

    await expect(recordPlannerOutcome({
      reviewAttemptId: first.reviewAttemptId,
      problemHistoryId: first.problemHistoryId,
      selfRating: "easy",
    }, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") }))
      .rejects.toMatchObject({ code: "stale_review" });
    expect(await f.prisma.campaignTaskItemSettlement.count()).toBe(0);

    const latest = await recordPlannerOutcome({
      reviewAttemptId: second.reviewAttemptId,
      problemHistoryId: second.problemHistoryId,
      selfRating: "easy",
    }, { db: f.prisma, now: new Date("2026-08-03T10:01:00.000Z") });
    expect(latest.campaignSettlement.kind).toBe("settled");
    expect(await f.prisma.campaignTaskItemSettlement.count()).toBe(1);
  });

  it("keeps the original snapshot and Settlement immutable when another Review occurs afterward", async () => {
    const f = await fixture();
    const first = await reviewPipeline(reviewInput(f), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "passed_visible_tests"),
      codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
      backgroundJobsPolicy: "disabled",
    });
    await recordPlannerOutcome({
      reviewAttemptId: first.reviewAttemptId,
      problemHistoryId: first.problemHistoryId,
      selfRating: "easy",
    }, { db: f.prisma, now: new Date("2026-08-03T10:00:00.000Z") });
    const before = await f.prisma.campaignTaskItemSettlement.findFirstOrThrow();

    const later = await reviewPipeline(reviewInput(f, {
      code: "class Solution:\n    def solve(self, *args):\n        return 9",
    }), {
      prisma: f.prisma,
      coachProvider: coachProvider(f.problem.slug, "failed"),
      codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider({
        outcome: { kind: "failed", actual: 0, expected: 1 },
      }),
      backgroundJobsPolicy: "disabled",
    });
    const outcome = await recordPlannerOutcome({
      reviewAttemptId: later.reviewAttemptId,
      problemHistoryId: later.problemHistoryId,
      selfRating: "struggled",
    }, { db: f.prisma, now: new Date("2026-08-03T11:00:00.000Z") });
    const after = await f.prisma.campaignTaskItemSettlement.findFirstOrThrow();

    expect(outcome.campaignSettlement).toMatchObject({ kind: "already_settled", settlementId: before.id });
    expect(after).toEqual(before);
    expect((await f.prisma.campaignTaskItemAttempt.findFirstOrThrow()).reviewAttemptId)
      .toBe(first.reviewAttemptId);
  });
});

function reviewInput(
  f: Awaited<ReturnType<typeof fixture>>,
  overrides: { browserInstanceId?: string; code?: string } = {},
) {
  return {
    problemId: f.problem.id,
    problemSlug: f.problem.slug,
    language: "Python",
    code: overrides.code ?? "class Solution:\n    def solve(self, *args):\n        return 1",
    selectedTestCaseIds: f.testCases.map((test) => test.id),
    responseLanguage: "en",
    browserInstanceId: overrides.browserInstanceId ?? f.browserInstanceId,
    clientOccurredAt: "2026-08-03T09:45:00.000Z",
  };
}

function coachProvider(problemSlug: string, status: string) {
  const content = [
    "The persisted execution evidence is scoped to the selected visible suite.",
    DIAGNOSIS_SENTINEL,
    JSON.stringify({
      problemSlug,
      runStatus: status,
      userIssueSummary: "The current revision was reviewed.",
      coachSummary: "Use the persisted evidence for the next step.",
      mistakeTags: [],
      skillTags: [],
      selfCheck: null,
      memoryUpdateCandidate: { facts: [], summary: "No durable candidate." },
    }),
  ].join("\n");
  const create = vi.fn().mockResolvedValue({
    model: "deepseek-chat",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return createQwenCoachProvider({ reviewClient: client, chatClient: client, reviewModel: "deepseek-chat" });
}
