import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CampaignRoadmap } from "@/features/campaign/campaign-roadmap";
import { CampaignTodayClient } from "@/features/campaign/campaign-today-client";
import { CampaignOnboardingForm } from "@/features/campaign/campaign-onboarding-form";
import type { CampaignRoadmapView, CampaignTodayView } from "@/server/campaign";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function roadmapNode(overrides: Partial<CampaignRoadmapView["nodes"][number]> = {}): CampaignRoadmapView["nodes"][number] {
  return {
    nodeId: "N1",
    nodeName: "原地数组与写指针",
    order: 1,
    status: "available",
    statusLabel: "可开始",
    masteryState: "learning",
    masteryHealth: "stable",
    latestPositiveStreak: 0,
    attemptedProblemCount: 0,
    neverSeenProblemCount: 9,
    completedProblems: 0,
    totalProblems: 9,
    masteryProgressCurrent: 0,
    masteryProgressRequired: 2,
    pendingRepairCount: 0,
    available: true,
    locked: false,
    recentSettlements: [],
    coreInvariant: "read/write",
    requiredPrerequisites: [],
    recommendedPrerequisites: [],
    lockedReason: null,
    current: false,
    ...overrides,
  };
}

const today: CampaignTodayView = {
  kind: "campaign",
  displayName: "Iris",
  campaignLabel: "Hot-150 学习战役",
  campaignDate: "2026-08-03",
  timezone: "America/Chicago",
  phase: "consolidation_mixed",
  phaseLabel: "巩固 · 混合训练",
  phaseDescription: "不预先显示题型，用跨节点练习模拟面试。",
  endDate: "2026-08-10",
  remainingDays: 7,
  ended: false,
  dailyBudget: 3,
  plannedCount: 1,
  settledCount: 0,
  hasUnsettledItems: true,
  canAdvanceToNextDay: true,
  nextCampaignDate: "2026-08-04",
  taskStatus: "active",
  masteredTransferableCount: 17,
  totalTransferableCount: 17,
  shortfall: null,
  planning: { status: "idle", pendingPatch: null },
  strategist: {
    status: "ready",
    routeRisk: { level: "clear", label: "当前未发现阻塞风险", detail: "可以继续学习。" },
    calendarConfigured: false,
    latestRun: null,
  },
  proactiveDashboard: {
    replan: { status: "empty", proposals: [], overflowRepairs: [] },
    reviewFocus: { status: "empty", board: { cards: [] } },
  },
  routePreview: {
    previousNode: { nodeName: "排序扫描与贪心决策", status: "mastered_stable", statusLabel: "已掌握 · 稳定" },
    currentNode: null,
    nextNodes: [],
    currentPositiveStreak: 0,
    pendingRepairCount: 0,
  },
  repairPool: null,
  items: [{
    taskItemId: "item-1",
    problemSlug: "two-sum",
    problemTitle: "Two Sum",
    order: 1,
    slotRole: "mixed",
    roleLabel: "混合训练",
    exposureType: "externally_seen",
    exposureLabel: "曾在外部做过",
    repeatedExposure: true,
    isCarryover: false,
    status: "pending",
    canStart: true,
    canResume: false,
    outcome: null,
  }],
};

