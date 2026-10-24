import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDatabase } from "../../../prisma/seed";
import { DIAGNOSIS_SENTINEL } from "@/server/agents/coach-agent/review-output-protocol";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { reviewPipeline } from "@/server/agents/coach-agent/review-pipeline";
import {
  CampaignCoreService,
  createInitialCampaignFromOnboarding,
  createStubStrategistProvider,
  decideCampaignPatch,
  loadCampaignPlanningReviewView,
  loadCampaignRoadmapView,
  loadCampaignTodayView,
  maybeEnqueueStrategistWake,
  startOrResumeCampaignWorkbenchEntry,
} from "@/server/campaign";
import { recordPlannerOutcome } from "@/server/planner/planner-service";
import { createLocalVisibleCodeRunnerFixtureProvider } from "../memory-test-helpers";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
const dayOne = new Date("2026-08-04T15:00:00.000Z");

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Campaign MVP final integrated acceptance", () => {
  it("closes creation, real evidence settlement, mastery/unlock, Strategist proposal, and Patch approval", async () => {
    const database = await createCampaignTestDb();
    cleanups.push(database.cleanup);
    await seedDatabase(database.prisma);
    const user = await database.prisma.user.findUniqueOrThrow({ where: { handle: "try" } });

    const onboarding = await createInitialCampaignFromOnboarding({
      db: database.prisma,
      userId: user.id,
      campaignDate: "2026-08-04",
      clock: { now: () => dayOne },
      value: {
        endDate: "2026-10-30",
        dailyQuestionBudget: 3,
        language: "Python",
        timezone: "America/Chicago",
        selfReportedWeakNodes: [],
        preferredNodes: ["N12"],
        idempotencyToken: "b67f2b51-4fa4-4f52-ac31-359689011e78",
      },
    });
    expect(onboarding.kind).toBe("created");

    const firstToday = await loadCampaignTodayView({
      db: database.prisma,
      userId: user.id,
      now: dayOne,
      materialize: true,
    });
    const refreshedToday = await loadCampaignTodayView({
      db: database.prisma,
      userId: user.id,
      now: dayOne,
      materialize: true,
    });
    if (firstToday.kind !== "campaign" || refreshedToday.kind !== "campaign") {
      throw new Error("Expected a materialized Campaign Today view.");
    }
    expect(firstToday).toMatchObject({ phase: "coverage", dailyBudget: 3, plannedCount: 3 });
    expect(firstToday.items.map((item) => item.taskItemId)).toEqual(
      refreshedToday.items.map((item) => item.taskItemId),
    );
    expect(firstToday.items.slice(0, 2).map((item) => item.slotRole)).toEqual(["advance", "target"]);
    expect(firstToday.items.slice(0, 2).map((item) => item.visibleNode?.nodeId)).toEqual(["N12", "N12"]);
    expect(new Set(firstToday.items.map((item) => item.problemSlug)).size).toBe(firstToday.items.length);
    const persistedDayOne = await database.prisma.campaignDailyTask.findUniqueOrThrow({
      where: {
        campaignId_campaignDate: {
          campaignId: onboarding.campaign.campaignId,
          campaignDate: "2026-08-04",
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    for (const [index, item] of firstToday.items.slice(0, 2).entries()) {
      const browserInstanceId = `campaign-final-tab-${index + 1}`;
      const entry = await startOrResumeCampaignWorkbenchEntry(database.prisma, {
        userId: user.id,
        taskItemId: item.taskItemId,
        browserInstanceId,
        now: new Date(dayOne.getTime() + index * 60_000),
      });
      const resumed = await startOrResumeCampaignWorkbenchEntry(database.prisma, {
        userId: user.id,
        taskItemId: item.taskItemId,
        browserInstanceId,
        now: new Date(dayOne.getTime() + index * 60_000),
      });
      expect(resumed.attemptId).toBe(entry.attemptId);

      const problem = await database.prisma.problem.findUniqueOrThrow({ where: { slug: item.problemSlug } });
      const testCase = await database.prisma.problemTestCase.findFirstOrThrow({
        where: { problemId: problem.id, isVisible: true },
      });
      const review = await reviewPipeline({
        problemId: problem.id,
        problemSlug: problem.slug,
        language: "Python",
        code: `class Solution:\n    def solve(self, *args):\n        return ${index + 1}`,
        selectedTestCaseIds: [testCase.id],
        responseLanguage: "en",
        browserInstanceId,
        clientOccurredAt: new Date(dayOne.getTime() + (index + 1) * 60_000).toISOString(),
      }, {
        prisma: database.prisma,
        coachProvider: passingCoachProvider(problem.slug),
        codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
        backgroundJobsPolicy: "disabled",
      });
      const outcome = await recordPlannerOutcome({
        reviewAttemptId: review.reviewAttemptId,
        problemHistoryId: review.problemHistoryId,
        selfRating: index === 0 ? "easy" : "hesitated",
      }, {
        db: database.prisma,
        now: new Date(dayOne.getTime() + (index + 3) * 60_000),
      });
      expect(outcome.campaignSettlement).toMatchObject({ kind: "settled", positiveForMastery: true });
    }

    const n12 = await database.prisma.campaignLearnerNodeState.findUniqueOrThrow({
      where: { campaignId_nodeId: { campaignId: onboarding.campaign.campaignId, nodeId: "N12" } },
    });
    const n13 = await database.prisma.campaignLearnerNodeState.findUniqueOrThrow({
      where: { campaignId_nodeId: { campaignId: onboarding.campaign.campaignId, nodeId: "N13" } },
    });
    expect(n12).toMatchObject({ masteryState: "mastered", masteryHealth: "stable", latestPositiveStreak: 2 });
    expect(n13.unlockedAt).not.toBeNull();
    const receipt = await database.prisma.campaignTaskReceipt.findUniqueOrThrow({
      where: { taskId: persistedDayOne.id },
    });
    expect(receipt).toMatchObject({ plannedCount: 3, settledCount: 2, status: "partial" });
    const afterSettlement = await loadCampaignTodayView({
      db: database.prisma,
      userId: user.id,
      now: dayOne,
      materialize: false,
    });
    expect(afterSettlement).toMatchObject({ kind: "campaign", settledCount: 2 });
    const roadmap = await loadCampaignRoadmapView({ db: database.prisma, userId: user.id, now: dayOne });
    if (roadmap.kind !== "campaign") throw new Error("Expected a Campaign Roadmap view.");
    expect(roadmap.nodes.find((node) => node.nodeId === "N12")?.status).toBe("mastered_stable");
    expect(roadmap.nodes.find((node) => node.nodeId === "N13")?.status).toBe("available");

    const persistedTodayBeforePatch = await database.prisma.campaignDailyTask.findUniqueOrThrow({
      where: { id: persistedDayOne.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    let providerCalls = 0;
    const wake = await maybeEnqueueStrategistWake({
      db: database.prisma,
      userId: user.id,
      campaignId: onboarding.campaign.campaignId,
      campaignDate: "2026-08-04",
      now: dayOne,
      provider: createStubStrategistProvider({
        decision: "propose_patch",
        rationale: "Prioritize one future unstarted mechanism after the new mastery event.",
        operations: [{ type: "set_node_priority", nodeId: "N4", priority: 90 }],
        dailyBudgetSuggestion: null,
      }, { onCall: () => { providerCalls += 1; } }),
      dispatchOptions: {
        schedule: (task) => task(),
        processInstanceId: "campaign-final-acceptance",
      },
    });
    if (wake.kind !== "queued") throw new Error(`Expected queued Strategist wake, got ${wake.kind}.`);
    const run = await waitForStrategistRun(database.prisma, wake.run.id);
    expect(run).toMatchObject({ status: "proposed" });
    expect(providerCalls).toBe(1);
    expect(run.proposalPatchId).toBeTruthy();
    expect((await loadCampaignPlanningReviewView({
      db: database.prisma,
      userId: user.id,
      campaignId: onboarding.campaign.campaignId,
    })).status).toBe("pending_review");
    expect(await database.prisma.campaignSkeletonDecisionLog.count()).toBe(0);

    const decision = await decideCampaignPatch({
      db: database.prisma,
      userId: user.id,
      patchId: run.proposalPatchId!,
      decision: { action: "accept_all", acceptDailyBudgetSuggestion: false },
    });
    expect(decision).toMatchObject({ kind: "applied", newVersion: 2 });
    const persistedTodayAfterPatch = await database.prisma.campaignDailyTask.findUniqueOrThrow({
      where: { id: persistedDayOne.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    expect(persistedTodayAfterPatch).toEqual(persistedTodayBeforePatch);
    expect(await database.prisma.campaignSkeletonDecisionLog.count()).toBe(1);

    const core = new CampaignCoreService(database.prisma, {
      now: () => new Date("2026-08-05T15:00:00.000Z"),
    });
    const nextDay = await core.getOrCreateDailyTask({
      campaignId: onboarding.campaign.campaignId,
      campaignDate: "2026-08-05",
    });
    if ("kind" in nextDay) throw new Error("Expected a next-day task.");
    expect(nextDay.primaryNodeId).toBe("N4");
  });
});

function passingCoachProvider(problemSlug: string) {
  const content = [
    "The current revision passed the selected visible fixture suite.",
    DIAGNOSIS_SENTINEL,
    JSON.stringify({
      problemSlug,
      runStatus: "passed_visible_tests",
      userIssueSummary: "The current revision was reviewed.",
      coachSummary: "Continue with the next Campaign task.",
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
  return createQwenCoachProvider({
    reviewClient: client,
    chatClient: client,
    reviewModel: "deepseek-chat",
  });
}

async function waitForStrategistRun(
  db: Awaited<ReturnType<typeof createCampaignTestDb>>["prisma"],
  runId: string,
) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const run = await db.campaignStrategistRun.findUniqueOrThrow({ where: { id: runId } });
    if (["proposed", "invalid", "failed"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Strategist run ${runId} did not finish.`);
}
