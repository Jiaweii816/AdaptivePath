import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { CampaignCoreService, CampaignSkeletonPatchService, loadCampaignTodayView } from "@/server/campaign/services";

function prismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E DATABASE_URL is required.");
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
}

async function createPendingStrategistProposal() {
  const prisma = prismaClient();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! } });
    await prisma.campaign.deleteMany({ where: { userId: user.id } });
    const now = new Date();
    const endDate = new Date(now);
    endDate.setUTCDate(endDate.getUTCDate() + 60);
    const campaign = await new CampaignCoreService(prisma, { now: () => now }).materializeInitialCampaign({
      userId: user.id,
      goal: {
        endDate: endDate.toISOString().slice(0, 10),
        dailyQuestionBudget: 5,
        timezone: "UTC",
        language: "Python",
        selfReportedWeakNodes: [],
        preferredNodes: [],
      },
    });
    const todayView = await loadCampaignTodayView({ db: prisma, userId: user.id, now, materialize: true });
    if (todayView.kind !== "campaign") throw new Error("Expected Campaign Today.");
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);
    const patch = await new CampaignSkeletonPatchService(prisma, { now: () => now }).createSkeletonPatchProposal({
      userId: user.id,
      campaignId: campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: campaign.activeSkeletonVersion,
        trigger: "strategist_plan_execute_runtime",
        rationale: "Prioritize one-dimensional DP and use exposure for two-dimensional DP within the three-day horizon.",
        operations: [
          { type: "set_node_priority", nodeId: "N19", priority: 100 },
          { type: "move_node", nodeId: "N19", beforeNodeId: "N7" },
          { type: "set_goal_depth", nodeId: "N20", goalDepth: "exposure" },
        ],
        dateBudgetSuggestions: [{ campaignDate: tomorrowDate, maxQuestions: 3, rationale: "Respect the explicit three-question cap." }],
      },
    });
    const comparisonBranch = (branch: "optimistic" | "observed_supported" | "conservative") => ({
      violations: branch === "conservative" ? ["problem_supply_shortfall"] : [],
      unknowns: branch === "observed_supported" ? ["insufficient_sample"] : [],
      earliestReachableDates: [
        { nodeId: "N19", earliestEligibleDate: tomorrowDate, firstSelectedDate: branch === "conservative" ? null : tomorrowDate },
        { nodeId: "N20", earliestEligibleDate: tomorrowDate, firstSelectedDate: null },
      ],
      days: [{
        campaignDate: tomorrowDate,
        budget: 3,
        phase: "learning",
        selectedNodeIds: branch === "conservative" ? [] : ["N19"],
        violationCodes: branch === "conservative" ? ["problem_supply_shortfall"] : [],
        unknownCodes: branch === "observed_supported" ? ["insufficient_sample"] : [],
      }],
    });
    await prisma.campaignStrategistRun.create({
      data: {
        campaignId: campaign.id,
        activeSkeletonVersion: campaign.activeSkeletonVersion,
        trigger: "user_proposal",
        triggerFingerprint: randomUUID(),
        inputDigest: "a".repeat(64),
        wakeSnapshotJson: "{}",
        promptVersion: "strategist-plan-execute-v1",
        evaluatorVersion: "strategist-wake-v1",
        provider: "production",
        modelAlias: "production-model",
        status: "waiting_approval",
        proposalPatchId: patch.patch.id,
        rationaleSummary: "A bounded future-route proposal is ready for review.",
        runtimeStateJson: JSON.stringify({
          runtimeVersion: "plan-execute-v1",
          runMode: "proposal",
          request: { text: "Prioritize N19 and use exposure for N20 if mastery is not reachable." },
          contextDigest: "b".repeat(64),
          strategyBrief: { objective: "Prioritize the explicit DP goals." },
          resolvedConstraints: {
            horizonEnd: tomorrowDate,
            userGoals: [
              { id: "goal-n19", nodeId: "N19" },
              { id: "goal-n20", nodeId: "N20" },
            ],
          },
          candidates: [{
            fingerprint: "candidate-fingerprint",
            candidate: {
              candidateId: "candidate-dp",
              nodeOperations: [
                { type: "set_node_priority", nodeId: "N19", priority: 100 },
                { type: "move_node", nodeId: "N19", beforeNodeId: "N7" },
              ],
              goalDepth: [{ nodeId: "N20", goalDepth: "exposure" }],
              targetByDate: [],
              dailyBudgetSuggestions: [{ campaignDate: tomorrowDate, maxQuestions: 3, rationale: "Respect the explicit cap." }],
              rationaleSummary: "Prioritize one-dimensional DP and use the requested depth fallback.",
            },
          }],
          observations: [{
            type: "simulation",
            candidateId: "candidate-dp",
            accepted: true,
            comparison: {
              optimistic: comparisonBranch("optimistic"),
              observed_supported: comparisonBranch("observed_supported"),
              conservative: comparisonBranch("conservative"),
            },
          }],
          rejectedCandidates: [],
          selectedCandidateId: "candidate-dp",
        }),
      },
    });
    return { campaignId: campaign.id, patchId: patch.patch.id, tomorrowDate };
  } finally {
    await prisma.$disconnect();
  }
}

