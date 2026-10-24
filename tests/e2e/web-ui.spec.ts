import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { CampaignCoreService, CampaignSkeletonPatchService, loadCampaignTodayView } from "@/server/campaign/services";

function createE2ePrisma() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E DATABASE_URL is required.");
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
}

async function readE2eStarterCode(problemSlug: string) {
  const prisma = createE2ePrisma();
  try {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: problemSlug },
      select: { starterCodePython: true },
    });
    return problem.starterCodePython ?? "";
  } finally {
    await prisma.$disconnect();
  }
}

async function createE2ePatch(operations: unknown[], dailyBudgetSuggestion?: { proposedBudget: number; rationale: string }) {
  const prisma = createE2ePrisma();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! } });
    const campaign = await prisma.campaign.findFirstOrThrow({ where: { userId: user.id, status: "active" } });
    return await new CampaignSkeletonPatchService(prisma).createSkeletonPatchProposal({
      userId: user.id,
      campaignId: campaign.id,
      proposal: {
        patchSchemaVersion: 1,
        baseVersion: campaign.activeSkeletonVersion,
        trigger: "weekly_boundary",
        rationale: "根据近期进度，小幅调整尚未开始的后续路线。",
        operations,
        ...(dailyBudgetSuggestion ? { dailyBudgetSuggestion } : {}),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function createE2eReplanProposal() {
  const prisma = createE2ePrisma();
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! },
    });
    const goal = await prisma.readinessGoal.create({
      data: {
        userId: user.id,
        targetLabel: "E2E compatibility goal",
        interviewDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        weeklyHours: 8,
      },
    });
    return prisma.plannerProposal.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        type: "repeated_failure",
        patternTag: "sliding_window",
        reason: "Repeated boundary trouble needs one optional reinforcement.",
        proposedChangeJson: JSON.stringify({ action: "insert_reinforcement" }),
        targetProblemSlug: "minimum-window-substring",
        targetProblemTitle: "Minimum Window Substring",
        targetLeetcodeNumber: 76,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function readTodayIdentity() {
  const prisma = createE2ePrisma();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! } });
    const task = await prisma.campaignDailyTask.findFirstOrThrow({
      where: { campaign: { userId: user.id, status: "active" } },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { taskId: task.id, itemIds: task.items.map((item) => item.id), budget: task.budget };
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureE2eCampaignTask() {
  const prisma = createE2ePrisma();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! } });
    let campaign = await prisma.campaign.findFirst({ where: { userId: user.id, status: "active" } });
    const now = new Date();
    if (!campaign) {
      const endDate = new Date(now);
      endDate.setUTCDate(endDate.getUTCDate() + 60);
      campaign = await new CampaignCoreService(prisma, { now: () => now }).materializeInitialCampaign({
        userId: user.id,
        goal: {
          endDate: endDate.toISOString().slice(0, 10),
          dailyQuestionBudget: 3,
          timezone: "UTC",
          language: "Python",
          selfReportedWeakNodes: [],
          preferredNodes: [],
        },
      });
    }
    await loadCampaignTodayView({ db: prisma, userId: user.id, now, materialize: true });
    return campaign.id;
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureE2eRoadmapSettlement() {
  await ensureE2eCampaignTask();
  const prisma = createE2ePrisma();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE! } });
    const item = await prisma.campaignTaskItem.findFirstOrThrow({
      where: { dailyTask: { campaign: { userId: user.id, status: "active" } } },
      include: { settlement: true, dailyTask: true },
      orderBy: [{ createdAt: "asc" }, { sortOrder: "asc" }],
    });
    if (item.settlement) return;
    const now = new Date("2026-08-05T15:00:00.000Z");
    const service = new CampaignCoreService(prisma, { now: () => now });
    const attempt = await service.startTaskItemAttempt({ taskItemId: item.id });
    await service.settleTaskItem({
      campaignId: item.dailyTask.campaignId,
      taskItemId: item.id,
      attemptId: attempt.id,
      settledAt: now,
      normalized: {
        reviewCompleted: true,
        passed: true,
        selfRating: "easy",
        evidenceCanVerdict: true,
        evidenceMatchesCurrentRevision: true,
        evidenceMatchesTaskProblem: true,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function focusCodeEditor(page: Page) {
  const editor = page.getByTestId("code-draft-editor");

  await expect(editor.locator(".monaco-editor")).toBeVisible({
    timeout: 30000,
  });
  await editor.locator(".monaco-editor").click({
    position: { x: 180, y: 80 },
  });
}

async function replaceCodeDraft(page: Page, code: string) {
  await focusCodeEditor(page);
  await page.evaluate((nextCode) => {
    window.__patternCoachCodeEditor?.setValue(nextCode);
    window.__patternCoachCodeEditor?.focus();
  }, code);
}

async function readCodeDraft(page: Page) {
  return page.evaluate(() => window.__patternCoachCodeEditor?.getValue() ?? "");
}

test("sidebar contains the planned destinations", async ({
  page,
}) => {
  await page.goto("/workbench");

  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Today" })).toHaveAttribute("href", "/campaign/today");
  await expect(page.getByRole("link", { name: "Workbench" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mock Interview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Problem History" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Skill Profile" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mistake Book" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Knowledge Handbook" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Chat History" })).toBeVisible();
});

test("Campaign onboarding creates the first Campaign from question-count inputs", async ({ page }) => {
  await page.goto("/campaign/today");
  await expect(page.getByRole("heading", { name: "尚未建立学习战役" })).toBeVisible();
  await page.getByRole("link", { name: "创建学习战役" }).click();
  await expect(page).toHaveURL(/\/campaign\/onboarding/);
  await expect(page.getByRole("heading", { name: "创建学习战役" })).toBeVisible();
  await expect(page.getByText("Target company")).toHaveCount(0);
  await expect(page.getByText("Hours / week")).toHaveCount(0);
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() + 60);
  await page.getByLabel("备考结束日期").fill(endDate.toISOString().slice(0, 10));
  await page.getByLabel("每日计划题数").fill("3");
  await page.getByLabel("时区").fill("not/a-timezone");
  await page.getByRole("button", { name: "创建学习战役" }).click();
  await expect(page.getByText("请输入合法的 IANA 时区。")).toBeVisible();
  await expect(page.getByLabel("备考结束日期")).toHaveValue(endDate.toISOString().slice(0, 10));
  await page.getByLabel("时区").fill("UTC");
  await page.getByLabel(/一维 DP 与状态定义/).first().check();
  await page.getByRole("button", { name: "创建学习战役" }).click();
  await expect(page).toHaveURL(/\/campaign\/today/);
  await expect(page.getByRole("heading", { name: "Campaign Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today's Tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Start / }).first()).toBeVisible({ timeout: 15_000 });
  await page.goto("/campaign/onboarding");
  await expect(page).toHaveURL(/\/campaign\/today/);
});

test("Campaign Today materializes a task and safely enters Workbench", async ({ page }) => {
  await ensureE2eCampaignTask();
  await page.goto("/campaign/today");
  await expect(page.getByRole("heading", { name: "Campaign Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today's Tasks" })).toBeVisible();
  const start = page.getByRole("button", { name: /^Start / }).first();
  await expect(start).toBeVisible({ timeout: 15_000 });
  await start.click();
  // The entry response uses campaignAttempt for the trusted hand-off; the
  // Workbench may then canonicalize the visible URL after resolving context.
  await expect(page).toHaveURL(/\/workbench\?problem=/, { timeout: 15_000 });
  await expect(page.getByLabel("Campaign task context")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Campaign Today" })).toBeVisible();
  // The Workbench client can replace its banner during hydration; use the
  // canonical verified href for the return navigation instead of racing a
  // transient link node.
  await page.goto("/campaign/today");
  await expect(page).toHaveURL(/\/campaign\/today/);
});

test("Campaign Strategist product entry is visible without blocking Today", async ({ page }) => {
  await ensureE2eCampaignTask();
  await page.goto("/campaign/today");
  await expect(page.getByRole("heading", { name: "Campaign Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today's Tasks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Strategist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust future route" })).toBeVisible();
  await page.getByRole("button", { name: "Run what-if" }).click();
  const input = page.getByLabel("Your planning request");
  await expect(input).toBeVisible();
  await input.fill("如果把 Graph 目标改为 exposure，未来两周是否更可行？");
  await expect(page.getByRole("heading", { name: "Today's Tasks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review Focus" })).toBeVisible();
});

test("Strategist WebUI keeps the chosen mode, sends typed payloads, and polls the created run", async ({ page }) => {
  await ensureE2eCampaignTask();
  const posts: Array<Record<string, unknown>> = [];
  const polledRunIds: string[] = [];
  let simulationPolls = 0;
  const baseView = { status: "ready", routeRisk: { level: "clear", label: "路线可用", detail: "Today 可照常进行。" }, calendarConfigured: false, latestRun: null };
  const runView = (runMode: "proposal" | "simulation", status: string, resultKind: string) => ({
    status: "ready",
    routeRisk: { level: status === "queued" || status === "running" ? "checking" : "clear", label: "路线可用", detail: "Today 可照常进行。" },
    calendarConfigured: false,
    latestRun: {
      runId: runMode === "simulation" ? "simulation-run" : "proposal-run",
      runMode,
      status,
      statusLabel: status === "queued" ? "等待开始" : "规划已完成",
      resultKind,
      requestSummary: runMode === "simulation" ? "如果降低 Graph 目标深度，未来两周是否更可行？" : "基于 What-if 结果生成正式提案",
      publicSummary: resultKind === "simulation_complete" ? "保守分支可行，Today 未变。" : null,
      progress: [
        { key: "context", label: "读取路线和近期表现", state: "complete" },
        { key: "simulation", label: "模拟候选", state: status === "queued" ? "current" : "complete" },
      ],
      clarification: null,
      candidates: resultKind === "simulation_complete" ? [{ candidateId: "candidate-safe", summary: "降低未来 Graph 目标深度", accepted: true, nodeChanges: [], goalDepthChanges: [], targetByDateChanges: [], dateBudgetSuggestions: [], branches: [] }] : [],
      rejectedCandidates: [],
      selectedCandidateId: resultKind === "simulation_complete" ? "candidate-safe" : null,
      externalDataAsOf: null,
      externalDataValidUntil: null,
      externalDataStale: false,
      errorCode: null,
      errorMessage: null,
      todayUnaffected: true,
    },
  });

  await page.route("**/api/campaign/strategist/runs**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      const runMode = body.runMode as "proposal" | "simulation";
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, result: { kind: "queued", runId: runMode === "simulation" ? "simulation-run" : "proposal-run", status: "queued", runMode } }) });
      return;
    }
    const runId = new URL(request.url()).searchParams.get("runId");
    if (!runId) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, strategist: baseView }) });
      return;
    }
    polledRunIds.push(runId);
    if (runId === "simulation-run") simulationPolls += 1;
    const strategist = runId === "simulation-run"
      ? runView("simulation", simulationPolls === 1 ? "queued" : "no_change", simulationPolls === 1 ? "in_progress" : "simulation_complete")
      : runView("proposal", "no_change", "no_change");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, strategist }) });
  });

  await page.goto("/campaign/today");
  const todayBefore = await page.getByRole("heading", { name: "Today's Tasks" }).locator("..").innerText();
  const whatIf = page.getByRole("button", { exact: true, name: "Run what-if" });
  await whatIf.click();
  await expect(whatIf).toHaveAttribute("aria-pressed", "true");
  const input = page.getByLabel("Your planning request");
  await input.fill("如果降低 Graph 目标深度，未来两周是否更可行？");
  await page.getByRole("button", { name: "Run what-if simulation" }).click();
  await expect(page.getByText("Latest simulation")).toBeVisible();
  await expect(page.getByText("Simulation complete", { exact: true })).toBeVisible({ timeout: 8_000 });
  expect(posts[0]).toMatchObject({ runMode: "simulation" });
  expect(posts.filter((body) => body.runMode === "simulation")).toHaveLength(1);
  expect(polledRunIds.every((runId) => runId === "simulation-run")).toBe(true);
  await expect(page.getByText("What-if complete — your active roadmap was not changed.")).toBeVisible();
  expect(await page.getByRole("heading", { name: "Today's Tasks" }).locator("..").innerText()).toBe(todayBefore);

  await page.getByRole("button", { name: "Create proposal" }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ runMode: "proposal" });
  await expect.poll(() => polledRunIds.includes("proposal-run")).toBe(true);
});