describe("Campaign presentation", () => {
  it("renders mixed task semantics without inventing a Revisit role", () => {
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={today} />);
    expect(html).toContain("Pattern reveals after settlement");
    expect(html).toContain("Mixed");
    expect(html).not.toContain("Revisit");
    expect(html).toContain("Start Two Sum");
    expect(html).not.toContain("Learning node:");
    expect(html).toContain("Learning Journey");
    expect(html).toContain("Route Preview");
    expect(html).toContain("View full roadmap");
    expect(html.indexOf("Route Preview")).toBeLessThan(html.indexOf("Today&#x27;s tasks"));
    expect(html.indexOf("Today&#x27;s tasks")).toBeLessThan(html.indexOf("Strategist"));
  });

  it("labels a fresh remedial problem as Recover instead of New", () => {
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      phase: "coverage",
      items: [{
        ...today.items[0],
        slotRole: "remedial",
        roleLabel: "Recovery",
        exposureType: "never_seen",
        exposureLabel: "New",
        repeatedExposure: false,
        visibleNode: {
          nodeId: "N1",
          nodeName: "Array writing",
          mechanism: "read/write pointers",
          healthImpact: "needs_reinforcement",
        },
      }],
    }} />);
    expect(html).toContain("Recover");
    expect(html).not.toContain("campaign-task-badge--remedial\">New");
  });

  it("offers Carry forward for unfinished work and Next day once fully settled", () => {
    const pending = renderToStaticMarkup(<CampaignTodayClient initialView={today} />);
    const completed = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      settledCount: 1,
      hasUnsettledItems: false,
      taskStatus: "completed",
      canAdvanceToNextDay: true,
      nextCampaignDate: "2026-08-04",
      items: today.items.map((item) => ({
        ...item,
        status: "settled",
        canStart: false,
        reviewUrl: `/workbench?problem=${item.problemSlug}`,
      })),
    }} />);
    expect(pending).toContain("0 / 1");
    expect(pending).toContain("campaign-next-day-button");
    expect(pending).toContain("Carry forward");
    expect(pending).toContain("Carry unfinished work into next Campaign day 2026-08-04");
    expect(completed).toContain("campaign-next-day-button");
    expect(completed).toContain("Open next Campaign day 2026-08-04");
    expect(completed).toContain("Next day");
    expect(completed).not.toContain("1 / 1 settled");
    expect(completed).not.toContain("Today is settled.");
    expect(completed).toContain("Redo Review");
    expect(completed).toContain("Redo Review for Two Sum");
  });

  it("keeps the latest Strategist request in history instead of loading it as a new draft", () => {
    const historicalRequest = "Smoke request that must not become a learner draft.";
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      strategist: {
        status: "ready",
        routeRisk: { level: "clear", label: "Route clear", detail: "The simulation changed nothing." },
        calendarConfigured: false,
        latestRun: {
          runId: "simulation-history",
          runMode: "simulation",
          status: "no_change",
          statusLabel: "Simulation complete",
          resultKind: "simulation_complete",
          requestSummary: historicalRequest,
          publicSummary: null,
          progress: [],
          clarification: null,
          candidates: [],
          rejectedCandidates: [],
          selectedCandidateId: null,
          externalDataAsOf: null,
          externalDataValidUntil: null,
          externalDataStale: false,
          errorCode: null,
          errorMessage: null,
          todayUnaffected: true,
        },
      },
    }} />);

    expect(html).toContain("Reuse previous request");
    expect(html).not.toContain("Previous request loaded");
    expect(html).not.toContain(historicalRequest);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("What-if complete — your active roadmap was not changed.");
  });

  it("does not restore failed Strategist history after a page load", () => {
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      strategist: {
        status: "ready",
        routeRisk: { level: "attention", label: "Latest planning attempt incomplete", detail: "The active roadmap was not changed." },
        calendarConfigured: false,
        latestRun: {
          runId: "failed-run",
          runMode: "proposal",
          status: "failed",
          statusLabel: "Planning incomplete",
          resultKind: "failed",
          requestSummary: null,
          publicSummary: null,
          progress: [],
          clarification: null,
          candidates: [],
          rejectedCandidates: [],
          selectedCandidateId: null,
          externalDataAsOf: null,
          externalDataValidUntil: null,
          externalDataStale: false,
          errorCode: "invalid_structured_output",
          errorMessage: "Strategist Runtime could not complete this request. Try again.",
          todayUnaffected: true,
        },
      },
    }} />);

    expect(html).not.toContain("Latest planning attempt incomplete");
    expect(html).not.toContain("This planning attempt did not complete.");
    expect(html).not.toContain("Incomplete");
    expect(html).not.toContain("Previous planning attempt");
  });

  it("renders an unfinished task as a yellow Continue action after its bookmark", () => {
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      items: [{ ...today.items[0], canResume: true }],
    }} />);

    expect(html).toContain("campaign-start-button--continue");
    expect(html).toContain("Continue Two Sum");
    expect(html.indexOf("campaign-mission-row__bookmark")).toBeLessThan(html.indexOf("Continue Two Sum"));
  });

  it("renders the Repair pool with readable copy and no internal queue fields", () => {
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      repairPool: {
        pendingNodeCount: 2,
        highestPriorityNode: {
          nodeId: "N7",
          nodeName: "排序扫描与贪心决策",
          readableReason: "靶向练习显示这个节点需要补练",
          scheduledForTomorrow: true,
        },
      },
    }} />);
    expect(html).toContain("Recovery: 2");
    expect(html).toContain("Review recovery node");
    expect(html).toContain("/campaign/roadmap#node-N7");
    expect(html).not.toContain("target_negative");
    expect(html).not.toContain("queueId");
  });

  it("renders Replan and Review Focus as optional, distinct proactive surfaces", () => {
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      proactiveDashboard: {
        replan: {
          status: "ready",
          overflowRepairs: [],
          proposals: [{
            id: "proposal-1",
            type: "repeated_failure",
            patternTag: "sliding_window",
            reason: "You marked sliding_window as struggled/unsolved 2 times in the last 14 days.",
            targetProblemSlug: "minimum-window-substring",
            targetProblemTitle: "Minimum Window Substring",
            targetLeetcodeNumber: 76,
            proposedChange: { action: "insert_reinforcement" },
            createdAt: "2026-08-03T12:00:00.000Z",
          }],
        },
        reviewFocus: {
          status: "ready",
          board: {
            cards: [{
              problemId: "problem-1",
              slug: "longest-substring-without-repeating-characters",
              title: "Longest Substring Without Repeating Characters",
              difficulty: "Medium",
              leetcodeNumber: 3,
              planItemId: null,
              lastOutcome: "failed",
              trapSummary: "The left boundary moved backward.",
              dueDate: null,
              priority: 1,
              primaryPatternTag: "sliding_window",
              hasFlashcard: true,
              flashcardStatus: "available",
              flashcard: {
                question: "How should left move?",
                answer: "It must never move backward.",
              },
            }],
          },
        },
      },
    }} />);

    expect(html).toContain("Replan");
    expect(html).toContain("Mistake book");
    expect(html).not.toContain("They never replace today&#x27;s required task.");
    expect(html).toContain("Optional review · not required task.");
    expect(html).toContain("Minimum Window Substring");
    expect(html).toContain("Struggled/unsolved 2 times · pass 2 week");
    expect(html).toContain("Open");
    expect(html).toContain("Accept");
    expect(html).toContain("Later");
    expect(html).not.toContain("Dismiss");
    expect(html).toContain("Common trap: The left boundary moved backward.");
    expect(html).toContain("Redo Review");
    expect(html).toContain("Open flashcard for Longest Substring Without Repeating Characters");
  });

  it("renders non-blocking Strategist status, candidate comparison, and disabled Calendar authorization", () => {
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      strategist: {
        status: "ready",
        routeRisk: { level: "attention", label: "后续路线需要关注", detail: "等待一个决定性选择。" },
        calendarConfigured: false,
        latestRun: {
          runId: "opaque-run-id",
          runMode: "proposal",
          status: "needs_clarification",
          statusLabel: "等待你的确认",
          resultKind: "clarification",
          requestSummary: "优先 Graph，并检查未来两天容量。",
          publicSummary: null,
          progress: [
            { key: "context", label: "读取路线和近期表现", state: "complete" },
            { key: "simulation", label: "模拟候选", state: "complete" },
            { key: "clarification", label: "等待澄清", state: "pending" },
          ],
          clarification: {
            question: "是否允许查询 Calendar 2026-08-06 至 2026-08-08 的 free/busy？",
            knownFacts: ["当前约束下模拟不可行。"],
            tradeoff: "保持当前上限，或确认一个可选松弛项。",
            calendarAuthorizationRequested: true,
            queryRange: { start: "2026-08-06", end: "2026-08-08" },
          },
          candidates: [{
            candidateId: "candidate-a",
            summary: "保留用户目标，降低系统目标优先级。",
            accepted: false,
            patchLegal: true,
            nodeChanges: ["图遍历：优先级调整为 80"],
            goalDepthChanges: [{ nodeName: "图遍历", goalDepth: "mastery" }],
            targetByDateChanges: [{ nodeName: "图遍历", targetByDate: "2026-08-20" }],
            dateBudgetSuggestions: [{ campaignDate: "2026-08-07", maxQuestions: 4, rationale: "仅在用户确认后考虑。" }],
            branches: [{
              branch: "conservative",
              violations: ["可用题目供给不足"],
              unknowns: ["近期样本不足"],
              projectedDates: ["2026-08-06"],
              earliestReachable: [{ nodeName: "图遍历", earliestEligibleDate: "2026-08-06", firstSelectedDate: null }],
              dayProjections: [{ campaignDate: "2026-08-06", budget: 3, phase: "learning", selectedNodeNames: [], risks: ["可用题目供给不足"], unknowns: ["近期样本不足"] }],
              horizonReachability: "unreachable",
            }],
          }],
          rejectedCandidates: [{ candidateId: "candidate-a", reasons: ["可用题目供给不足"] }],
          selectedCandidateId: null,
          externalDataAsOf: null,
          externalDataValidUntil: null,
          externalDataStale: false,
          errorCode: null,
          errorMessage: null,
          todayUnaffected: true,
        },
      },
    }} />);
    expect(html).toContain("Strategist");
    expect(html).toContain("Adjust future route");
    expect(html).toContain("Run what-if");
    expect(html).toContain("Simulation result");
    expect(html).not.toContain("Candidate comparison");
    expect(html).toContain("Patch valid");
    expect(html).toContain("Not reached");
    expect(html).toContain("Conservative path");
    expect(html).toContain("Calendar MCP is not configured");
    expect(html).toContain("Today unchanged");
    expect(html).toContain("View planning details");
    expect(html).not.toContain("opaque-run-id");
    expect(html.indexOf("Route Preview")).toBeLessThan(html.indexOf("Strategist"));
  });

  it("renders proactive empty and partial-failure states without hiding Today", () => {
    const empty = renderToStaticMarkup(<CampaignTodayClient initialView={today} />);
    expect(empty).toContain("No optional Replan recommendation is waiting.");
    expect(empty).toContain("No Review evidence needs priority attention.");
    expect(empty).toContain("Campaign Today");

    const partial = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      proactiveDashboard: {
        replan: { status: "unavailable", proposals: [], overflowRepairs: [] },
        reviewFocus: { status: "empty", board: { cards: [] } },
      },
    }} />);
    expect(partial).toContain("Replan is unavailable.");
    expect(partial).toContain("Try again");
    expect(partial).toContain("Campaign Today");
    expect(partial).toContain("Route Preview");
  });

  it("renders the empty state and roadmap status text accessibly", () => {
    const emptyHtml = renderToStaticMarkup(<CampaignTodayClient initialView={{ kind: "empty", displayName: "Iris" }} />);
    expect(emptyHtml).toContain("No Campaign has been created");
    expect(emptyHtml).toContain("Create Campaign");
    expect(emptyHtml).toContain('/campaign/onboarding');
    expect(emptyHtml).not.toContain("Target company");
    expect(emptyHtml).not.toContain("Hours per week");
    expect(emptyHtml).not.toContain("Back to Campaign Today");
    expect(emptyHtml).not.toContain("Open Workbench");
    const roadmap: CampaignRoadmapView = {
      kind: "campaign",
      displayName: "Iris",
      campaignLabel: "Campaign",
      campaignDate: "2026-08-03",
      timezone: "America/Chicago",
      phase: "coverage",
      phaseLabel: "覆盖学习",
      endDate: "2026-09-01",
      remainingDays: 29,
      masteredTransferableCount: 0,
      totalTransferableCount: 17,
      currentPrimaryNodeId: "N1",
      requiredDependencies: [],
      nonTransferablePool: [{ nodeId: "N3", nodeName: "模拟与边界处理", problemCount: 9, attemptedProblemCount: 0 }],
      recentSettlements: [],
      nodes: [{
        nodeId: "N1",
        nodeName: "原地数组与写指针",
        order: 1,
        status: "available",
        statusLabel: "可开始",
        masteryState: "learning",
        masteryHealth: "stable",
        latestPositiveStreak: 0,
        attemptedProblemCount: 0,
        neverSeenProblemCount: 9,
        completedProblems: 0,
        totalProblems: 9,
        masteryProgressCurrent: 0,
        masteryProgressRequired: 2,
        pendingRepairCount: 0,
        available: true,
        locked: false,
        recentSettlements: [],
        coreInvariant: "read/write",
        requiredPrerequisites: [],
        recommendedPrerequisites: [],
        lockedReason: null,
        current: true,
      }],
    };
    const html = renderToStaticMarkup(<CampaignRoadmap view={roadmap} />);
    expect(html).toContain("Campaign Roadmap");
    expect(html).toContain("Interactive Campaign dependency graph");
    expect(html).toContain("Available");
    expect(html).toContain("0 / 17");
    expect(html).toContain("Blind Spot Slots (Optional)");
    expect(html).toContain("N3");
    expect(html).toContain("NT");
    expect(html).toContain("Optional topics do not advance main-route mastery");
    expect(html).not.toContain("queueId");
  });

  it("renders stable, watch, reinforcement, and learning-with-repair as text, not color alone", () => {
    const roadmap: CampaignRoadmapView = {
      kind: "campaign",
      displayName: "Iris",
      campaignLabel: "Campaign",
      campaignDate: "2026-08-03",
      timezone: "America/Chicago",
      phase: "coverage",
      phaseLabel: "覆盖学习",
      endDate: "2026-09-01",
      remainingDays: 29,
      masteredTransferableCount: 3,
      totalTransferableCount: 17,
      currentPrimaryNodeId: "N4",
      requiredDependencies: [],
      nonTransferablePool: [],
      recentSettlements: [],
      nodes: [
        roadmapNode({ nodeId: "N1", status: "mastered_stable", statusLabel: "已掌握 · 稳定", masteryState: "mastered" }),
        roadmapNode({ nodeId: "N2", status: "mastered_watch", statusLabel: "已掌握 · 需关注", masteryState: "mastered", masteryHealth: "watch" }),
        roadmapNode({ nodeId: "N3", status: "mastered_needs_reinforcement", statusLabel: "已掌握 · 待补练", masteryState: "mastered", masteryHealth: "needs_reinforcement", pendingRepairCount: 1 }),
        roadmapNode({ nodeId: "N4", status: "learning", statusLabel: "学习中 · 有补练", pendingRepairCount: 1, current: true, recentSettlements: [{ problemTitle: "Jump Game II", slotRole: "target", slotRoleLabel: "靶向", outcome: "positive", selfRating: "easy", selfRatingLabel: "简单", evidenceLabel: "通过本地可见测试", settledAt: "2026-08-03T00:00:00.000Z" }] }),
        roadmapNode({ nodeId: "N5", status: "locked", statusLabel: "尚未解锁", locked: true, available: false, lockedReason: "需先掌握树的递归" }),
        roadmapNode({ nodeId: "N6", status: "learning", statusLabel: "学习中" }),
        roadmapNode({ nodeId: "N7", status: "not_included", statusLabel: "本战役未安排", masteryState: null, masteryHealth: null }),
      ],
    };
    const html = renderToStaticMarkup(<CampaignRoadmap view={roadmap} />);
    expect(html).toContain("Mastered");
    expect(html).toContain("Mastered · watch");
    expect(html).toContain("Recovery needed");
    expect(html).toContain("In progress · recovery");
    expect(html).toContain("Locked");
    expect(html).toContain("Available");
    expect(html).toContain("prerequisites required");
    expect(html).not.toContain("queueId");
    expect(html).not.toContain("settlementId");
  });

  it("renders accessible question-count onboarding without retired planning fields", () => {
    const html = renderToStaticMarkup(<CampaignOnboardingForm conflict={false} nodes={[{
      nodeId: "N1",
      name: "原地数组与写指针",
      mechanism: "维护读写边界",
      requiredPrerequisites: [],
    }]} />);
    expect(html).toContain("Preparation end date");
    expect(html).toContain("Daily task budget");
    expect(html).toContain("Python");
    expect(html).toContain("Time zone");
    expect(html).toContain("原地数组与写指针");
    expect(html).toContain("Create Campaign");
    expect(html).not.toContain("Target company");
    expect(html).not.toContain("Hours / week");
    expect(html).not.toContain("General FAANG");
  });

  it("renders a pending Patch banner without replacing Today content", () => {
    const withPatch: CampaignTodayView = {
      ...today,
      planning: {
        status: "pending_review",
        pendingPatch: {
          patchId: "patch-1",
          status: "pending",
          triggerLabel: "每周路线检查",
          rationale: "根据近期进度，小幅调整尚未开始的后续路线。",
          createdAt: "2026-08-03T15:00:00.000Z",
          baseVersion: 1,
          activeVersion: 1,
          isStale: false,
          operations: [{
            operationId: "op-001",
            operationType: "set_node_priority",
            title: "路线优先级",
            readableDescription: "提高「哈希与前缀聚合」的路线优先级。",
            affectedNodeIds: ["N2"],
            beforeValue: "3",
            afterValue: "80",
            warnings: [],
            selectable: true,
            selectedByDefault: true,
          }],
          warnings: [],
          impactSummary: { affectedNodeCount: 1, changesMixedWindowDays: false, currentDailyTaskUnaffected: true },
          dailyBudgetSuggestion: { currentBudget: 3, proposedBudget: 4, rationale: "只影响未来任务。" },
          externalDataAsOf: null,
          externalDataValidUntil: null,
          externalDataStale: false,
          rejectedCandidateReasons: [],
          canAccept: true,
          canPartiallyAccept: false,
          canReject: true,
        },
      },
    };
    const html = renderToStaticMarkup(<CampaignTodayClient initialView={withPatch} />);
    expect(html).toContain("Latest proposal");
    expect(html).toContain("A future-route proposal is awaiting review");
    expect(html).toContain("Route diff");
    expect(html).toContain("Daily budget suggestions");
    expect(html).toContain("Accept all");
    expect(html).toContain("Today&#x27;s materialized DailyTask is unchanged.");
    expect(html).toContain("Campaign Today");
    expect(html).not.toContain("patch-1");
  });

  it("keeps Today non-blocking while future-route checking is unavailable", () => {
    const checking = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      planning: { status: "checking", pendingPatch: null },
    }} />);
    expect(checking).toContain("Campaign Today");
    expect(checking).toContain("Route Preview");
    expect(checking).toContain("Strategist");
    const unavailable = renderToStaticMarkup(<CampaignTodayClient initialView={{
      ...today,
      planning: { status: "unavailable", pendingPatch: null },
    }} />);
    expect(unavailable).toContain("Campaign Today");
    expect(unavailable).toContain("Route Preview");
    expect(unavailable).toContain("Strategist");
  });
});