async function stateSnapshot(campaignId: string) {
  const prisma = prismaClient();
  try {
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const [today, goal, states, settlements, skeleton] = await Promise.all([
      prisma.campaignDailyTask.findMany({ where: { campaignId }, include: { items: { orderBy: { sortOrder: "asc" } } }, orderBy: { campaignDate: "asc" } }),
      prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId } }),
      prisma.campaignLearnerNodeState.findMany({ where: { campaignId }, orderBy: { nodeId: "asc" } }),
      prisma.campaignTaskItemSettlement.findMany({ where: { taskItem: { dailyTask: { campaignId } } }, orderBy: { id: "asc" } }),
      prisma.campaignSkeleton.findUniqueOrThrow({
        where: { campaignId_version: { campaignId, version: campaign.activeSkeletonVersion } },
        include: { nodePlans: { orderBy: { nodeId: "asc" } } },
      }),
    ]);
    return {
      activeVersion: campaign.activeSkeletonVersion,
      today: JSON.stringify(today),
      goal: JSON.stringify(goal),
      states: JSON.stringify(states),
      settlements: JSON.stringify(settlements),
      skeleton,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function patchStatus(patchId: string) {
  const prisma = prismaClient();
  try {
    const patch = await prisma.campaignSkeletonPatch.findUniqueOrThrow({ where: { id: patchId } });
    return {
      status: patch.status,
      decisionCount: await prisma.campaignSkeletonDecisionLog.count({ where: { patchId } }),
      budgetOverrideCount: await prisma.campaignDailyBudgetOverride.count({ where: { patchId } }),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function createRacePatch(campaignId: string) {
  const prisma = prismaClient();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! } });
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    return await new CampaignSkeletonPatchService(prisma).createSkeletonPatchProposal({
      userId: user.id,
      campaignId,
      proposal: {
        patchSchemaVersion: 1,
        baseVersion: campaign.activeSkeletonVersion,
        trigger: "weekly_boundary",
        rationale: "A concurrent proposal reached review before this planning request was submitted.",
        operations: [{ type: "set_node_priority", nodeId: "N19", priority: 99 }],
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

test("M4D3 UI-1 and UI-2 review and accept the pending Strategist proposal", async ({ page }) => {
  const proposal = await createPendingStrategistProposal();
  const before = await stateSnapshot(proposal.campaignId);
  const originalN7 = before.skeleton.nodePlans.find((node) => node.nodeId === "N7")!;
  await page.goto("/campaign/today");

  const requestInput = page.getByLabel("Your planning request");
  await expect(requestInput).toHaveValue("Prioritize N19 and use exposure for N20 if mastery is not reachable.");
  await expect(requestInput).toBeEditable();
  await expect(page.getByRole("heading", { name: "A future-route proposal is awaiting review" })).toBeVisible();
  await expect(page.getByText("Approval status")).toBeVisible();
  await expect(page.getByText("Patch legality")).toBeVisible();
  await expect(page.getByText("Current/default: 5 → Suggested: 3")).toBeVisible();
  await expect(page.getByText("Pending suggestion — not applied")).toBeVisible();
  await expect(page.getByText("Optimistic path")).toBeHidden();
  await page.getByText("Simulation result", { exact: true }).click();
  const pathCards = ["Optimistic path", "Recent-evidence path", "Conservative path"].map((name) => page.getByText(name, { exact: true }));
  await Promise.all(pathCards.map((card) => expect(card).toBeVisible()));
  const pathPositions = await Promise.all(pathCards.map((card) => card.boundingBox()));
  expect(pathPositions.every((box) => box !== null)).toBe(true);
  expect(Math.max(...pathPositions.map((box) => box!.y)) - Math.min(...pathPositions.map((box) => box!.y))).toBeLessThan(4);
  await expect(page.getByRole("button", { name: "Accept all" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review individually/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate proposal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review proposal before rerunning" })).toBeVisible();
  await requestInput.fill("Edited request retained for the next proposal.");

  await page.getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByRole("heading", { name: "A future-route proposal is awaiting review" })).toHaveCount(0);
  await expect(page.getByText("The approved future-route changes were applied. Today remains unchanged.")).toBeVisible();
  await expect(page.getByText("Proposal awaiting review", { exact: true })).toHaveCount(0);
  await expect(requestInput).toHaveValue("Edited request retained for the next proposal.");
  await expect(page.getByRole("button", { name: "Generate proposal" })).toBeVisible();

  const after = await stateSnapshot(proposal.campaignId);
  const n19 = after.skeleton.nodePlans.find((node) => node.nodeId === "N19")!;
  const n20 = after.skeleton.nodePlans.find((node) => node.nodeId === "N20")!;
  const n7 = after.skeleton.nodePlans.find((node) => node.nodeId === "N7")!;
  expect(await patchStatus(proposal.patchId)).toEqual({ status: "accepted", decisionCount: 1, budgetOverrideCount: 1 });
  expect(after.activeVersion).toBe(before.activeVersion + 1);
  expect(n19.priority).toBe(100);
  expect(n19.sortOrder).toBeLessThan(n7.sortOrder);
  expect(n20.goalDepth).toBe("exposure");
  expect({ included: n7.included, priority: n7.priority, goalDepth: n7.goalDepth, targetWeek: n7.targetWeek, targetByDate: n7.targetByDate })
    .toEqual({ included: originalN7.included, priority: originalN7.priority, goalDepth: originalN7.goalDepth, targetWeek: originalN7.targetWeek, targetByDate: originalN7.targetByDate });
  expect(after.today).toBe(before.today);
  expect(after.goal).toBe(before.goal);
  expect(after.states).toBe(before.states);
  expect(after.settlements).toBe(before.settlements);

  await createRacePatch(proposal.campaignId);
  await requestInput.fill("Prioritize one-dimensional DP.");
  await page.getByRole("button", { name: "Generate proposal" }).click();
  await expect(page.getByText("Your proposal is ready for a decision")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review proposal before rerunning" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A future-route proposal is awaiting review" })).toBeVisible();
});

test("M4D3 UI-3 and UI-4 gate duplicate planning and partially accept N20 without the budget", async ({ page }) => {
  const proposal = await createPendingStrategistProposal();
  const before = await stateSnapshot(proposal.campaignId);
  const originalN19 = before.skeleton.nodePlans.find((node) => node.nodeId === "N19")!;
  await page.goto("/campaign/today");

  await expect(page.getByText("Your proposal is ready for a decision")).toBeVisible();
  await expect(page.getByLabel("Your planning request")).toBeEditable();
  await expect(page.getByRole("button", { name: "Generate proposal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review proposal before rerunning" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await page.getByRole("button", { name: /Review individually/ }).click();
  await page.getByLabel(/Raise the route priority/).uncheck();
  await page.getByLabel(/Move.*One-dimensional DP/).uncheck();
  await page.getByRole("button", { name: "Apply selected changes" }).click();
  await expect(page.getByRole("heading", { name: "A future-route proposal is awaiting review" })).toHaveCount(0);

  const after = await stateSnapshot(proposal.campaignId);
  const n19 = after.skeleton.nodePlans.find((node) => node.nodeId === "N19")!;
  const n20 = after.skeleton.nodePlans.find((node) => node.nodeId === "N20")!;
  expect(await patchStatus(proposal.patchId)).toEqual({ status: "partially_accepted", decisionCount: 1, budgetOverrideCount: 0 });
  expect(n19.priority).toBe(originalN19.priority);
  expect(n19.sortOrder).toBe(originalN19.sortOrder);
  expect(n20.goalDepth).toBe("exposure");
  expect(after.today).toBe(before.today);
  expect(after.goal).toBe(before.goal);
  expect(after.states).toBe(before.states);
  expect(after.settlements).toBe(before.settlements);
});

test("M4D3 UI-5 rejects without changing the route and releases the pending gate", async ({ page }) => {
  const proposal = await createPendingStrategistProposal();
  const before = await stateSnapshot(proposal.campaignId);
  await page.goto("/campaign/today");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByRole("heading", { name: "A future-route proposal is awaiting review" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate proposal" })).toBeVisible();

  const after = await stateSnapshot(proposal.campaignId);
  expect(await patchStatus(proposal.patchId)).toEqual({ status: "rejected", decisionCount: 1, budgetOverrideCount: 0 });
  expect(after.activeVersion).toBe(before.activeVersion);
  expect(JSON.stringify(after.skeleton)).toBe(JSON.stringify(before.skeleton));
  expect(after.today).toBe(before.today);
  expect(after.goal).toBe(before.goal);
  expect(after.states).toBe(before.states);
  expect(after.settlements).toBe(before.settlements);
});
