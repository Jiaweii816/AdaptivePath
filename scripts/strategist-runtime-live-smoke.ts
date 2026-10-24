import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { loadLocalEnv } from "@/lib/env";
import { strategistDigest, strategistPlannerTurnSchema, strategistStrategyBriefSchema } from "@/server/campaign/domain";
import {
  CampaignCoreService,
  ProductionStrategistPlannerProvider,
  requestCampaignStrategistSimulation,
  type StrategistPlannerInput,
} from "@/server/campaign/services";

const expectedDatabaseUrl = "file:/tmp/patterncoach-strategist-debug/campaign.db";
const smokeCase = process.env.STRATEGIST_SMOKE_CASE === "n19-n20" ? "n19-n20" : "ordinary-dp";
const requestText = smokeCase === "n19-n20"
  ? "模拟未来三天的路线，每天最多做 3 题。\n把 N19 一维 DP 提升到当前路线的最高优先级。\n如果 N20 无法在期限内达到 mastery，就把 N20 降为 exposure。\n不要修改今天的任务，不查看日历，只做 What-if。"
  : "模拟未来三天的学习路线，每天最多做 3 题。\n优先复习动态规划，不修改今天的任务，不查看日历。\n这次只做模拟，不生成正式提案。";
const now = new Date("2026-08-06T18:00:00.000Z");
const campaignDate = "2026-08-06";

function print(stage: string, status: "started" | "succeeded" | "failed", details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ stage, status, ...details }));
}

async function snapshot(campaignId: string) {
  const [today, skeleton, goal, learnerNodeState, pendingPatches] = await Promise.all([
    prisma.campaignDailyTask.findMany({
      where: { campaignId },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      orderBy: [{ campaignDate: "asc" }, { id: "asc" }],
    }),
    prisma.campaignSkeleton.findMany({
      where: { campaignId },
      include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
      orderBy: [{ version: "asc" }, { id: "asc" }],
    }),
    prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId } }),
    prisma.campaignLearnerNodeState.findMany({ where: { campaignId }, orderBy: [{ nodeId: "asc" }, { id: "asc" }] }),
    prisma.campaignSkeletonPatch.count({ where: { campaignId, status: "pending" } }),
  ]);
  return {
    today: strategistDigest(today),
    skeleton: strategistDigest(skeleton),
    goal: strategistDigest(goal),
    learnerNodeState: strategistDigest(learnerNodeState),
    pendingPatches,
  };
}

async function waitForTerminal(runId: string) {
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    const run = await prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: runId } });
    if (["no_change", "failed", "needs_clarification", "budget_exhausted", "stale"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Strategist Runtime smoke timed out before reaching a terminal state.");
}

class ObservedProductionStrategistProvider extends ProductionStrategistPlannerProvider {
  readonly plannerInputObservationCounts: number[] = [];
  readonly plannerActionShapes: Array<Record<string, unknown>> = [];

  override async next(input: StrategistPlannerInput) {
    this.plannerInputObservationCounts.push(input.state.observations.length);
    const response = await super.next(input);
    const turn = strategistPlannerTurnSchema.parse(response.output);
    this.plannerActionShapes.push(turn.action.type === "simulate_campaign_plan"
      ? {
        type: turn.action.type,
        candidates: turn.action.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          nodeOperations: candidate.nodeOperations.map((operation) => ({ type: operation.type, ...(operation.type === "set_node_priority" ? { nodeId: operation.nodeId, priority: operation.priority } : "nodeId" in operation ? { nodeId: operation.nodeId } : {}) })),
          goalDepth: candidate.goalDepth,
          targetByDate: candidate.targetByDate,
          dailyBudgetSuggestions: candidate.dailyBudgetSuggestions.map((entry) => ({ campaignDate: entry.campaignDate, maxQuestions: entry.maxQuestions })),
        })),
      }
      : { type: turn.action.type });
    return response;
  }
}