test("Strategist WebUI exposes typed API failures and retry", async ({ page }) => {
  await ensureE2eCampaignTask();
  await page.route("**/api/campaign/strategist/runs**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, code: "rate_limited", message: "今天的 Strategist 运行次数已达上限。" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, strategist: { status: "ready", routeRisk: { level: "clear", label: "路线可用", detail: "Today 可照常进行。" }, calendarConfigured: false, latestRun: null } }) });
  });
  await page.goto("/campaign/today");
  await page.getByLabel("Your planning request").fill("下周优先 Graph。");
  await page.getByRole("button", { name: "Generate route proposal" }).click();
  const alert = page.locator('div[role="alert"]').filter({ hasText: "rate_limited" });
  await expect(alert).toContainText("HTTP 429 · rate_limited");
  await expect(alert).toContainText("Strategist could not start.");
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Run what-if" })).toBeEnabled();
});

test("Campaign Roadmap renders the Growth Map, keyboard Drawer, and responsive route", async ({ page }, testInfo) => {
  await ensureE2eRoadmapSettlement();
  await page.goto("/campaign/roadmap");
  await expect(page.getByRole("heading", { name: "Campaign Roadmap" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campaign summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Blind Spot Slots (Optional)" })).toBeVisible();
  await expect(page.getByText("Simulation and Boundary Handling")).toBeVisible();
  await expect(page.getByTestId("growth-map").getByText("Required gate")).toHaveCount(3);
  const mapNodes = page.getByTestId("growth-map").getByRole("button");
  await expect(mapNodes).toHaveCount(17);
  await mapNodes.first().focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Mastery health")).toBeVisible();
  await expect(drawer.getByText("Mastery progress")).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Recent settlements" })).toBeVisible();
  await expect(drawer.getByText(/Self-rating: Easy/)).toBeVisible();
  await expect(drawer).not.toContainText("settlementId");
  await expect(drawer).not.toContainText("repairQueueItemId");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("r2a-roadmap-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("growth-map").getByRole("button").first()).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
  await mapNodes.first().focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog")).toBeVisible();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
});

test("Campaign redesign keeps DOM graph controls and Today preview interactive", async ({ page }, testInfo) => {
  await ensureE2eRoadmapSettlement();
  await page.goto("/campaign/roadmap");
  const graph = page.getByTestId("growth-map");
  await expect(graph.getByRole("button")).toHaveCount(17);
  const allPaths = page.getByRole("button", { name: "All paths" });
  const mainRoute = page.getByRole("button", { name: "Main route only" });
  await expect(allPaths).toHaveAttribute("aria-pressed", "true");
  await mainRoute.click();
  await expect(mainRoute).toHaveAttribute("aria-pressed", "true");
  await allPaths.click();
  await graph.getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("campaign-roadmap-redesign.png") });

  await page.goto("/campaign/today");
  await expect(page.getByRole("heading", { name: "Campaign Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Route Preview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View full roadmap" })).toBeVisible();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("campaign-today-redesign.png") });
});

