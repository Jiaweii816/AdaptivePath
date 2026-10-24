import { afterEach, describe, expect, it } from "vitest";
import {
  campaignCurriculumAssets,
  createCampaignInputSchema,
  createInitialCampaignFromOnboarding,
  deriveInitialSkeletonFromGoal,
  genericCampaignSkeleton,
  loadCampaignRoadmapView,
  loadCampaignTodayView,
  validateCreateCampaignInput,
  validateCurriculumAssets,
} from "@/server/campaign";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

const validInput = {
  endDate: "2026-09-30",
  dailyQuestionBudget: 3,
  language: "Python" as const,
  timezone: "America/Chicago",
  selfReportedWeakNodes: ["N19"],
  preferredNodes: ["N17"],
  idempotencyToken: "21ed7de9-1b25-45df-8f8c-f791f77a4ec4",
};

describe("Campaign onboarding input", () => {
  it("accepts direct question budgets, same-day end dates, and canonicalizes node arrays", () => {
    for (const budget of [3, 4, 5]) {
      const parsed = validateCreateCampaignInput({
        ...validInput,
        dailyQuestionBudget: budget,
        endDate: "2026-08-04",
        selfReportedWeakNodes: ["N19", "N1", "N19"],
      }, "2026-08-04");
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.selfReportedWeakNodes).toEqual(["N1", "N19"]);
    }
  });

  it("rejects invalid planning fields and forbidden product fields", () => {
    const cases = [
      { ...validInput, dailyQuestionBudget: 2 },
      { ...validInput, dailyQuestionBudget: 3.5 },
      { ...validInput, endDate: "2026-02-30" },
      { ...validInput, endDate: "2026-08-03" },
      { ...validInput, timezone: "Houston/Local" },
      { ...validInput, language: "C++" },
      { ...validInput, selfReportedWeakNodes: ["N3"] },
      { ...validInput, preferredNodes: ["N999"] },
      { ...validInput, learnerId: "forged" },
      { ...validInput, mastery: "mastered" },
      { ...validInput, phase: "coverage" },
      { ...validInput, targetCompany: "General FAANG" },
      { ...validInput, hoursPerWeek: 10 },
    ];
    for (const value of cases) {
      expect(validateCreateCampaignInput(value, "2026-08-04").success).toBe(false);
    }
  });

  it("strictly accepts the canonical Python contract", () => {
    expect(createCampaignInputSchema.parse(validInput).language).toBe("Python");
  });
});

describe("initial Campaign Skeleton personalization", () => {
  it("preserves the default route when no choices are supplied", () => {
    const result = deriveInitialSkeletonFromGoal({ weakNodeIds: [], preferredNodeIds: [] });
    expect(result.skeleton.nodePlans).toEqual(genericCampaignSkeleton.nodePlans);
    expect(result.changedNodeIds).toEqual([]);
  });

  it("boosts weak/preferred nodes once while preserving all hard gates", () => {
    const result = deriveInitialSkeletonFromGoal({
      weakNodeIds: ["N19", "N12"],
      preferredNodeIds: ["N19", "N17"],
    });
    expect(result.skeleton.nodePlans).toHaveLength(17);
    expect(result.skeleton.nodePlans.every((plan) =>
      campaignCurriculumAssets.graph.nodes.find((node) => node.nodeId === plan.nodeId)?.kind === "transferable"))
      .toBe(true);
    const byId = new Map(result.skeleton.nodePlans.map((plan) => [plan.nodeId, plan]));
    expect(byId.get("N19")!.priority).toBe(
      Math.min(100, genericCampaignSkeleton.nodePlans.find((plan) => plan.nodeId === "N19")!.priority + 30),
    );
    expect(byId.get("N19")!.rationale).toContain("both a weak area and a preferred");
    expect(byId.get("N12")!.order).toBeLessThan(byId.get("N13")!.order);
    expect(byId.get("N15")!.order).toBeLessThan(byId.get("N17")!.order);
    expect(byId.get("N19")!.order).toBeLessThan(byId.get("N20")!.order);
    expect(validateCurriculumAssets({ graph: campaignCurriculumAssets.graph, skeleton: result.skeleton }).valid).toBe(true);
    expect(deriveInitialSkeletonFromGoal({ weakNodeIds: ["N19", "N12"], preferredNodeIds: ["N19", "N17"] }))
      .toEqual(result);
  });
});