async function main() {
  loadLocalEnv();
  if (process.env.DATABASE_URL !== expectedDatabaseUrl) {
    throw new Error(`This smoke requires DATABASE_URL=${expectedDatabaseUrl}.`);
  }
  if ((process.env.PATTERNCOACH_MEMORY_ORIGIN ?? "").trim() !== "development") {
    throw new Error("This smoke requires PATTERNCOACH_MEMORY_ORIGIN=development.");
  }

  const user = await prisma.user.create({ data: { handle: `StrategistSmoke-${randomUUID().slice(0, 8)}` } });
  const core = new CampaignCoreService(prisma, { now: () => now });
  const campaign = await core.materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate: smokeCase === "n19-n20" ? "2026-10-13" : "2026-09-30",
      dailyQuestionBudget: smokeCase === "n19-n20" ? 5 : 3,
      language: "Python",
      timezone: "America/Chicago",
      selfReportedWeakNodes: smokeCase === "n19-n20" ? ["N7", "N8", "N12", "N16", "N20"] : ["N19", "N20"],
      preferredNodes: smokeCase === "n19-n20" ? ["N7", "N12", "N16"] : ["N19", "N20"],
    },
  });
  await core.getOrCreateDailyTask({ campaignId: campaign.id, campaignDate });
  const before = await snapshot(campaign.id);
  const provider = new ObservedProductionStrategistProvider();

  print("runtime_simulation", "started", {
    runtimeVersion: "plan-execute-v1",
    runMode: "simulation",
    modelName: provider.modelAlias,
    smokeCase,
  });
  const queued = await requestCampaignStrategistSimulation({
    db: prisma,
    userId: user.id,
    campaignId: campaign.id,
    campaignDate,
    requestText,
    now,
    plannerProvider: provider,
    constraintExtractor: provider,
    dispatchOptions: {
      schedule: (task) => task(),
      processInstanceId: `strategist-live-smoke-${randomUUID()}`,
    },
  });
  if (queued.kind !== "queued") throw new Error(`Strategist Runtime was not queued: ${queued.kind}`);

  const run = await waitForTerminal(queued.run.id);
  const state = JSON.parse(run.runtimeStateJson ?? "null") as Record<string, unknown> | null;
  const candidates = Array.isArray(state?.candidates) ? state.candidates : [];
  const observations = Array.isArray(state?.observations) ? state.observations as Array<Record<string, unknown>> : [];
  const simulationObservations = observations.filter((entry) => entry.type === "simulation");
  const strategyBrief = strategistStrategyBriefSchema.safeParse(state?.strategyBrief);
  const after = await snapshot(campaign.id);
  const providerAudit = state?.providerAudit && typeof state.providerAudit === "object"
    ? state.providerAudit as Record<string, unknown>
    : {};
  const observationFedBack = provider.plannerInputObservationCounts.some((count, index) => index > 0 && count > 0);
  const unchanged = {
    today: before.today === after.today,
    skeleton: before.skeleton === after.skeleton,
    goal: before.goal === after.goal,
    learnerNodeState: before.learnerNodeState === after.learnerNodeState,
  };
  const simulationComplete = run.status === "no_change"
    && run.errorClass === "simulation_mode_proposal_forbidden"
    && state?.runtimeVersion === "plan-execute-v1"
    && state?.runMode === "simulation"
    && strategyBrief.success
    && candidates.length > 0
    && simulationObservations.length > 0
    && observationFedBack
    && after.pendingPatches === before.pendingPatches
    && after.pendingPatches === 0
    && Object.values(unchanged).every(Boolean);

  print("runtime_simulation", simulationComplete ? "succeeded" : "failed", {
    safeErrorCode: simulationComplete ? null : run.errorClass ?? `unexpected_status_${run.status}`,
    runStatus: run.status,
    completionKind: run.errorClass === "simulation_mode_proposal_forbidden" ? "simulation_complete" : null,
    runtimeVersion: state?.runtimeVersion ?? null,
    runMode: state?.runMode ?? null,
    strategyBriefValid: strategyBrief.success,
    candidateCount: candidates.length,
    simulatorObservationCount: simulationObservations.length,
    plannerInputObservationCounts: provider.plannerInputObservationCounts,
    plannerActionShapes: provider.plannerActionShapes,
    observationFedBack,
    pendingPatchBefore: before.pendingPatches,
    pendingPatchAfter: after.pendingPatches,
    unchanged,
    modelName: provider.modelAlias,
    modelCalls: providerAudit.modelCalls ?? null,
    schemaRepairs: providerAudit.schemaRepairs ?? null,
    latencyMs: providerAudit.latencyMs ?? run.latencyMs,
  });
  if (!simulationComplete) process.exitCode = 1;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
