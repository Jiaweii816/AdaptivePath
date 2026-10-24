import { afterEach, describe, expect, it } from "vitest";
import { CampaignCoreService } from "@/server/campaign/services/campaign-core-service";
import {
  resolveCampaignAttemptForWorkspaceSession,
  startOrResumeCampaignTaskItemAttempt,
} from "@/server/campaign/services/task-evidence-binding";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture() {
  const database = await createCampaignTestDb();
  cleanups.push(database.cleanup);
  const user = await database.prisma.user.create({ data: { handle: "campaign-binding-user" } });
  const service = new CampaignCoreService(database.prisma, {
    now: () => new Date("2026-08-03T09:00:00.000Z"),
  });
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
  const item = daily.items[0]!;
  const problem = await database.prisma.problem.create({
    data: { slug: item.problemSlug, title: item.problemSlug, methodName: "solve" },
  });
  const workspace = async (browserInstanceId: string, problemId = problem.id) =>
    database.prisma.problemWorkspaceSession.create({
      data: {
        userId: user.id,
        problemId,
        browserInstanceId,
        startTrigger: "review",
        captureLevel: "full",
        memoryOrigin: "test",
      },
    });
  return { ...database, user, service, campaign, daily, item, problem, workspace };
}

describe("Campaign TaskItem Attempt binding", () => {
  it("starts once per task/workspace, resumes on refresh, and moves pending to in_progress", async () => {
    const f = await fixture();
    const workspace = await f.workspace("tab-a");
    const start = () => startOrResumeCampaignTaskItemAttempt(f.prisma, {
      userId: f.user.id,
      taskItemId: f.item.id,
      workspaceSessionId: workspace.id,
      now: new Date("2026-08-03T10:00:00.000Z"),
    });
    const first = await start();
    const replay = await start();

    expect(first.kind).toBe("started");
    expect(replay.kind).toBe("resumed");
    expect(replay.attempt.id).toBe(first.attempt.id);
    expect(await f.prisma.campaignTaskItemAttempt.count()).toBe(1);
    expect((await f.prisma.campaignTaskItem.findUniqueOrThrow({ where: { id: f.item.id } })).status)
      .toBe("in_progress");
  });

  it("creates isolated attempts for two tab-local WorkspaceSessions", async () => {
    const f = await fixture();
    const [tabA, tabB] = await Promise.all([f.workspace("tab-a"), f.workspace("tab-b")]);
    const [attemptA, attemptB] = await Promise.all([
      startOrResumeCampaignTaskItemAttempt(f.prisma, {
        userId: f.user.id,
        taskItemId: f.item.id,
        workspaceSessionId: tabA.id,
        now: new Date("2026-08-03T10:00:00.000Z"),
      }),
      startOrResumeCampaignTaskItemAttempt(f.prisma, {
        userId: f.user.id,
        taskItemId: f.item.id,
        workspaceSessionId: tabB.id,
        now: new Date("2026-08-03T10:00:01.000Z"),
      }),
    ]);

    expect(attemptA.attempt.id).not.toBe(attemptB.attempt.id);
    expect(await resolveCampaignAttemptForWorkspaceSession(f.prisma, tabA.id))
      .toMatchObject({ attemptId: attemptA.attempt.id, workspaceSessionId: tabA.id });
    expect(await resolveCampaignAttemptForWorkspaceSession(f.prisma, tabB.id))
      .toMatchObject({ attemptId: attemptB.attempt.id, workspaceSessionId: tabB.id });
  });

  it("rejects wrong learner and wrong problem before creating an Attempt", async () => {
    const f = await fixture();
    const other = await f.prisma.user.create({ data: { handle: "other-user" } });
    const wrongProblem = await f.prisma.problem.create({
      data: { slug: "wrong-problem", title: "Wrong", methodName: "solve" },
    });
    const workspace = await f.workspace("tab-wrong", wrongProblem.id);

    await expect(startOrResumeCampaignTaskItemAttempt(f.prisma, {
      userId: other.id,
      taskItemId: f.item.id,
      workspaceSessionId: workspace.id,
      now: new Date(),
    })).rejects.toMatchObject({ code: "wrong_learner" });
    await expect(startOrResumeCampaignTaskItemAttempt(f.prisma, {
      userId: f.user.id,
      taskItemId: f.item.id,
      workspaceSessionId: workspace.id,
      now: new Date(),
    })).rejects.toMatchObject({ code: "wrong_problem" });
    expect(await f.prisma.campaignTaskItemAttempt.count()).toBe(0);
  });

  it("does not create another Attempt after the TaskItem is settled", async () => {
    const f = await fixture();
    const tabA = await f.workspace("tab-a");
    const first = await startOrResumeCampaignTaskItemAttempt(f.prisma, {
      userId: f.user.id,
      taskItemId: f.item.id,
      workspaceSessionId: tabA.id,
      now: new Date("2026-08-03T10:00:00.000Z"),
    });
    await f.service.settleTaskItem({
      campaignId: f.campaign.id,
      taskItemId: f.item.id,
      attemptId: first.attempt.id,
      settledAt: new Date("2026-08-03T11:00:00.000Z"),
      normalized: {
        reviewCompleted: true,
        passed: true,
        selfRating: "easy",
        evidenceCanVerdict: true,
        evidenceMatchesCurrentRevision: true,
        evidenceMatchesTaskProblem: true,
      },
    });
    const replay = await startOrResumeCampaignTaskItemAttempt(f.prisma, {
      userId: f.user.id,
      taskItemId: f.item.id,
      workspaceSessionId: tabA.id,
      now: new Date("2026-08-03T12:00:00.000Z"),
    });
    expect(replay.kind).toBe("read_only");

    const tabB = await f.workspace("tab-b");
    await expect(startOrResumeCampaignTaskItemAttempt(f.prisma, {
      userId: f.user.id,
      taskItemId: f.item.id,
      workspaceSessionId: tabB.id,
      now: new Date(),
    })).rejects.toMatchObject({ code: "task_not_startable" });
    expect(await f.prisma.campaignTaskItemAttempt.count()).toBe(1);
  });

  it("rejects a deferred source task so only its current-day continuation can be reviewed", async () => {
    const f = await fixture();
    const workspace = await f.workspace("tab-carryover-source");
    await f.prisma.campaignTaskItem.update({
      where: { id: f.item.id },
      data: { status: "deferred" },
    });

    await expect(startOrResumeCampaignTaskItemAttempt(f.prisma, {
      userId: f.user.id,
      taskItemId: f.item.id,
      workspaceSessionId: workspace.id,
      now: new Date("2026-08-03T10:00:00.000Z"),
    })).rejects.toMatchObject({ code: "task_not_startable" });
    expect(await f.prisma.campaignTaskItemAttempt.count()).toBe(0);
  });
});