describe("Campaign onboarding creation service", () => {
  async function fixture() {
    const database = await createCampaignTestDb();
    cleanups.push(database.cleanup);
    const user = await database.prisma.user.create({ data: { handle: `m5a-${crypto.randomUUID()}` } });
    return { ...database, user };
  }

  it("atomically materializes Goal, personalized Skeleton v1, NodeState, and initial unlock", async () => {
    const f = await fixture();
    const result = await createInitialCampaignFromOnboarding({
      db: f.prisma,
      userId: f.user.id,
      campaignDate: "2026-08-04",
      value: validInput,
      clock: { now: () => new Date("2026-08-04T16:00:00.000Z") },
    });
    expect(result.kind).toBe("created");
    const campaign = await f.prisma.campaign.findUniqueOrThrow({
      where: { id: result.campaign.campaignId },
      include: { goal: true, skeletons: { include: { nodePlans: true } }, learnerNodeStates: true },
    });
    expect(campaign.goal).toMatchObject({ dailyQuestionBudget: 3, language: "Python", timezone: "America/Chicago" });
    expect(JSON.parse(campaign.goal!.selfReportedWeakNodesJson)).toEqual(["N19"]);
    expect(campaign.skeletons).toHaveLength(1);
    expect(campaign.skeletons[0].nodePlans).toHaveLength(17);
    expect(campaign.skeletons[0].mixedWindowDays).toBe(7);
    expect(campaign.learnerNodeStates).toHaveLength(17);
    expect(campaign.learnerNodeStates.some((state) => state.unlockedAt !== null)).toBe(true);
    expect(campaign.learnerNodeStates.every((state) => state.masteryState === "learning")).toBe(true);
    expect(await f.prisma.campaignTaskItemSettlement.count()).toBe(0);
    expect(await f.prisma.campaignRepairQueueItem.count()).toBe(0);
    expect(await f.prisma.memoryEpisode.count()).toBe(0);
    expect(await f.prisma.campaignStrategistRun.count()).toBe(0);

    const now = new Date("2026-08-04T16:00:00.000Z");
    const today = await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now, materialize: true });
    expect(today).toMatchObject({ kind: "campaign", dailyBudget: 3, plannedCount: 3 });
    const roadmap = await loadCampaignRoadmapView({ db: f.prisma, userId: f.user.id, now });
    expect(roadmap).toMatchObject({ kind: "campaign", totalTransferableCount: 17 });
    expect(await f.prisma.campaignStrategistRun.count()).toBe(0);
  });

  it("returns the existing Campaign for retries and concurrent tabs", async () => {
    const f = await fixture();
    const request = (token: string) => createInitialCampaignFromOnboarding({
      db: f.prisma,
      userId: f.user.id,
      campaignDate: "2026-08-04",
      value: { ...validInput, idempotencyToken: token },
    });
    const concurrent = await Promise.all([
      request(validInput.idempotencyToken),
      request("dc4c7199-4765-4a47-bf5c-33c08ace96db"),
    ]);
    expect(new Set(concurrent.map((result) => result.campaign.campaignId))).toHaveLength(1);
    expect(concurrent.map((result) => result.kind).sort()).toEqual(["already_active", "created"]);
    const retry = await request(validInput.idempotencyToken);
    expect(retry.kind).toBe("already_active");
    expect(await f.prisma.campaign.count()).toBe(1);
    expect(await f.prisma.campaignSkeleton.count()).toBe(1);
    expect(await f.prisma.campaignLearnerNodeState.count()).toBe(17);
  });

  it("rejects invalid input without leaving partial records", async () => {
    const f = await fixture();
    await expect(createInitialCampaignFromOnboarding({
      db: f.prisma,
      userId: f.user.id,
      campaignDate: "2026-08-04",
      value: { ...validInput, dailyQuestionBudget: 2, timezone: "invalid", preferredNodes: ["N3"] },
    })).rejects.toMatchObject({ code: "validation_error" });
    expect(await f.prisma.campaign.count()).toBe(0);
    expect(await f.prisma.campaignSkeleton.count()).toBe(0);
  });
});
