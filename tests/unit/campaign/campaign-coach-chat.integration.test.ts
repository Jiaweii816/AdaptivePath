import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDatabase } from "../../../prisma/seed";
import { chatReply } from "@/server/agents/coach-agent/chat-reply";
import { buildCoachChatSystemPrompt } from "@/server/agents/coach-agent/build-chat-prompt";
import type {
  CoachChatInput,
  CoachProvider,
} from "@/server/agents/coach-agent/coach-agent.types";
import { CampaignCoreService } from "@/server/campaign/services/campaign-core-service";
import { startOrResumeCampaignWorkbenchEntry } from "@/server/campaign/services/campaign-experience-service";
import { createCampaignTestDb } from "./campaign-test-db";

type TestDb = Awaited<ReturnType<typeof createCampaignTestDb>>;
let database: TestDb | undefined;
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

describe("Campaign role policy in the real Chat orchestration", () => {
  it("loads trusted advance context once and leaves tool eligibility unchanged", async () => {
    const fixture = await campaignFixture("advance", "m3c-advance-tab");
    const provider = providerReply("先定义写指针表示的已确认前缀。");
    const result = await chat(fixture, provider, "给我一点提示");
    const input = provider.chat.mock.calls[0]![0] as CoachChatInput;

    expect(result.coachReply).toContain("写指针");
    expect(input.campaignCoaching).toMatchObject({
      slotRole: "advance",
      settled: false,
      nodeKind: "transferable",
      policy: {
        coachingMode: "guided_learning",
        automaticTechnicalMemoryCueBudget: 1,
      },
    });
    expect(input.tools?.map((tool) => tool.function.name)).toEqual([
      "discover_capability",
      "recall_learning_experience",
      "get_algorithm_hint",
    ]);
    const prompt = buildCoachChatSystemPrompt(input);
    expect(prompt).toContain("[CAMPAIGN TASK POLICY — trusted server context]");
    expect(prompt).toContain("role: advance");
    expect(prompt).toContain(input.campaignCoaching!.nodeNameInternal);
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it("frames target work as transfer without expanding capabilities", async () => {
    const fixture = await campaignFixture("target", "m3c-target-tab");
    const provider = providerReply(
      "先比较上一题共享的状态，再指出当前条件改变了什么。",
    );
    await chat(fixture, provider, "这题和上一题有什么关系？");
    const input = provider.chat.mock.calls[0]![0] as CoachChatInput;
    const prompt = buildCoachChatSystemPrompt(input);
    expect(input.campaignCoaching?.policy).toMatchObject({
      coachingMode: "transfer_practice",
      shouldPromptTransfer: true,
      automaticTechnicalMemoryCueBudget: 1,
    });
    expect(prompt).toContain("what state is shared");
    // A broad transfer question still enters the bounded tool loop so the
    // model can discover a relevant read-only capability when needed. This
    // must not grant any Campaign-specific or durable-write capability.
    expect(input.tools?.map((tool) => tool.function.name)).toEqual([
      "discover_capability",
      "recall_learning_experience",
    ]);
  });

  it("enforces a narrow probe default and honors explicit full-code override", async () => {
    const fixture = await campaignFixture("probe", "m3c-probe-tab");
    const complete = [
      "```python",
      "class Solution:",
      `    def ${fixture.problem.methodName}(self, *args):`,
      "        return 1",
      "```",
    ].join("\n");
    const blockedProvider = providerReply(complete);
    const blocked = await chat(fixture, blockedProvider, "帮我一下");
    const blockedInput = blockedProvider.chat.mock.calls[0]![0] as CoachChatInput;

    expect(blockedInput.campaignCoaching?.policy).toMatchObject({
      coachingMode: "assessment_probe",
      automaticTechnicalMemoryCueBudget: 0,
      mayProactivelyNameNode: false,
    });
    expect(blockedInput.memory.teachableMemories).toEqual([]);
    expect(blocked.coachReply).not.toContain("class Solution");

    const explicitProvider = providerReply(complete);
    const explicit = await chat(
      fixture,
      explicitProvider,
      "不要提示了，直接给我完整代码",
    );
    const explicitInput = explicitProvider.chat.mock.calls[0]![0] as CoachChatInput;
    expect(explicitInput.campaignCoaching?.policy).toMatchObject({
      explicitDisclosureOverride: true,
      effectiveDisclosureCeiling: "full_code",
      shouldWarnAssessmentContamination: true,
    });
    expect(explicit.coachReply).toMatch(/^这会降低本次盲区探测的有效性/);
    expect(explicit.coachReply).toContain("class Solution");
    expect(explicitProvider.chat).toHaveBeenCalledTimes(1);
  });

  it("projects a trusted remedial reason without exposing its storage code", async () => {
    const fixture = await campaignFixture("probe", "m3c-remedial-tab");
    await fixture.prisma.campaignTaskItem.update({
      where: { id: fixture.entry.context.taskItemId },
      data: { slotRole: "remedial" },
    });
    const item = await fixture.prisma.campaignTaskItem.findUniqueOrThrow({
      where: { id: fixture.entry.context.taskItemId },
      include: { dailyTask: true },
    });
    const repair = await fixture.prisma.campaignRepairQueueItem.create({
      data: {
        campaignId: item.dailyTask.campaignId,
        nodeId: item.nodeId,
        triggerTaskItemId: item.id,
        reason: "target_negative",
        priority: 80,
        status: "scheduled",
      },
    });
    await fixture.prisma.campaignDailyTask.update({
      where: { id: item.dailyTaskId },
      data: {
        selectionMetadataJson: JSON.stringify({
          scheduledRepairQueueItemIds: [repair.id],
        }),
      },
    });
    const provider = providerReply("先检查状态更新发生在条件判断之前还是之后。");
    await chat(fixture, provider, "我该先检查哪里？");
    const input = provider.chat.mock.calls[0]![0] as CoachChatInput;
    const prompt = buildCoachChatSystemPrompt(input);

    expect(input.campaignCoaching).toMatchObject({
      slotRole: "remedial",
      repairReason: expect.stringContaining("unstable condition"),
      policy: { coachingMode: "targeted_repair" },
    });
    expect(prompt).toContain("Trusted repair focus");
    expect(prompt).not.toContain("target_negative");
    expect(input.memory.teachableMemories.length).toBeLessThanOrEqual(1);
  });

  it("keeps mixed node identity internal until an explicit pattern request", async () => {
    const fixture = await campaignFixture("probe", "m3c-mixed-tab");
    await fixture.prisma.campaignTaskItem.update({
      where: { id: fixture.entry.context.taskItemId },
      data: { slotRole: "mixed" },
    });
    const nodeName = fixture.entry.context.nodeName;
    if (!nodeName) throw new Error("Expected probe fixture node name.");
    const leakingProvider = providerReply(`这是${nodeName}节点，按这个模式做即可。`);
    const guarded = await chat(fixture, leakingProvider, "给我一个提示");
    const input = leakingProvider.chat.mock.calls[0]![0] as CoachChatInput;
    expect(input.campaignCoaching).toMatchObject({
      slotRole: "mixed",
      nodeNameInternal: "位运算",
      policy: {
        coachingMode: "interview_mix",
        mayProactivelyNameNode: false,
      },
    });
    expect(buildCoachChatSystemPrompt(input)).not.toContain(
      "Visible learning node: 位运算",
    );
    expect(guarded.coachReply).toContain("先不要给这道题贴标签");

    const explicitProvider = providerReply(`对，这是${nodeName}节点。`);
    const explicit = await chat(
      fixture,
      explicitProvider,
      "这是什么题型？直接告诉我模式",
    );
    const explicitInput = explicitProvider.chat.mock.calls[0]![0] as CoachChatInput;
    expect(explicitInput.campaignCoaching?.policy.mayProactivelyNameNode).toBe(
      true,
    );
    expect(explicit.coachReply).toContain(nodeName);
  });

  it("keeps ordinary Chat free of Campaign prompt, policy, and guard changes", async () => {
    database = await createCampaignTestDb();
    await seedDatabase(database.prisma);
    const problem = await database.prisma.problem.findUniqueOrThrow({
      where: { slug: "two-sum" },
    });
    const provider = providerReply("普通提示：先想互补值。");
    const result = await chat(
      {
        prisma: database.prisma,
        problem,
        browserInstanceId: "m3c-ordinary-tab",
      },
      provider,
      "给我一点提示",
    );
    const input = provider.chat.mock.calls[0]![0] as CoachChatInput;

    expect(result.coachReply).toBe("普通提示：先想互补值。");
    expect(input.campaignCoaching).toBeUndefined();
    expect(buildCoachChatSystemPrompt(input)).not.toContain(
      "CAMPAIGN TASK POLICY",
    );
    expect(input.tools?.map((tool) => tool.function.name)).toEqual([
      "discover_capability",
      "recall_learning_experience",
      "get_algorithm_hint",
    ]);
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });
});

async function campaignFixture(
  role: "advance" | "target" | "probe",
  browserInstanceId: string,
) {
  database = await createCampaignTestDb();
  await seedDatabase(database.prisma);
  const user = await database.prisma.user.findUniqueOrThrow({
    where: { handle: "try" },
  });
  const service = new CampaignCoreService(database.prisma, {
    now: () => new Date("2026-08-04T09:00:00.000Z"),
  });
  const campaign = await service.materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate: "2026-12-01",
      dailyQuestionBudget: 4,
      timezone: "America/Chicago",
      language: "Python",
      selfReportedWeakNodes: [],
      preferredNodes: [],
    },
  });
  const task = await service.getOrCreateDailyTask({
    campaignId: campaign.id,
    campaignDate: "2026-08-04",
  });
  if ("kind" in task) throw new Error("Expected a DailyTask fixture.");
  const item = task.items.find((candidate) => candidate.slotRole === role);
  if (!item) throw new Error(`Expected ${role} Campaign task item.`);
  const entry = await startOrResumeCampaignWorkbenchEntry(database.prisma, {
    userId: user.id,
    taskItemId: item.id,
    browserInstanceId,
    now: new Date("2026-08-04T09:10:00.000Z"),
  });
  const problem = await database.prisma.problem.findUniqueOrThrow({
    where: { slug: item.problemSlug },
  });
  return { prisma: database.prisma, problem, browserInstanceId, entry };
}

async function chat(
  fixture: {
    prisma: TestDb["prisma"];
    problem: { slug: string; methodName: string };
    browserInstanceId: string;
  },
  provider: ReturnType<typeof providerReply>,
  message: string,
) {
  return chatReply(
    {
      problemSlug: fixture.problem.slug,
      message,
      language: "Python",
      code: `class Solution:\n    def ${fixture.problem.methodName}(self, *args):\n        pass`,
      selectedTestCaseIds: [],
      responseLanguage: "zh",
      browserInstanceId: fixture.browserInstanceId,
      clientOccurredAt: "2026-08-04T09:15:00.000Z",
    },
    {
      prisma: fixture.prisma,
      coachProvider: provider,
      backgroundJobsPolicy: "disabled",
    },
  );
}

function providerReply(reply: string) {
  const review = vi.fn<CoachProvider["review"]>(async () => {
    throw new Error("Review is not used by the Campaign Chat fixture.");
  });
  const chat = vi.fn<CoachProvider["chat"]>(async () => ({
    type: "final" as const,
    coachReply: reply,
  }));
  return {
    review,
    chat,
  } satisfies CoachProvider;
}
