import { afterEach, describe, expect, it, vi } from "vitest";
import { strategistDigest } from "@/server/campaign/domain";
import {
  CampaignCoreService,
  CampaignSkeletonPatchService,
  ProductionStrategistPlannerProvider,
  STRATEGIST_DAILY_RUN_LIMITS,
  checkCampaignStrategistDailyQuota,
  createStubStrategistProvider,
  executeVersionedCampaignStrategistRun,
  getCampaignStrategistRuntimeVersion,
  loadCampaignStrategistProductView,
  maybeEnqueueStrategistWake,
  requestCampaignStrategistProposal,
  requestCampaignStrategistSimulation,
  resumeCampaignStrategistRun,
  type ProductionStrategistTransport,
} from "@/server/campaign/services";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
const now = new Date("2026-08-05T15:00:00.000Z");
const campaignDate = "2026-08-05";

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture(handle: string) {
  const database = await createCampaignTestDb();
  cleanups.push(database.cleanup);
  const user = await database.prisma.user.create({ data: { handle } });
  const service = new CampaignCoreService(database.prisma, { now: () => now });
  const campaign = await service.materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate: "2026-10-30",
      dailyQuestionBudget: 3,
      language: "Python",
      timezone: "America/Chicago",
      selfReportedWeakNodes: ["N2"],
      preferredNodes: ["N4"],
    },
  });
  await service.getOrCreateDailyTask({ campaignId: campaign.id, campaignDate });
  return { ...database, user, campaign };
}

