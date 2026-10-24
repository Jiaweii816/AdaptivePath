import { expect, test } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { CampaignCoreService, loadCampaignRoadmapView } from "@/server/campaign/services";
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

async function ensureRoadmapVisualCampaign() {
  const prisma = prismaClient();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! } });
    const now = new Date();
    const service = new CampaignCoreService(prisma, { now: () => now });
    let campaign = await prisma.campaign.findFirst({ where: { userId: user.id, status: "active" } });
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
      await stageRoadmapStates({ campaignId: campaign.id, now, prisma, service });
    }
    const roadmap = await loadCampaignRoadmapView({ db: prisma, userId: user.id, now });
    if (roadmap.kind !== "campaign" || !roadmap.nodes.some((node) => node.current)) {
      throw new Error("Roadmap visual fixture did not produce a real current node.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function stageRoadmapStates({
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
  const yesterdayDate = formatCampaignDate(new Date(now.getTime() - 24 * 60 * 60 * 1_000), timezone);
  const todayDate = formatCampaignDate(now, timezone);
  await service.getOrCreateDailyTask({ campaignId, campaignDate: yesterdayDate });
  const previousItems = await prisma.campaignTaskItem.findMany({
    where: { dailyTask: { campaignId, campaignDate: yesterdayDate }, nodeId: "N1" },
    orderBy: { sortOrder: "asc" },
  });
  if (previousItems.length < 2) throw new Error("Roadmap fixture requires two authentic N1 exposures.");
  for (const [index, item] of previousItems.slice(0, 2).entries()) {
    const settledAt = new Date(now.getTime() - (2 - index) * 60 * 60 * 1_000);
    const attempt = await service.startTaskItemAttempt({ taskItemId: item.id, startedAt: settledAt });
    await service.settleTaskItem({
      campaignId,
      taskItemId: item.id,
      attemptId: attempt.id,
      settledAt,
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
  if (!repairItem) return;
  const attempt = await service.startTaskItemAttempt({ taskItemId: repairItem.id, startedAt: now });
  await service.settleTaskItem({
    campaignId,
    taskItemId: repairItem.id,
    attemptId: attempt.id,
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

test("Campaign Roadmap keeps a curated desktop dependency map at 100% zoom", async ({ page }, testInfo) => {
  await ensureRoadmapVisualCampaign();
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/campaign/roadmap");
    await expect(page.getByRole("heading", { name: "Campaign Roadmap" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Route progression" })).toHaveCount(1);
    await expect(page.getByTestId("growth-map").getByRole("button")).toHaveCount(17);
    await expect(page.locator("img[src='/campaign/illustrations/roadmap-landscape.webp']")).toBeVisible();
    await expect(page.locator("img[src='/campaign/illustrations/finish-mountain.webp']")).toBeVisible();
    await expect(page.locator("img[src='/campaign/illustrations/roadmap-compass.webp']")).toBeVisible();
    const nodeOverflow = await page.locator(".campaign-roadmap-map__viewport").evaluate((viewport) => {
      const bounds = viewport.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>(".campaign-roadmap-node__card")]
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            left: box.left,
            nodeId: node.closest<HTMLElement>("[id^=node-]")?.id ?? "unknown",
            right: box.right,
          };
        })
        .filter((node) => node.left < bounds.left || node.right > bounds.right);
    });
    expect(nodeOverflow, String(viewport.width) + "px roadmap node overflow").toEqual([]);
    if (viewport.width === 1440) {
      const dependencyEdges = await page.locator("[data-edge]").evaluateAll((edges) => edges.map((edge) => edge.getAttribute("data-edge")).filter(Boolean).sort());
      expect(dependencyEdges).toEqual([
        "N10>N19", "N11>N14", "N12>N13", "N12>N15", "N12>N16", "N15>N17", "N19>N20",
        "N1>N10", "N1>N11", "N1>N18", "N1>N7", "N1>N8", "N2>N14", "N2>N9", "N4>N14",
        "N7>N19", "N8>N9",
      ].sort());
      const geometry = await page.locator(".campaign-roadmap-layout").evaluate((layout) => {
        const columns = [...layout.children].map((child) => child.getBoundingClientRect());
        const map = document.querySelector<HTMLElement>(".campaign-roadmap-map");
        const nav = document.querySelector<HTMLElement>("nav[aria-label='Primary']");
        return {
          columns: columns.map((box) => ({ width: box.width, x: box.x })),
          documentWidth: document.documentElement.scrollWidth,
          mapWidth: map?.getBoundingClientRect().width ?? 0,
          navPosition: nav ? getComputedStyle(nav).position : "missing",
          navWidth: nav?.getBoundingClientRect().width ?? 0,
          viewportWidth: window.innerWidth,
        };
      });
      expect(geometry.columns).toHaveLength(3);
      expect(geometry.columns[0].width).toBeGreaterThanOrEqual(215);
      expect(geometry.columns[1].width).toBeGreaterThanOrEqual(700);
      expect(geometry.columns[2].width).toBeGreaterThanOrEqual(250);
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.mapWidth).toBeGreaterThanOrEqual(700);
      expect(geometry.navPosition).toBe("fixed");
      expect(geometry.navWidth).toBe(0);
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`roadmap-top-${viewport.width}x${viewport.height}.png`) });
    await page.getByRole("heading", { name: /Blind Spot Slots/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`roadmap-bottom-${viewport.width}x${viewport.height}.png`) });
  }
  const graph = page.getByTestId("growth-map");
  await page.getByRole("button", { name: "Main route only" }).click();
  await expect(page.getByRole("button", { name: "Main route only" })).toHaveAttribute("aria-pressed", "true");
  await graph.getByRole("button").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
});
