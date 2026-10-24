import { expect, test } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { CampaignCoreService, loadCampaignTodayView } from "@/server/campaign/services";
import { formatCampaignDate } from "@/server/campaign/core/campaign-calendar";

const desktopViewports = [
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 },
] as const;

function prismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E DATABASE_URL is required.");
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
}

async function ensureVisualCampaign() {
  const prisma = prismaClient();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! } });
    let campaign = await prisma.campaign.findFirst({ where: { userId: user.id, status: "active" } });
    const now = new Date();
    const service = new CampaignCoreService(prisma, { now: () => now });
    if (!campaign) {
      const endDate = new Date(now);
      endDate.setUTCDate(endDate.getUTCDate() + 68);
      campaign = await service.materializeInitialCampaign({
        userId: user.id,
        goal: {
          endDate: endDate.toISOString().slice(0, 10),
          dailyQuestionBudget: 5,
          timezone: "America/Chicago",
          language: "Python",
          selfReportedWeakNodes: [],
          preferredNodes: [],
        },
      });
      await stageVisualRoute({ campaignId: campaign.id, now, prisma, service });
    }
    const today = await loadCampaignTodayView({ db: prisma, userId: user.id, now, materialize: false });
    if (today.kind !== "campaign" || !today.routePreview.previousNode || !today.routePreview.currentNode || !today.repairPool) {
      throw new Error("Campaign visual fixture did not produce the required real route states.");
    }
    await ensureVisualPanels(prisma, user.id, now);
    return campaign.id;
  } finally {
    await prisma.$disconnect();
  }
}

async function stageVisualRoute({
  campaignId,
  now,
  prisma,
  service,
}: {
  campaignId: string;
  now: Date;
  prisma: PrismaClient;
  service: CampaignCoreService;
}) {
  const timezone = "America/Chicago";
  const todayDate = formatCampaignDate(now, timezone);
  const yesterdayDate = formatCampaignDate(new Date(now.getTime() - 24 * 60 * 60 * 1_000), timezone);
  await service.getOrCreateDailyTask({ campaignId, campaignDate: yesterdayDate });
  const previousItems = await prisma.campaignTaskItem.findMany({
    where: { dailyTask: { campaignId, campaignDate: yesterdayDate }, nodeId: "N1" },
    orderBy: { sortOrder: "asc" },
  });
  if (previousItems.length < 2) throw new Error("Campaign visual fixture requires two N1 tasks for an authentic mastery transition.");
  for (const [index, item] of previousItems.slice(0, 2).entries()) {
    const attempt = await service.startTaskItemAttempt({ taskItemId: item.id, startedAt: new Date(now.getTime() - (2 - index) * 60 * 60 * 1_000) });
    await service.settleTaskItem({
      campaignId,
      taskItemId: item.id,
      attemptId: attempt.id,
      settledAt: new Date(now.getTime() - (2 - index) * 60 * 60 * 1_000),
      normalized: {
        reviewCompleted: true,
        passed: true,
        selfRating: "easy",
        evidenceCanVerdict: true,
        evidenceMatchesCurrentRevision: true,
        evidenceMatchesTaskProblem: true,
      },
    });
  }
  await service.getOrCreateDailyTask({ campaignId, campaignDate: todayDate });
  const todayItems = await prisma.campaignTaskItem.findMany({
    where: { dailyTask: { campaignId, campaignDate: todayDate }, status: "pending" },
    orderBy: { sortOrder: "asc" },
  });
  const repairItem = todayItems.find((item) => item.nodeId === "N1") ?? todayItems.find((item) => item.slotRole === "target");
  if (!repairItem) throw new Error("Campaign visual fixture requires a current task to produce a real recovery queue item.");
  const repairAttempt = await service.startTaskItemAttempt({ taskItemId: repairItem.id, startedAt: now });
  await service.settleTaskItem({
    campaignId,
    taskItemId: repairItem.id,
    attemptId: repairAttempt.id,
    settledAt: now,
    normalized: {
      reviewCompleted: true,
      passed: false,
      selfRating: "unsolved",
      evidenceCanVerdict: false,
      evidenceMatchesCurrentRevision: true,
      evidenceMatchesTaskProblem: true,
      evidenceClass: "evidence_unavailable",
    },
  });
}