test("Campaign Today shows the compact server-owned learning map without squeezing tasks", async ({ page }, testInfo) => {
  await ensureE2eCampaignTask();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/campaign/today");
  await expect(page.getByRole("heading", { name: "Route Preview" })).toBeVisible();
  await expect(page.locator('[aria-label$="day positive streak"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "View full roadmap" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today's Tasks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Replan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review Focus" })).toBeVisible();
  await expect(page.getByText("Optional practice and future-route changes. They never replace today's required task.")).toBeVisible();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("r2a-today-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Route Preview" })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

test("Campaign Today defers optional Replan without changing DailyTask", async ({ page }) => {
  await ensureE2eCampaignTask();
  const before = await readTodayIdentity();
  await createE2eReplanProposal();
  await page.goto("/campaign/today");
  await expect(page.getByText("Minimum Window Substring")).toBeVisible();
  await expect(page.getByText("Optional review · not part of today's required task.")).toBeVisible();
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.getByText("These suggestions are hidden for now and remain pending.")).toBeVisible();
  await page.getByRole("button", { name: "Show again" }).click();
  await expect(page.getByText("Minimum Window Substring")).toBeVisible();
  await expect(page.locator(".campaign-side-quest__actions > button")).toHaveCount(2);
  expect(await readTodayIdentity()).toEqual(before);
});

test("Campaign Patch accepts all while preserving today's materialized task", async ({ page }) => {
  const before = await readTodayIdentity();
  await createE2ePatch([{ type: "move_node", nodeId: "N19", beforeNodeId: "N18" }]);
  await page.goto("/campaign/today");
  await expect(page.getByRole("heading", { name: "学习路线有一项待确认调整" })).toBeVisible();
  await expect(page.getByText("今日任务").first()).toBeVisible();
  await page.getByRole("button", { name: "接受全部" }).first().click();
  await expect(page.getByText("后续学习路线已更新，今日任务保持不变。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "学习路线有一项待确认调整" })).toHaveCount(0);
  expect(await readTodayIdentity()).toEqual(before);
  await page.goto("/campaign/roadmap");
  await expect(page.getByRole("heading", { name: "Campaign Roadmap" })).toBeVisible();
});

test("Campaign Patch dialog partially accepts operation ids with an explicit budget decision", async ({ page }) => {
  const before = await readTodayIdentity();
  await createE2ePatch([
    { type: "set_node_priority", nodeId: "N2", priority: 88 },
    { type: "set_target_week", nodeId: "N4", targetWeek: 4 },
    { type: "set_mixed_window_days", mixedWindowDays: 10 },
  ], { proposedBudget: 4, rationale: "只影响未来任务。" });
  await page.goto("/campaign/today");
  await page.getByRole("button", { name: "查看改动" }).click();
  await expect(page.getByRole("dialog", { name: "确认后续学习路线" })).toBeVisible();
  await expect(page.getByText("这些调整只影响明天及以后的任务")).toBeVisible();
  await expect(page.getByText("建议将每日题数从 3 题调整为 4 题。")).toBeVisible();
  await page.getByLabel(/选择改动：将混合训练窗口/).uncheck();
  await page.getByLabel("保持当前每日题数").check();
  await page.getByRole("button", { name: "应用已选 2 项" }).click();
  await expect(page.getByText("后续学习路线已更新，今日任务保持不变。")).toBeVisible();
  expect(await readTodayIdentity()).toEqual(before);
});

test("Campaign Patch reject keeps the active route and clears the banner", async ({ page }) => {
  await createE2ePatch([{ type: "set_node_priority", nodeId: "N7", priority: 77 }]);
  await page.goto("/campaign/today");
  await expect(page.getByRole("heading", { name: "学习路线有一项待确认调整" })).toBeVisible();
  await page.getByRole("button", { name: "拒绝" }).click();
  await expect(page.getByText("已保留当前路线。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "学习路线有一项待确认调整" })).toHaveCount(0);
});

test("mistake notebook page renders", async ({ page }) => {
  await page.goto("/notebook");

  await expect(
    page.getByRole("heading", { name: "Mistake Book" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Problems to Revisit" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export Markdown" }),
  ).toBeVisible();
});

test("knowledge handbook page renders", async ({ page }) => {
  await page.goto("/handbook");

  await expect(
    page.getByRole("heading", { name: "Knowledge Handbook" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Search concepts, snippets, or use cases"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export Markdown" }),
  ).toBeVisible();
});

test("workbench preserves the active draft when returning from handbook", async ({
  page,
}) => {
  await page.goto("/workbench");

  await page.getByLabel("Problem resolver").fill("LC 35");
  await page.getByRole("button", { name: "Resolve problem" }).click();
  await expect(
    page.getByRole("heading", { name: "Search Insert Position" }).first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/problem=search-insert-position/);

  const draft = [
    "class Solution:",
    "    def searchInsert(self, nums, target):",
    "        # browser-back regression draft",
    "        return len(nums)",
  ].join("\n");

  await replaceCodeDraft(page, draft);
  await expect.poll(() => readCodeDraft(page)).toBe(draft);
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 5000 });

  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("link", { name: "Knowledge Handbook" }).click();
  await expect(page).toHaveURL(/\/handbook/);

  await page.getByRole("link", { name: "Workbench" }).click();
  await expect(page).toHaveURL(/\/workbench\?/);
  await expect(page).toHaveURL(/problem=search-insert-position/);
  await expect(
    page.getByRole("heading", { name: "Search Insert Position" }).first(),
  ).toBeVisible();
  await expect.poll(() => readCodeDraft(page)).toBe(draft);
});

test("direct Workbench visits restore the most recent draft context", async ({
  page,
}) => {
  await page.goto("/workbench?problem=search-insert-position&language=Python");
  await expect(
    page.getByRole("heading", { name: "Search Insert Position" }).first(),
  ).toBeVisible();

  const draft = [
    "class Solution:",
    "    def searchInsert(self, nums, target):",
    "        # direct-workbench restore draft",
    "        return 0",
  ].join("\n");

  await replaceCodeDraft(page, draft);
  await expect.poll(() => readCodeDraft(page)).toBe(draft);
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 5000 });

  await page.goto("/handbook");
  await expect(page).toHaveURL(/\/handbook/);

  await page.goto("/workbench");
  await expect(page).toHaveURL(/\/workbench\?/);
  await expect(page).toHaveURL(/problem=search-insert-position/);
  await expect.poll(() => readCodeDraft(page)).toBe(draft);
});

test("workbench reset restores starter code without changing selected tests", async ({
  page,
}) => {
  await page.goto("/workbench?problem=search-insert-position&language=Python");
  await expect(
    page.getByRole("heading", { name: "Search Insert Position" }).first(),
  ).toBeVisible();

  const starterCode = await readE2eStarterCode("search-insert-position");
  const selectedTestsBefore = await page
    .getByRole("checkbox")
    .evaluateAll((checkboxes) =>
      checkboxes
        .filter((checkbox) => (checkbox as HTMLInputElement).checked)
        .map((checkbox) => (checkbox as HTMLInputElement).id),
    );

  await replaceCodeDraft(
    page,
    `${starterCode}\n\n    # draft to discard\n    return 0`,
  );
  await expect.poll(() => readCodeDraft(page)).not.toBe(starterCode);

  await page
    .getByRole("button", { name: "Reset code draft to starter code" })
    .click();
  await page.getByRole("button", { name: "Reset draft" }).click();

  await expect.poll(() => readCodeDraft(page)).toBe(starterCode);
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 5000 });
  const selectedTestsAfter = await page
    .getByRole("checkbox")
    .evaluateAll((checkboxes) =>
      checkboxes
        .filter((checkbox) => (checkbox as HTMLInputElement).checked)
        .map((checkbox) => (checkbox as HTMLInputElement).id),
    );
  expect(selectedTestsAfter).toEqual(selectedTestsBefore);

  await page.reload();
  await expect.poll(() => readCodeDraft(page)).toBe(starterCode);
});

