import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import {
  storedCampaignSkeletonPatchOperationsSchema,
  strategistCandidateSchema,
  strategistDigest,
  strategistPlannerTurnSchema,
  strategistStrategyBriefSchema,
  type StrategistCandidate,
} from "@/server/campaign/domain";
import {
  CampaignSkeletonPatchService,
  ProductionStrategistPlannerProvider,
  ProductionStrategistProviderError,
  RouteReconciliationService,
  loadCampaignStrategistProductView,
  projectCampaignSkeleton,
  requestCampaignStrategistProposal,
  requestCampaignStrategistSimulation,
  type StrategistPlannerInput,
} from "@/server/campaign/services";

const expectedDatabaseUrl = "file:/tmp/patterncoach-strategist-final/campaign.db";
const campaignDate = "2026-08-06";
const now = new Date("2026-08-06T19:30:00.000Z");
const incidentRunId = "de1cef2d-74e7-494f-a4fc-9d037c94d194";
const requestText = "模拟未来三天的路线，每天最多做 3 题。\n把 N19 一维 DP 提升到当前路线的最高优先级。\n如果 N20 无法在期限内达到 mastery，就把 N20 降为 exposure。\n不要修改今天的任务，不查看日历，只做 What-if。";
const proposalText = `基于刚才的 What-if 结果重新规划未来路线：${requestText}`;

type RuntimeRecord = Record<string, unknown>;

function record(value: unknown): RuntimeRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RuntimeRecord : null;
}

function print(gate: string, status: "PASS" | "FAIL" | "INFO", details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ gate, status, ...details }));
}

function safeError(error: unknown) {
  if (error instanceof ProductionStrategistProviderError) {
    return {
      name: error.name,
      code: error.code,
      providerStage: error.diagnostic.providerStage,
      safeErrorCode: error.diagnostic.safeErrorCode,
      httpStatus: error.diagnostic.httpStatus,
      modelName: error.diagnostic.modelName,
      endpointHost: error.diagnostic.endpointHost,
      schemaIssuePaths: error.diagnostic.schemaIssuePaths,
      repairAttempted: error.diagnostic.repairAttempted,
    };
  }
  return {
    name: error instanceof Error ? error.name : "unknown_error",
    message: error instanceof Error ? error.message.slice(0, 500) : "Unknown failure.",
  };
}

class ObservedProductionStrategistProvider extends ProductionStrategistPlannerProvider {
  readonly plannerInputObservationCounts: number[] = [];
  readonly plannerActions: string[] = [];

  override async next(input: StrategistPlannerInput) {
    this.plannerInputObservationCounts.push(input.state.observations.length);
    const response = await super.next(input);
    this.plannerActions.push(strategistPlannerTurnSchema.parse(response.output).action.type);
    return response;
  }
}