async function waitForStatus(db: Awaited<ReturnType<typeof createCampaignTestDb>>["prisma"], runId: string, statuses: string[]) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const run = await db.campaignStrategistRun.findUniqueOrThrow({ where: { id: runId } });
    if (statuses.includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run did not reach ${statuses.join(",")}.`);
}

function fakeTransport(outputs: unknown[]): ProductionStrategistTransport & { calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn(async () => ({
    content: JSON.stringify(outputs.shift()),
    responseModel: "fake-production-model",
    latencyMs: 2,
    inputTokens: 7,
    outputTokens: 3,
  }));
  return { complete: calls, calls };
}

const constraints = {
  schemaVersion: 1,
  hardConstraints: ["Today is immutable."],
  userGoals: [{ id: "user-n2", topic: "Hash Map", nodeId: "N2", priority: 90, requestedGoalDepth: "mastery" }],
  permissions: { calendarOptionalLookup: false },
  horizonEnd: "2026-10-30",
  dailyCaps: [],
  assumptions: [],
  scope: "future_route",
};

const brief = {
  schemaVersion: 1,
  objective: "Preserve the user goal and tune only the future route.",
  hardConstraints: ["Today is immutable."],
  softGoals: [
    { id: "system-n20", nodeId: "N20", source: "system", requestedGoalDepth: "mastery" },
    { id: "user-n2", nodeId: "N2", source: "user", requestedGoalDepth: "mastery" },
    { id: "campaign-goal-n4", nodeId: "N4", source: "user", requestedGoalDepth: "mastery" },
  ],
  assumptions: [{ id: "capacity", statement: "Observed capacity remains supported." }],
  degradationLadder: [
    { level: "L1", goalId: "system-n20", action: "remove_system_goal" },
    { level: "L2", goalId: "user-n2", action: "downgrade_user_goal_to_exposure" },
    { level: "L2", goalId: "campaign-goal-n4", action: "downgrade_user_goal_to_exposure" },
  ],
  candidateDimensions: ["future route priority"],
  stopCondition: "Finalize an accepted candidate or ask one decisive question.",
};

const candidate = {
  candidateId: "candidate-a",
  nodeOperations: [{ type: "set_node_priority", nodeId: "N2", priority: 90 }],
  goalDepth: [],
  targetByDate: [],
  dailyBudgetSuggestions: [],
  rationaleSummary: "Tune only a future system goal priority.",
};

async function immutableSnapshots(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    today: await f.prisma.campaignDailyTask.findUniqueOrThrow({ where: { campaignId_campaignDate: { campaignId: f.campaign.id, campaignDate } }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    campaign: await f.prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }),
    goal: await f.prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId: f.campaign.id } }),
    states: await f.prisma.campaignLearnerNodeState.findMany({ where: { campaignId: f.campaign.id }, orderBy: { nodeId: "asc" } }),
  };
}

describe("M4D1B2 production Runtime lifecycle", () => {
  it("routes new automatic wakes to plan-execute-v1 while unmarked runs remain legacy", async () => {
    const f = await fixture("m4d1b2-auto-routing");
    const transport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "request_clarification", question: "Keep the user goal at mastery?", knownFacts: ["N2 is user-sourced."], tradeoff: "Depth versus capacity." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const queued = await maybeEnqueueStrategistWake({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate, now,
      plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d1b2-auto-process" },
    });
    expect(queued.kind).toBe("queued");
    if (queued.kind !== "queued") throw new Error("Expected automatic production run.");
    const run = await waitForStatus(f.prisma, queued.run.id, ["needs_clarification"]);
    expect(getCampaignStrategistRuntimeVersion(run.runtimeStateJson)).toBe("plan-execute-v1");
    expect(JSON.parse(run.runtimeStateJson!)).toMatchObject({ runtimeVersion: "plan-execute-v1", runMode: "proposal", origin: "automatic" });
    expect(getCampaignStrategistRuntimeVersion(null)).toBe("legacy");
  });

  it("records the current candidate-resolution failure without creating a Patch", async () => {
    const f = await fixture("m4d1b2-user-runtime");
    const before = await immutableSnapshots(f);
    const marker = "PRIVATE_MODEL_SCRATCHPAD_MUST_NOT_PERSIST";
    const transport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "simulate_campaign_plan", candidates: [candidate] } },
      { action: { type: "finalize", candidateId: "candidate-a", finalSummary: "Create one pending future-route proposal." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const result = await requestCampaignStrategistProposal({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate,
      requestText: "Keep Hash Map mastery and review the future route.",
      now,
      plannerProvider: provider,
      constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d1b2-user-process" },
    });
    expect(result.kind).toBe("queued");
    if (result.kind !== "queued") throw new Error("Expected queued run.");
    const run = await waitForStatus(f.prisma, result.run.id, ["waiting_approval", "failed"]);
    const state = JSON.parse(run.runtimeStateJson!);
    expect(run).toMatchObject({ status: "failed", errorClass: "finalize_candidate_rejected" });
    expect(state).toMatchObject({ runtimeVersion: "plan-execute-v1", runMode: "proposal", origin: "user", selectedCandidateId: null });
    expect(state.strategyBrief.softGoals.filter((goal: { source: string }) => goal.source === "user").map((goal: { id: string }) => goal.id).sort()).toEqual(["user-n2"]);
    expect(state.providerAudit).toMatchObject({ modelCalls: 3, schemaRepairs: 0, inputTokens: 21, outputTokens: 9 });
    expect(transport.calls).toHaveBeenCalledTimes(3);
    expect(await f.prisma.campaignSkeletonPatch.count({ where: { campaignId: f.campaign.id } })).toBe(0);
    expect(await immutableSnapshots(f)).toEqual(before);
    const traces = await f.prisma.agentTraceEvent.findMany({ where: { traceRun: { userId: f.user.id } }, include: { payload: true } });
    const persisted = JSON.stringify({ run, traces });
    expect(persisted).not.toMatch(/rawOutput|chainOfThought|scratchpad/);
    expect(persisted).not.toContain(marker);
    expect(traces.every((event) => !event.payload || (event.payload.promptJson === null && event.payload.inputJson === null && event.payload.outputJson === null))).toBe(true);
  });

  it("keeps What-if and promotion failures read-only", async () => {
    const f = await fixture("m4d3-simulation-promotion");
    const before = await immutableSnapshots(f);
    const promotionCandidate = {
      ...candidate,
      dailyBudgetSuggestions: [{ campaignDate: "2026-08-06", maxQuestions: 3, rationale: "Scenario-only What-if cap." }],
    };
    const simulationTransport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "simulate_campaign_plan", candidates: [promotionCandidate] } },
      { action: { type: "finalize", candidateId: "candidate-a", finalSummary: "Complete the What-if without a Patch." } },
    ]);
    const simulationProvider = new ProductionStrategistPlannerProvider({ transport: simulationTransport, model: "fake-simulation" });
    const simulation = await requestCampaignStrategistSimulation({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate,
      requestText: "Do not change today's tasks; run a What-if where Graph remains mastery.", now,
      plannerProvider: simulationProvider, constraintExtractor: simulationProvider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d3-simulation" },
    });
    if (simulation.kind !== "queued") throw new Error("Expected queued simulation.");
    const simulated = await waitForStatus(f.prisma, simulation.run.id, ["no_change", "failed"]);
    expect(simulated).toMatchObject({ status: "failed", errorClass: "finalize_unknown_candidate" });
    expect(JSON.parse(simulated.runtimeStateJson!)).toMatchObject({ runMode: "simulation", selectedCandidateId: null });
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
    expect(await immutableSnapshots(f)).toEqual(before);

    const proposalTransport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "simulate_campaign_plan", candidates: [promotionCandidate] } },
      { action: { type: "finalize", candidateId: "candidate-a", finalSummary: "Create a fresh pending proposal after the What-if." } },
    ]);
    const proposalProvider = new ProductionStrategistPlannerProvider({ transport: proposalTransport, model: "fake-proposal" });
    const proposal = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate,
      requestText: "Create a fresh proposal based on the What-if result.", now: new Date(now.valueOf() + 1_000),
      plannerProvider: proposalProvider, constraintExtractor: proposalProvider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d3-proposal" },
    });
    if (proposal.kind !== "queued") throw new Error("Expected queued proposal.");
    const proposed = await waitForStatus(f.prisma, proposal.run.id, ["waiting_approval", "failed"]);
    expect(proposed.id).not.toBe(simulated.id);
    expect(JSON.parse(proposed.runtimeStateJson!)).toMatchObject({ runMode: "proposal" });
    expect(await f.prisma.campaignStrategistRun.count()).toBe(2);
    expect(proposed).toMatchObject({ status: "failed", errorClass: "finalize_unknown_candidate" });
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
    expect(await immutableSnapshots(f)).toEqual(before);
  });

  it("normalizes the real three-day DP What-if and simulates its actual caps and horizon", async () => {
    const f = await fixture("m4d3-dp-three-day-regression");
    const before = await immutableSnapshots(f);
    const transferableNodeIds = ["N1", "N2", "N4", "N7", "N8", "N9", "N10", "N11", "N12", "N13", "N14", "N15", "N16", "N17", "N18", "N19", "N20"];
    const dpConstraints = {
      ...constraints,
      userGoals: [
        { id: "goal-n19", topic: "Dynamic Programming", nodeId: "N19", priority: 100, requestedGoalDepth: "mastery" },
        { id: "goal-n20", topic: "Dynamic Programming", nodeId: "N20", priority: 90, requestedGoalDepth: "mastery" },
      ],
      horizonEnd: "2026-08-08",
      dailyCaps: ["2026-08-06", "2026-08-07", "2026-08-08"].map((date) => ({ campaignDate: date, maxQuestions: 3 })),
    };
    const routeSnapshotCandidate = {
      candidateId: "dp-three-day",
      nodeOperations: [
        ...transferableNodeIds.map((nodeId) => ({ type: "set_node_included", nodeId, included: true })),
        { type: "set_node_priority", nodeId: "N19", priority: 100 },
      ],
      goalDepth: transferableNodeIds.map((nodeId) => ({ nodeId, goalDepth: "mastery" })),
      targetByDate: [],
      dailyBudgetSuggestions: ["2026-08-06", "2026-08-07", "2026-08-08"].map((date) => ({ campaignDate: date, maxQuestions: 3, rationale: "Respect the explicit three-question cap." })),
      rationaleSummary: "Focus on N19 and N20 while Today remains unchanged.",
    };
    const transport = fakeTransport([
      dpConstraints,
      { strategyBrief: {
        ...brief,
        softGoals: [
          { id: "goal-n19", nodeId: "N19", source: "user", requestedGoalDepth: "mastery" },
          { id: "goal-n20", nodeId: "N20", source: "user", requestedGoalDepth: "mastery" },
          { id: "campaign-goal-n2", nodeId: "N2", source: "user", requestedGoalDepth: "mastery" },
          { id: "campaign-goal-n4", nodeId: "N4", source: "user", requestedGoalDepth: "mastery" },
        ],
        degradationLadder: [],
      }, action: { type: "simulate_campaign_plan", candidates: [routeSnapshotCandidate] } },
      { action: { type: "finalize", candidateId: "dp-three-day", finalSummary: "Complete the bounded DP What-if." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const simulation = await requestCampaignStrategistSimulation({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate,
      requestText: "模拟未来三天的学习路线，每天最多做 3 题。优先复习动态规划，不修改今天的任务，不查看日历。这次只做模拟，不生成正式提案。",
      now,
      plannerProvider: provider,
      constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d3-dp-three-day" },
    });
    if (simulation.kind !== "queued") throw new Error("Expected queued simulation.");
    const completed = await waitForStatus(f.prisma, simulation.run.id, ["no_change", "failed"]);
    expect(completed).toMatchObject({ status: "failed", errorClass: "finalize_unknown_candidate" });
    expect(JSON.parse(completed.runtimeStateJson!).candidates).toEqual([]);
    expect(await f.prisma.campaignSkeletonPatch.count({ where: { campaignId: f.campaign.id } })).toBe(0);
    expect(await immutableSnapshots(f)).toEqual(before);
  });

  it("runs the N19 priority and conditional N20 exposure What-if through Simulator", async () => {
    const f = await fixture("m4d3-n19-n20-structured-regression");
    const before = await immutableSnapshots(f);
    const repairTrigger = await f.prisma.campaignTaskItem.findFirstOrThrow({ where: { dailyTask: { campaignId: f.campaign.id } } });
    await f.prisma.campaignRepairQueueItem.create({ data: {
      campaignId: f.campaign.id,
      nodeId: "N7",
      triggerTaskItemId: repairTrigger.id,
      reason: "mastery_needs_reinforcement",
      priority: 100,
      status: "scheduled",
      updatedAt: now,
    } });
    const dpConstraints = {
      ...constraints,
      userGoals: [
        { id: "goal-n19-priority", topic: "一维 DP", nodeId: "N19", priority: 100, requestedGoalDepth: "mastery" },
        { id: "goal-n20-depth", topic: "多维 DP", nodeId: "N20", priority: 90, requestedGoalDepth: "mastery" },
      ],
      horizonEnd: "2026-08-08",
      dailyCaps: ["2026-08-06", "2026-08-07", "2026-08-08"].map((date) => ({ campaignDate: date, maxQuestions: 3 })),
    };
    const exactBrief = {
      ...brief,
      objective: "Raise N19 to the highest route priority and test N20 mastery within the three-day horizon.",
      softGoals: [
        { id: "sg1", nodeId: "N19", source: "user", requestedGoalDepth: "mastery" },
        { id: "sg2", nodeId: "N20", source: "user", requestedGoalDepth: "mastery" },
        { id: "sg3", nodeId: "N2", source: "user", requestedGoalDepth: "mastery" },
        { id: "sg4", nodeId: "N4", source: "user", requestedGoalDepth: "mastery" },
        { id: "sg5", nodeId: "N7", source: "system", requestedGoalDepth: "mastery" },
        { id: "sg6", nodeId: "N8", source: "system", requestedGoalDepth: "mastery" },
        { id: "sg7", nodeId: "N12", source: "system", requestedGoalDepth: "mastery" },
        { id: "sg8", nodeId: "N16", source: "system", requestedGoalDepth: "mastery" },
      ],
      degradationLadder: [],
    };
    const structurallyEquivalentCandidate = {
      candidateId: "n19-priority-n20-exposure",
      nodeOperations: [
        { type: "set_node_priority", nodeId: "N19", priority: 100 },
        { type: "move_node", nodeId: "N19", beforeNodeId: "N7" },
        { type: "set_node_priority", nodeId: "N7", priority: 90 },
        { type: "set_node_priority", nodeId: "N20", priority: 1 },
        { type: "set_goal_depth", nodeId: "N20", goalDepth: "EXPOSURE" },
      ],
      goalDepth: [],
      targetByDate: [],
      dailyBudgetSuggestions: ["2026-08-06", "2026-08-07", "2026-08-08"].map((date) => ({ campaignDate: date, maxQuestions: 3, rationale: "Respect the explicit cap." })),
      rationaleSummary: "Prioritize N19 and use the requested N20 fallback within the bounded horizon.",
    };
    const transport = fakeTransport([
      dpConstraints,
      { strategyBrief: exactBrief, action: { type: "simulate_campaign_plan", candidates: [structurallyEquivalentCandidate] } },
      { action: { type: "finalize", candidateId: "n19-priority-n20-exposure", finalSummary: "Complete the bounded What-if." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const simulation = await requestCampaignStrategistSimulation({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate,
      requestText: "模拟未来三天的路线，每天最多做 3 题。\n把 N19 一维 DP 提升到当前路线的最高优先级。\n如果 N20 无法在期限内达到 mastery，就把 N20 降为 exposure。\n不要修改今天的任务，不查看日历，只做 What-if。",
      now,
      plannerProvider: provider,
      constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d3-n19-n20" },
    });
    if (simulation.kind !== "queued") throw new Error("Expected queued simulation.");
    const completed = await waitForStatus(f.prisma, simulation.run.id, ["no_change", "failed"]);
    expect(completed).toMatchObject({ status: "failed", errorClass: "finalize_unknown_candidate" });
    expect(JSON.parse(completed.runtimeStateJson!).candidates).toEqual([]);
    expect(transport.calls).toHaveBeenCalledTimes(3);
    expect(await f.prisma.campaignSkeletonPatch.count({ where: { campaignId: f.campaign.id } })).toBe(0);
    expect(await immutableSnapshots(f)).toEqual(before);
    const view = await loadCampaignStrategistProductView({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, runId: completed.id, now });
    expect(view.latestRun?.resultKind).toBe("failed");
  });

  it("resumes the same clarification run without resetting consumed budgets or versions", async () => {
    const f = await fixture("m4d1b2-resume");
    const transport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "request_clarification", question: "Prefer mastery depth despite the capacity tradeoff?", knownFacts: ["N2 is user-sourced."], tradeoff: "Mastery depth versus a lighter exposure goal." } },
      { action: { type: "simulate_campaign_plan", candidates: [candidate] } },
      { action: { type: "finalize", candidateId: "candidate-a", finalSummary: "Apply the clarified future-route choice as pending." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const first = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate,
      requestText: "Plan the future route.", now, plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d1b2-clarify-first" },
    });
    if (first.kind !== "queued") throw new Error("Expected queued run.");
    const paused = await waitForStatus(f.prisma, first.run.id, ["needs_clarification"]);
    const pausedState = JSON.parse(paused.runtimeStateJson!);
    expect(pausedState).toMatchObject({ runtimeVersion: "plan-execute-v1", runMode: "proposal", budgetSnapshot: { plannerDecisions: { used: 1, limit: 4 }, clarification: { used: 1 } } });

    const resumed = await resumeCampaignStrategistRun({
      db: f.prisma, userId: f.user.id, runId: paused.id, answer: "Keep mastery.", now: new Date(now.valueOf() + 1_000),
      plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d1b2-clarify-resume" },
    });
    expect(resumed.kind).toBe("queued");
    const completed = await waitForStatus(f.prisma, paused.id, ["waiting_approval", "failed"]);
    expect(completed.id).toBe(paused.id);
    const completedState = JSON.parse(completed.runtimeStateJson!);
    expect(completedState).toMatchObject({
      runtimeVersion: "plan-execute-v1",
      runMode: "proposal",
      clarificationResponse: { answer: "Keep mastery." },
      budgetSnapshot: {
        plannerDecisions: { used: 3, limit: 6 },
        batchSimulations: { used: 1 },
        clarification: { used: 1 },
        ladderRevision: { used: 0 },
        proposalWrite: { used: 0 },
      },
    });
    expect(transport.calls).toHaveBeenCalledTimes(4);
    expect(await f.prisma.campaignStrategistRun.count()).toBe(1);
  });

  it("records an explicitly requested Calendar range on the same clarification run", async () => {
    const f = await fixture("m4d3-calendar-clarification");
    const transport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "request_clarification", question: "May I read Calendar free/busy from 2026-08-06 to 2026-08-08?", knownFacts: ["Only free/busy intervals are needed."], tradeoff: "Keep current caps or inspect an optional relaxation." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const first = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate,
      requestText: "Plan the future route and ask before any Calendar access.", now,
      plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d3-calendar-first" },
    });
    if (first.kind !== "queued") throw new Error("Expected queued run.");
    await waitForStatus(f.prisma, first.run.id, ["needs_clarification"]);
    const resumed = await resumeCampaignStrategistRun({
      db: f.prisma,
      userId: f.user.id,
      runId: first.run.id,
      answer: "Allow only the requested range.",
      calendarAuthorization: { decision: "allow", rangeStart: "2026-08-06T00:00:00.000Z", rangeEnd: "2026-08-08T00:00:00.000Z" },
      now: new Date(now.valueOf() + 1_000),
      plannerProvider: provider,
      constraintExtractor: provider,
      dispatchOptions: { schedule: () => undefined, processInstanceId: "m4d3-calendar-resume" },
    });
    expect(resumed.kind).toBe("queued");
    const stored = await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: first.run.id } });
    expect(JSON.parse(stored.runtimeStateJson!)).toMatchObject({
      runMode: "proposal",
      resolvedConstraints: {
        permissions: {
          calendarOptionalLookup: true,
          calendarAuthorizedRange: { start: "2026-08-06T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
        },
      },
    });
    expect(await f.prisma.campaignStrategistRun.count()).toBe(1);
  });

  it("allows only one concurrent clarification resume claim", async () => {
    const f = await fixture("m4d1b2-concurrent-resume");
    const transport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "request_clarification", question: "Keep mastery?", knownFacts: ["N2 is user-sourced."], tradeoff: "Depth versus capacity." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const first = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate, requestText: "Plan future route.", now,
      plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "resume-claim-first" },
    });
    if (first.kind !== "queued") throw new Error("Expected queued run.");
    await waitForStatus(f.prisma, first.run.id, ["needs_clarification"]);
    const scheduled: Array<() => void> = [];
    const attempts = await Promise.all([
      resumeCampaignStrategistRun({
        db: f.prisma, userId: f.user.id, runId: first.run.id, answer: "Keep mastery.", now: new Date(now.valueOf() + 1_000),
        plannerProvider: provider, constraintExtractor: provider,
        dispatchOptions: { schedule: (task) => { scheduled.push(task); }, processInstanceId: "resume-claim-a" },
      }),
      resumeCampaignStrategistRun({
        db: f.prisma, userId: f.user.id, runId: first.run.id, answer: "Keep mastery.", now: new Date(now.valueOf() + 1_000),
        plannerProvider: provider, constraintExtractor: provider,
        dispatchOptions: { schedule: (task) => { scheduled.push(task); }, processInstanceId: "resume-claim-b" },
      }),
    ]);
    expect(attempts.filter((entry) => entry.kind === "queued")).toHaveLength(1);
    expect(attempts.filter((entry) => entry.kind !== "queued")).toHaveLength(1);
    expect(scheduled).toHaveLength(1);
    expect(await f.prisma.backgroundJob.count({ where: { kind: "campaign_strategist" } })).toBe(2);
    expect(await f.prisma.campaignStrategistRun.count()).toBe(1);
  });

  it("stops a clarification resume when Skeleton freshness changed", async () => {
    const f = await fixture("m4d1b2-stale-resume");
    const transport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "request_clarification", question: "Keep mastery?", knownFacts: ["N2 is user-sourced."], tradeoff: "Depth versus capacity." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const first = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate, requestText: "Plan future route.", now,
      plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "stale-resume-first" },
    });
    if (first.kind !== "queued") throw new Error("Expected queued run.");
    await waitForStatus(f.prisma, first.run.id, ["needs_clarification"]);
    await f.prisma.campaign.update({ where: { id: f.campaign.id }, data: { activeSkeletonVersion: 2 } });
    const resumed = await resumeCampaignStrategistRun({
      db: f.prisma, userId: f.user.id, runId: first.run.id, answer: "Keep mastery.", now: new Date(now.valueOf() + 1_000),
      plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: () => undefined, processInstanceId: "stale-resume-second" },
    });
    expect(resumed.kind).toBe("stale");
    expect((await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: first.run.id } })).status).toBe("stale");
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
  });

  it("does not resume over a newly pending Patch", async () => {
    const f = await fixture("m4d1b2-pending-resume");
    const transport = fakeTransport([
      constraints,
      { strategyBrief: brief, action: { type: "request_clarification", question: "Keep mastery?", knownFacts: ["N2 is user-sourced."], tradeoff: "Depth versus capacity." } },
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport, model: "fake-production" });
    const first = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate, requestText: "Plan future route.", now,
      plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "pending-resume-first" },
    });
    if (first.kind !== "queued") throw new Error("Expected queued run.");
    await waitForStatus(f.prisma, first.run.id, ["needs_clarification"]);
    const existing = await new CampaignSkeletonPatchService(f.prisma, { now: () => new Date(now.valueOf() + 500) }).createSkeletonPatchProposal({
      userId: f.user.id,
      campaignId: f.campaign.id,
      proposal: { patchSchemaVersion: 1, baseVersion: 1, trigger: "fixture", rationale: "A different proposal arrived first.", operations: [{ type: "set_node_priority", nodeId: "N20", priority: 70 }] },
    });
    const resumed = await resumeCampaignStrategistRun({
      db: f.prisma, userId: f.user.id, runId: first.run.id, answer: "Keep mastery.", now: new Date(now.valueOf() + 1_000),
      plannerProvider: provider, constraintExtractor: provider,
      dispatchOptions: { schedule: () => undefined, processInstanceId: "pending-resume-second" },
    });
    expect(resumed.kind).toBe("pending_patch");
    expect((await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: first.run.id } }))).toMatchObject({ status: "no_change", errorClass: "pending_patch_exists" });
    expect(await f.prisma.campaignSkeletonPatch.findMany()).toEqual([expect.objectContaining({ id: existing.patch.id, status: "pending" })]);
    expect(transport.calls).toHaveBeenCalledTimes(2);
  });

  it("keeps daily quotas separate and makes fingerprint replay free", async () => {
    const f = await fixture("m4d1b2-quota");
    const schedule = () => undefined;
    const provider = new ProductionStrategistPlannerProvider({ transport: fakeTransport([]), model: "unused" });
    const first = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate, requestText: "User request 1", now,
      plannerProvider: provider, dispatchOptions: { schedule, processInstanceId: "quota-user" },
    });
    const replay = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate, requestText: "User request 1", now,
      plannerProvider: provider, dispatchOptions: { schedule, processInstanceId: "quota-user" },
    });
    expect(first.kind).toBe("queued");
    expect(replay.kind).toBe("already_exists");
    expect((await checkCampaignStrategistDailyQuota(f.prisma, { campaignId: f.campaign.id, campaignDate, origin: "user" })).used).toBe(1);

    const base = {
      campaignId: f.campaign.id,
      activeSkeletonVersion: 1,
      inputDigest: "a".repeat(64),
      wakeSnapshotJson: "{}",
      promptVersion: "v1",
      evaluatorVersion: "v1",
      provider: "fixture",
      modelAlias: "fixture",
      status: "failed",
    };
    for (const origin of ["automatic", "simulation"] as const) {
      const limit = STRATEGIST_DAILY_RUN_LIMITS[origin];
      for (let index = 0; index < limit; index += 1) {
        await f.prisma.campaignStrategistRun.create({ data: {
          ...base,
          trigger: `${origin}_${index}`,
          triggerFingerprint: strategistDigest({ origin, index }),
          runtimeStateJson: JSON.stringify({ runtimeVersion: "plan-execute-v1", runMode: origin === "simulation" ? "simulation" : "proposal", origin, campaignDate }),
        } });
      }
      expect(await checkCampaignStrategistDailyQuota(f.prisma, { campaignId: f.campaign.id, campaignDate, origin })).toEqual({ allowed: false, used: limit, limit });
    }
    const automatic = await maybeEnqueueStrategistWake({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate, now, plannerProvider: provider, dispatchOptions: { schedule, processInstanceId: "quota-auto" } });
    expect(automatic.kind).toBe("rate_limited");
  });

  it("creates a fresh run when the same request previously failed", async () => {
    const f = await fixture("m4d3-failed-fingerprint-retry");
    const schedule = () => undefined;
    const provider = new ProductionStrategistPlannerProvider({ transport: fakeTransport([]), model: "unused" });
    const first = await requestCampaignStrategistSimulation({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate,
      requestText: "Run the same What-if again after a provider failure.",
      now,
      plannerProvider: provider,
      dispatchOptions: { schedule, processInstanceId: "failed-retry-first" },
    });
    if (first.kind !== "queued") throw new Error("Expected the first simulation to queue.");
    await f.prisma.campaignStrategistRun.update({
      where: { id: first.run.id },
      data: { status: "failed", errorClass: "invalid_structured_output", completedAt: now },
    });
    const failedView = await loadCampaignStrategistProductView({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      runId: first.run.id,
      now,
    });
    expect(failedView).toMatchObject({
      routeRisk: { level: "attention", label: "Latest planning attempt incomplete", detail: "The active roadmap was not changed." },
      latestRun: { resultKind: "failed", errorCode: "invalid_structured_output" },
    });
    const retry = await requestCampaignStrategistSimulation({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate,
      requestText: "Run the same What-if again after a provider failure.",
      now: new Date(now.valueOf() + 1_000),
      plannerProvider: provider,
      dispatchOptions: { schedule, processInstanceId: "failed-retry-second" },
    });
    expect(retry.kind).toBe("queued");
    if (retry.kind !== "queued") throw new Error("Expected a fresh retry run.");
    expect(retry.run.id).not.toBe(first.run.id);
    expect(retry.run.triggerFingerprint).not.toBe(first.run.triggerFingerprint);

    const replay = await requestCampaignStrategistSimulation({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate,
      requestText: "Run the same What-if again after a provider failure.",
      now: new Date(now.valueOf() + 2_000),
      plannerProvider: provider,
      dispatchOptions: { schedule, processInstanceId: "failed-retry-replay" },
    });
    expect(replay).toMatchObject({ kind: "already_exists", run: { id: retry.run.id } });
  });

  it("does not fall back to the legacy provider after a production provider failure", async () => {
    const f = await fixture("m4d1b2-no-legacy-fallback");
    const failingTransport: ProductionStrategistTransport = { complete: vi.fn(async () => { throw new Error("provider timeout"); }) };
    const provider = new ProductionStrategistPlannerProvider({ transport: failingTransport, model: "failing-production" });
    const queued = await requestCampaignStrategistProposal({
      db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate, requestText: "Review future route.", now,
      plannerProvider: provider,
      dispatchOptions: { schedule: () => undefined, processInstanceId: "no-fallback-create" },
    });
    if (queued.kind !== "queued") throw new Error("Expected queued production run.");
    let legacyCalls = 0;
    const result = await executeVersionedCampaignStrategistRun({
      db: f.prisma,
      runId: queued.run.id,
      campaignDate,
      plannerProvider: provider,
      constraintExtractor: provider,
      legacyProvider: createStubStrategistProvider({ decision: "no_change", rationale: "Must not run." }, { onCall: () => { legacyCalls += 1; } }),
      now: () => now,
    });
    expect(result.kind).toBe("failed");
    expect(legacyCalls).toBe(0);
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
    expect(JSON.parse((await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: queued.run.id } })).runtimeStateJson!)).toMatchObject({
      providerAudit: { modelCalls: 1 },
      budgetSnapshot: { constraintExtraction: { used: 1 } },
    });
  });
});