test("legacy profile onboarding completion opens Campaign Today", async ({
  page,
}) => {
  await page.goto("/onboarding");
  await page.getByLabel("Display Name").fill("Iris904");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page).toHaveURL(/\/campaign\/today$/);
  await expect(
    page.getByRole("heading", { name: "Campaign Today" }),
  ).toBeVisible();

  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Skip onboarding" }).click();
  await expect(page).toHaveURL(/\/campaign\/today$/);
  await expect(
    page.getByRole("heading", { name: "Campaign Today" }),
  ).toBeVisible();
});

test("workbench resolves problems and renders review evidence", async ({
  page,
}) => {
  await page.goto("/workbench");

  await expect(
    page.getByRole("region", { name: "Problem Panel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Code and Tests Panel" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Coach Panel" })).toBeVisible();
  await expect(
    page.getByRole("separator", { name: "Resize problem panel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("separator", { name: "Resize coach panel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review My Code" }),
  ).toBeVisible();

  await page.getByLabel("Problem resolver").fill("LC 35");
  await page.getByRole("button", { name: "Resolve problem" }).click();
  await expect(
    page.getByRole("heading", { name: "Search Insert Position" }).first(),
  ).toBeVisible();
  await expect(page.getByText("insert in middle")).toBeVisible();

  await replaceCodeDraft(
    page,
    "class Solution:\n    def searchInsert(self, nums, target):\n        return 0\n",
  );
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByLabel("Problem resolver").fill("LC 35");
  await page.getByRole("button", { name: "Resolve problem" }).click();
  await expect(page.getByTestId("code-draft-editor")).toContainText(
    "def searchInsert",
  );

  await page.getByRole("button", { name: "Add custom" }).click();
  await page.getByLabel("Custom test label").fill("custom middle insert");
  await page
    .getByLabel("Custom test input JSON")
    .fill('{"nums":[1,3,5,6],"target":4}');
  await page.getByLabel("Custom test expected JSON").fill("2");
  await page
    .getByRole("button", { name: "Add Test" })
    .evaluate((button) => {
      const submitter = button as HTMLButtonElement;
      submitter.form?.requestSubmit(submitter);
    });
  await expect(
    page.getByRole("button", { name: "custom middle insert" }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: /insert in middle/ }).first().click({
    force: true,
  });
  await page.getByRole("button", { name: "Review My Code" }).click();
  const startReview = page.getByRole("button", { name: "Start Review" });
  if (await startReview.isVisible({ timeout: 1000 }).catch(() => false)) {
    await startReview.click();
  }
  await expect(page.getByText("Run summary card")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByLabel("Coach chat reply")).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("region", { name: "Tests Panel", exact: true }),
  ).toContainText("Run Evidence");
  await expect(
    page.getByRole("region", { name: "Tests Panel", exact: true }),
  ).not.toContainText("Tests (combined results)");

  await expect(page.getByLabel("Coach follow-up message")).toBeVisible();
});

test("legacy Today redirects to Campaign Today without hourly planning fields", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/campaign\/today$/);
  await expect(page.getByRole("heading", { name: "Campaign Today" })).toBeVisible();
  await expect(page.getByLabel("Target company")).toHaveCount(0);
  await expect(page.getByLabel("Hours / week")).toHaveCount(0);
});

test("code editor supports block indentation, undo, and auto indentation", async ({
  page,
}) => {
  await page.goto("/workbench");

  const originalCode = [
    "class Solution:",
    "    def twoSum(self, nums, target):",
    "        seen = {}",
    "        return []",
  ].join("\n");

  await replaceCodeDraft(page, originalCode);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Tab");

  await expect.poll(() => readCodeDraft(page)).toBe(
    originalCode
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
  );

  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => readCodeDraft(page)).toBe(originalCode);

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await expect.poll(() => readCodeDraft(page)).toBe("");

  await page.keyboard.press("Control+Z");
  await expect.poll(() => readCodeDraft(page)).toBe(originalCode);

  await replaceCodeDraft(
    page,
    ["class Solution:", "    def sample(self):", "        left = 0"].join("\n"),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("right = 1");

  await expect.poll(() => readCodeDraft(page)).toBe(
    ["class Solution:", "    def sample(self):", "        left = 0", "        right = 1"].join(
      "\n",
    ),
  );
});

test("workbench side panels can collapse and expand", async ({ page }) => {
  await page.goto("/workbench");

  await page.getByRole("button", { name: "Collapse problem panel" }).click();
  await expect(
    page.getByRole("button", { name: "Expand problem panel" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand problem panel" }).click();
  await expect(
    page.getByRole("button", { name: "Collapse problem panel" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Collapse coach panel" }).click();
  await expect(
    page.getByRole("button", { name: "Expand coach panel" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand coach panel" }).click();
  await expect(
    page.getByRole("button", { name: "Collapse coach panel" }),
  ).toBeVisible();
});

test("workbench remains reachable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/workbench");

  await expect(
    page.getByRole("region", { name: "Problem Panel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review My Code" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Coach Panel" })).toBeVisible();
});

test("visible UI copy keeps the product boundary", async ({ page }) => {
  await page.goto("/workbench");
  const bodyText = await page.locator("body").innerText();

  expect(bodyText).not.toMatch(/\bSubmit\b/);
  expect(bodyText).not.toMatch(/guaranteed acceptance/i);
  expect(bodyText).not.toMatch(/passes hidden tests/i);
  expect(bodyText).toContain("Review My Code");
  expect(bodyText).toMatch(/Local demo runner|local visible tests/i);
});