async function waitForStatus(runId: string, statuses: readonly string[]) {
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    const run = await prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: runId } });
    if (statuses.includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Strategist run did not reach ${statuses.join(",")} before timeout.`);
}

async function snapshot(campaignId: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const [activeSkeleton, today, goal, learnerNodeState, settlements, repairQueue, patches, decisions] = await Promise.all([
    prisma.campaignSkeleton.findUniqueOrThrow({
      where: { campaignId_version: { campaignId, version: campaign.activeSkeletonVersion } },
      include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
    }),
    prisma.campaignDailyTask.findMany({
      where: { campaignId },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      orderBy: [{ campaignDate: "asc" }, { id: "asc" }],
    }),
    prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId } }),
    prisma.campaignLearnerNodeState.findMany({ where: { campaignId }, orderBy: [{ nodeId: "asc" }, { id: "asc" }] }),
    prisma.campaignTaskItemSettlement.findMany({
      where: { taskItem: { dailyTask: { campaignId } } },
      orderBy: [{ settledAt: "asc" }, { id: "asc" }],
    }),
    prisma.campaignRepairQueueItem.findMany({ where: { campaignId }, orderBy: [{ id: "asc" }] }),
    prisma.campaignSkeletonPatch.findMany({ where: { campaignId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.campaignSkeletonDecisionLog.findMany({ where: { campaignId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  return {
    activeVersion: campaign.activeSkeletonVersion,
    activeSkeleton,
    todayDigest: strategistDigest(today),
    skeletonDigest: strategistDigest(activeSkeleton),
    goalDigest: strategistDigest(goal),
    learnerNodeStateDigest: strategistDigest(learnerNodeState),
    masteryDigest: strategistDigest(learnerNodeState.map((state) => ({
      nodeId: state.nodeId,
      exposureState: state.exposureState,
      masteryState: state.masteryState,
      masteryHealth: state.masteryHealth,
      masteredAt: state.masteredAt,
      masteredBySettlementId: state.masteredBySettlementId,
      latestPositiveStreak: state.latestPositiveStreak,
      latestSettlementIdsJson: state.latestSettlementIdsJson,
    }))),
    settlementDigest: strategistDigest(settlements),
    repairDigest: strategistDigest(repairQueue),
    patches,
    decisions,
  };
}

function parseState(runtimeStateJson: string | null) {
  const parsed = record(JSON.parse(runtimeStateJson ?? "null"));
  assert(parsed, "Runtime state is missing or invalid.");
  return parsed;
}

function selectedCandidate(state: RuntimeRecord) {
  assert(typeof state.selectedCandidateId === "string", "Runtime did not select a candidate.");
  assert(Array.isArray(state.candidates), "Runtime candidate list is missing.");
  for (const entry of state.candidates) {
    const candidate = record(entry)?.candidate;
    const parsed = strategistCandidateSchema.safeParse(candidate);
    if (parsed.success && parsed.data.candidateId === state.selectedCandidateId) return parsed.data;
  }
  throw new Error("Selected candidate payload is missing.");
}

function operationSummary(candidate: StrategistCandidate) {
  return candidate.nodeOperations.map((operation) => {
    if (operation.type === "set_node_priority") return { type: operation.type, nodeId: operation.nodeId, priority: operation.priority };
    if (operation.type === "move_node") return { type: operation.type, nodeId: operation.nodeId, beforeNodeId: operation.beforeNodeId ?? null };
    return "nodeId" in operation ? { type: operation.type, nodeId: operation.nodeId } : { type: operation.type };
  });
}

function assertExpectedCandidate(candidate: StrategistCandidate) {
  assert.deepEqual(operationSummary(candidate), [
    { type: "set_node_priority", nodeId: "N19", priority: 100 },
    { type: "move_node", nodeId: "N19", beforeNodeId: "N7" },
  ]);
  assert.deepEqual(candidate.goalDepth, [{ nodeId: "N20", goalDepth: "exposure" }]);
  assert.equal(candidate.targetByDate.length, 0);
}

function providerAudit(state: RuntimeRecord) {
  return record(state.providerAudit) ?? {};
}

function simulatorCalls(state: RuntimeRecord) {
  return Number(record(record(state.budgetSnapshot)?.batchSimulations)?.used ?? 0);
}

function simulationObservations(state: RuntimeRecord) {
  return Array.isArray(state.observations)
    ? state.observations.map(record).filter((entry): entry is RuntimeRecord => entry?.type === "simulation")
    : [];
}

function assertPlanningUnchanged(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  assert.equal(after.todayDigest, before.todayDigest, "Today changed before approval.");
  assert.equal(after.skeletonDigest, before.skeletonDigest, "Active Skeleton changed before approval.");
  assert.equal(after.goalDigest, before.goalDigest, "Campaign Goal changed.");
  assert.equal(after.learnerNodeStateDigest, before.learnerNodeStateDigest, "LearnerNodeState changed.");
  assert.equal(after.masteryDigest, before.masteryDigest, "Mastery projection changed.");
  assert.equal(after.settlementDigest, before.settlementDigest, "Settlement changed.");
}

async function removeCopiedIncidentCollision(campaignId: string) {
  const incident = await prisma.campaignStrategistRun.findFirst({ where: { id: incidentRunId, campaignId } });
  if (!incident) return;
  const state = record(JSON.parse(incident.runtimeStateJson ?? "null"));
  assert.equal(record(state?.request)?.text, requestText, "Incident run does not contain the expected request.");
  assert.equal(incident.status, "no_change", "Incident run is not safely terminal in the copied database.");
  await prisma.campaignStrategistRun.delete({ where: { id: incident.id } });
  if (incident.backgroundJobId) {
    await prisma.backgroundJob.deleteMany({ where: { id: incident.backgroundJobId, status: "succeeded" } });
  }
}

async function main() {
  assert.equal(process.env.DATABASE_URL, expectedDatabaseUrl, `Set DATABASE_URL=${expectedDatabaseUrl}.`);
  assert.equal(process.env.PATTERNCOACH_MEMORY_ORIGIN, "development", "Set PATTERNCOACH_MEMORY_ORIGIN=development.");

  const copiedLearner = await prisma.user.findUniqueOrThrow({ where: { handle: "Iris904" } });
  const user = await prisma.user.update({
    where: { id: copiedLearner.id },
    data: { handle: `PatternCoachDevStrategistFinal-${randomUUID().slice(0, 8)}` },
  });
  const campaign = await prisma.campaign.findFirstOrThrow({ where: { userId: user.id, status: "active" } });
  await removeCopiedIncidentCollision(campaign.id);
  const before = await snapshot(campaign.id);
  assert.equal(before.patches.filter((patch) => patch.status === "pending").length, 0, "Fresh copied DB must not contain a pending Patch.");
  const originalN7 = before.activeSkeleton.nodePlans.find((plan) => plan.nodeId === "N7");
  assert(originalN7, "Active Skeleton does not contain N7.");

  const simulationProvider = new ObservedProductionStrategistProvider();
  const simulationRequest = await requestCampaignStrategistSimulation({
    db: prisma,
    userId: user.id,
    campaignId: campaign.id,
    campaignDate,
    requestText,
    now,
    plannerProvider: simulationProvider,
    constraintExtractor: simulationProvider,
    dispatchOptions: { schedule: (task) => task(), processInstanceId: `strategist-final-simulation-${randomUUID()}` },
  });
  assert.equal(simulationRequest.kind, "queued", `Gate 1 was not queued: ${simulationRequest.kind}`);
  if (simulationRequest.kind !== "queued") return;
  const simulationRun = await waitForStatus(simulationRequest.run.id, ["no_change", "failed", "needs_clarification", "budget_exhausted", "stale"]);
  const simulationState = parseState(simulationRun.runtimeStateJson);
  const simulationCandidate = selectedCandidate(simulationState);
  const observations = simulationObservations(simulationState);
  const gate1After = await snapshot(campaign.id);
  assert.equal(simulationRun.status, "no_change");
  assert.equal(simulationRun.errorClass, "simulation_mode_proposal_forbidden");
  assert.equal(simulationState.runtimeVersion, "plan-execute-v1");
  assert.equal(simulationState.runMode, "simulation");
  assert(strategistStrategyBriefSchema.safeParse(simulationState.strategyBrief).success, "StrategyBrief is invalid.");
  assertExpectedCandidate(simulationCandidate);
  assert.equal(simulatorCalls(simulationState), 1, "Simulator must run exactly once for the selected batch.");
  assert.equal(observations.length, 1, "Gate 1 must contain one Simulator Observation.");
  assert.equal(observations[0].accepted, true, "Simulator rejected the candidate.");
  assert(simulationProvider.plannerInputObservationCounts.some((count, index) => index > 0 && count > 0), "Observation was not returned to Provider.");
  assert.equal(simulationProvider.plannerActions.at(-1), "finalize", "Provider did not finalize after Observation.");
  assert.equal(gate1After.patches.filter((patch) => patch.status === "pending").length, before.patches.filter((patch) => patch.status === "pending").length);
  assertPlanningUnchanged(before, gate1After);
  const simulationView = await loadCampaignStrategistProductView({ db: prisma, userId: user.id, campaignId: campaign.id, runId: simulationRun.id, now });
  assert.equal(simulationView.latestRun?.resultKind, "simulation_complete");
  print("Gate 1", "PASS", {
    runId: simulationRun.id,
    runtimeVersion: simulationState.runtimeVersion,
    runMode: simulationState.runMode,
    providerCalls: providerAudit(simulationState).modelCalls,
    simulatorCalls: simulatorCalls(simulationState),
    candidateDiff: { nodeOperations: operationSummary(simulationCandidate), goalDepth: simulationCandidate.goalDepth },
    beforeDigest: { today: before.todayDigest, skeleton: before.skeletonDigest, mastery: before.masteryDigest },
    afterDigest: { today: gate1After.todayDigest, skeleton: gate1After.skeletonDigest, mastery: gate1After.masteryDigest },
  });

  const proposalProvider = new ObservedProductionStrategistProvider();
  const proposalRequest = await requestCampaignStrategistProposal({
    db: prisma,
    userId: user.id,
    campaignId: campaign.id,
    campaignDate,
    requestText: proposalText,
    now: new Date(now.valueOf() + 1_000),
    plannerProvider: proposalProvider,
    constraintExtractor: proposalProvider,
    dispatchOptions: { schedule: (task) => task(), processInstanceId: `strategist-final-proposal-${randomUUID()}` },
  });
  assert.equal(proposalRequest.kind, "queued", `Gate 2 was not queued: ${proposalRequest.kind}`);
  if (proposalRequest.kind !== "queued") return;
  const proposalRun = await waitForStatus(proposalRequest.run.id, ["waiting_approval", "failed", "needs_clarification", "budget_exhausted", "stale", "no_change"]);
  const proposalState = parseState(proposalRun.runtimeStateJson);
  const proposalCandidate = selectedCandidate(proposalState);
  assert.notEqual(proposalRun.id, simulationRun.id);
  assert.equal(parseState(simulationRun.runtimeStateJson).runMode, "simulation");
  assert.equal(proposalRun.status, "waiting_approval");
  assert.equal(proposalState.runtimeVersion, "plan-execute-v1");
  assert.equal(proposalState.runMode, "proposal");
  assertExpectedCandidate(proposalCandidate);
  assert(proposalRun.provider.startsWith("openai-compatible-strategist-runtime:"), "Proposal used a non-production or legacy provider.");
  assert(proposalRun.proposalPatchId, "Proposal run did not create a Patch.");
  const gate2After = await snapshot(campaign.id);
  const pending = gate2After.patches.filter((patch) => patch.status === "pending");
  assert.equal(pending.length, 1, "Gate 2 must create exactly one pending Patch.");
  assert.equal(pending[0].id, proposalRun.proposalPatchId);
  const storedOperations = storedCampaignSkeletonPatchOperationsSchema.parse(JSON.parse(pending[0].operationsJson)).operations;
  const patchDiff = storedOperations.map((operation) => Object.fromEntries(
    Object.entries(operation).filter(([key]) => key !== "operationId"),
  ));
  assert.deepEqual(patchDiff, [
    { type: "set_node_priority", nodeId: "N19", priority: 100 },
    { type: "move_node", nodeId: "N19", beforeNodeId: "N7" },
    { type: "set_goal_depth", nodeId: "N20", goalDepth: "exposure" },
  ]);
  assert.equal(pending[0].dailyBudgetSuggestionJson, null, "Pending Patch must not include a budget mutation.");
  assert.equal(gate2After.decisions.length, before.decisions.length, "Proposal was automatically approved.");
  assertPlanningUnchanged(before, gate2After);
  print("Gate 2", "PASS", {
    simulationRunId: simulationRun.id,
    proposalRunId: proposalRun.id,
    runMode: proposalState.runMode,
    providerCalls: providerAudit(proposalState).modelCalls,
    simulatorCalls: simulatorCalls(proposalState),
    patchId: pending[0].id,
    patchDiff,
    pendingPatchCount: pending.length,
  });

  const patchService = new CampaignSkeletonPatchService(prisma, { now: () => new Date(now.valueOf() + 2_000) });
  const applied = await patchService.acceptSkeletonPatch({
    userId: user.id,
    patchId: pending[0].id,
    actorType: "user",
    acceptDailyBudgetSuggestion: false,
    rationale: "Final server-side acceptance smoke.",
  });
  assert.equal(applied.kind, "applied");
  const afterApply = await snapshot(campaign.id);
  assert.equal(afterApply.activeVersion, before.activeVersion + 1);
  assert.equal(afterApply.patches.length, before.patches.length + 1);
  assert.equal(afterApply.patches.find((patch) => patch.id === pending[0].id)?.status, "accepted");
  const n19 = afterApply.activeSkeleton.nodePlans.find((plan) => plan.nodeId === "N19");
  const n20 = afterApply.activeSkeleton.nodePlans.find((plan) => plan.nodeId === "N20");
  const n7 = afterApply.activeSkeleton.nodePlans.find((plan) => plan.nodeId === "N7");
  assert(n19 && n20 && n7, "Applied Skeleton is missing N7/N19/N20.");
  assert.equal(n19.priority, 100);
  assert(n19.sortOrder < n7.sortOrder, "N19 was not moved before N7.");
  assert.equal(n20.goalDepth, "exposure");
  assert.deepEqual(
    { included: n7.included, priority: n7.priority, goalDepth: n7.goalDepth, targetWeek: n7.targetWeek, targetByDate: n7.targetByDate },
    { included: originalN7.included, priority: originalN7.priority, goalDepth: originalN7.goalDepth, targetWeek: originalN7.targetWeek, targetByDate: originalN7.targetByDate },
  );
  assert.equal(afterApply.todayDigest, before.todayDigest, "Today changed during approval.");
  assert.equal(afterApply.goalDigest, before.goalDigest, "Campaign Goal changed during approval.");
  assert.equal(afterApply.learnerNodeStateDigest, before.learnerNodeStateDigest, "LearnerNodeState changed during approval.");
  assert.equal(afterApply.masteryDigest, before.masteryDigest, "Mastery changed during approval.");
  assert.equal(afterApply.settlementDigest, before.settlementDigest, "Settlement changed during approval.");
  assert.equal(afterApply.decisions.filter((decision) => decision.patchId === pending[0].id).length, 1);

  const duplicate = await patchService.acceptSkeletonPatch({
    userId: user.id,
    patchId: pending[0].id,
    actorType: "user",
    acceptDailyBudgetSuggestion: false,
  });
  assert.equal(duplicate.kind, "already_decided");
  const afterDuplicate = await snapshot(campaign.id);
  assert.equal(afterDuplicate.activeVersion, afterApply.activeVersion);
  assert.equal(afterDuplicate.skeletonDigest, afterApply.skeletonDigest);
  assert.equal(afterDuplicate.decisions.filter((decision) => decision.patchId === pending[0].id).length, 1);
  assert.equal(afterDuplicate.patches.length, afterApply.patches.length);

  const reconciliation = new RouteReconciliationService(prisma);
  const reconciliationInput = {
    campaignId: campaign.id,
    resultingSkeleton: projectCampaignSkeleton(afterDuplicate.activeSkeleton),
    campaignDate,
    now: new Date(now.valueOf() + 3_000),
  };
  const firstReconciliation = await reconciliation.reconcile(reconciliationInput);
  const afterFirstReconciliation = await snapshot(campaign.id);
  const secondReconciliation = await reconciliation.reconcile(reconciliationInput);
  const final = await snapshot(campaign.id);
  assert.equal(afterFirstReconciliation.repairDigest, final.repairDigest, "Route reconciliation is not idempotent.");
  assert.equal(final.activeVersion, before.activeVersion + 1);
  assert.equal(final.patches.length, before.patches.length + 1, "Approval created a second proposal.");
  assert.equal(final.todayDigest, before.todayDigest);
  assert.equal(final.learnerNodeStateDigest, before.learnerNodeStateDigest);
  assert.equal(final.masteryDigest, before.masteryDigest);
  assert.equal(final.settlementDigest, before.settlementDigest);
  print("Gate 3", "PASS", {
    patchId: pending[0].id,
    patchStatus: final.patches.find((patch) => patch.id === pending[0].id)?.status,
    activeSkeletonVersionBefore: before.activeVersion,
    activeSkeletonVersionAfter: final.activeVersion,
    decisionLogCount: final.decisions.filter((decision) => decision.patchId === pending[0].id).length,
    duplicateApproval: duplicate.kind,
    reconciliation: { first: firstReconciliation, second: secondReconciliation, idempotent: true },
    afterDigest: { today: final.todayDigest, skeleton: final.skeletonDigest, mastery: final.masteryDigest },
  });

  const gate1Calls = Number(providerAudit(simulationState).modelCalls ?? 0);
  const gate2Calls = Number(providerAudit(proposalState).modelCalls ?? 0);
  print("summary", "PASS", {
    modelName: simulationProvider.modelAlias,
    providerCalls: gate1Calls + gate2Calls,
    simulatorCalls: simulatorCalls(simulationState) + simulatorCalls(proposalState),
    runIds: { simulation: simulationRun.id, proposal: proposalRun.id },
    patchId: pending[0].id,
  });
}

try {
  await main();
} catch (error) {
  print("summary", "FAIL", safeError(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