async function ensureVisualPanels(prisma: PrismaClient, userId: string, now: Date) {
  if (await prisma.plannerProposal.count({ where: { userId } }) === 0) {
    const goal = await prisma.readinessGoal.create({
      data: {
        userId,
        targetLabel: "Campaign visual audit",
        interviewDate: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
        weeklyHours: 8,
      },
    });
    await prisma.plannerProposal.createMany({
      data: [
        {
          userId,
          goalId: goal.id,
          type: "repeated_failure",
          patternTag: "array",
          reason: "You marked this as struggled in recent evidence. A focused revisit can reinforce the invariant.",
          proposedChangeJson: JSON.stringify({ action: "insert_reinforcement" }),
          targetProblemSlug: "rotate-array",
          targetProblemTitle: "Rotate Array",
          targetLeetcodeNumber: 189,
        },
        {
          userId,
          goalId: goal.id,
          type: "repeated_failure",
          patternTag: "binary_search",
          reason: "Recent attempts suggest one optional boundary-invariant review before the next route step.",
          proposedChangeJson: JSON.stringify({ action: "insert_reinforcement" }),
          targetProblemSlug: "find-median-from-data-stream",
          targetProblemTitle: "Find Median from Data Stream",
          targetLeetcodeNumber: 295,
        },
      ],
    });
  }

  if (await prisma.problemHistory.count({ where: { userId, memoryOrigin: "test" } }) > 0) return;
  const problems = await prisma.problem.findMany({
    where: { slug: { in: ["two-sum", "search-in-rotated-sorted-array", "evaluate-division"] } },
    orderBy: { leetcodeNumber: "asc" },
  });
  for (const [index, problem] of problems.entries()) {
    const session = await prisma.chatSession.upsert({
      where: { userId_problemId_memoryOrigin: { userId, problemId: problem.id, memoryOrigin: "test" } },
      create: { userId, problemId: problem.id, title: `Visual review ${problem.title}`, primaryLanguage: "Python", memoryOrigin: "test" },
      update: {},
    });
    const earlier = new Date(now.getTime() - (index + 2) * 24 * 60 * 60 * 1000);
    const priorAttempt = await prisma.reviewAttempt.create({ data: { userId, problemId: problem.id, chatSessionId: session.id, language: "Python", memoryOrigin: "test", createdAt: earlier } });
    await prisma.diagnosisResult.create({
      data: {
        reviewAttemptId: priorAttempt.id,
        mistakeTags: JSON.stringify([index === 1 ? "boundary_invariant" : index === 2 ? "graph_traversal" : "pointer_movement"]),
        userIssueSummary: "Review the latest mechanism issue before retrying.",
        selfCheckQuestion: "Which invariant must remain true before the next step?",
        selfCheckAnswer: "State the invariant, update the boundary once, and verify it after the transition.",
        createdAt: earlier,
      },
    });
    await prisma.problemHistory.create({
      data: { userId, problemId: problem.id, reviewAttemptId: priorAttempt.id, chatSessionId: session.id, language: "Python", runStatus: "failed", memoryOrigin: "test", createdAt: earlier },
    });

    const latestAttempt = await prisma.reviewAttempt.create({ data: { userId, problemId: problem.id, chatSessionId: session.id, language: "Python", memoryOrigin: "test", createdAt: now } });
    await prisma.diagnosisResult.create({ data: { reviewAttemptId: latestAttempt.id, mistakeTags: "[]", createdAt: now } });
    const latestHistory = await prisma.problemHistory.create({
      data: { userId, problemId: problem.id, reviewAttemptId: latestAttempt.id, chatSessionId: session.id, language: "Python", runStatus: "passed", memoryOrigin: "test", createdAt: now },
    });
    await prisma.plannerOutcome.create({ data: { userId, problemId: problem.id, reviewAttemptId: latestAttempt.id, problemHistoryId: latestHistory.id, selfRating: "struggled", createdAt: now } });
  }
}

test("Campaign Today keeps the reference desktop composition at 100% zoom", async ({ page }, testInfo) => {
  await ensureVisualCampaign();
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/campaign/today");
    await expect(page.getByRole("heading", { name: "Campaign Today" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Route Preview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Today.?s Tasks/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Strategist" })).toBeVisible();
    if (viewport.width === 1440) {
      const geometry = await page.locator(".campaign-today-top-grid").evaluate((grid) => {
        const pageMain = document.querySelector<HTMLElement>("main.min-w-0");
        const nav = document.querySelector<HTMLElement>("nav[aria-label='Primary']");
        const frame = document.querySelector<HTMLElement>(".campaign-content-frame");
        const replanBody = grid.querySelector<HTMLElement>(".campaign-replan-panel__body");
        const route = grid.querySelector<HTMLElement>(".campaign-route-preview");
        const legend = grid.querySelector<HTMLElement>(".campaign-route-legend");
        const bounds = grid.getBoundingClientRect();
        const routeBounds = route?.getBoundingClientRect();
        const legendBounds = legend?.getBoundingClientRect();
        return {
          gridHeight: bounds.height,
          routeWidth: routeBounds?.width ?? 0,
          legendHeight: legendBounds?.height ?? 0,
          frameWidth: frame?.getBoundingClientRect().width ?? 0,
          mainWidth: pageMain?.getBoundingClientRect().width ?? 0,
          navPosition: nav ? getComputedStyle(nav).position : "missing",
          navWidth: nav?.getBoundingClientRect().width ?? 0,
          replanOverflowY: replanBody ? getComputedStyle(replanBody).overflowY : "missing",
          viewportWidth: window.innerWidth,
        };
      });
      expect(geometry.gridHeight).toBeGreaterThanOrEqual(454);
      expect(geometry.gridHeight).toBeLessThanOrEqual(458);
      expect(geometry.routeWidth, JSON.stringify(geometry)).toBeGreaterThanOrEqual(720);
      expect(geometry.legendHeight).toBeLessThanOrEqual(38);
      expect(geometry.replanOverflowY).toBe("auto");
      expect(geometry.navPosition).toBe("fixed");
      expect(geometry.navWidth).toBe(0);
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    }
    const reviewOverflow = await page.locator(".campaign-review-panel__body").evaluate((body) => ({
      height: body.parentElement?.getBoundingClientRect().height ?? 0,
      overflowY: getComputedStyle(body).overflowY,
    }));
    expect(reviewOverflow.height).toBe(318);
    expect(reviewOverflow.overflowY).toBe("auto");
    await page.screenshot({ path: testInfo.outputPath(`today-top-${viewport.width}x${viewport.height}.png`) });
    await page.getByRole("heading", { name: "Strategist" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`today-strategist-${viewport.width}x${viewport.height}.png`) });
  }
});
