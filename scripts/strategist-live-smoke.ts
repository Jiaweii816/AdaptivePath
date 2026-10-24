import { strategistPlannerTurnSchema, strategistStrategyBriefSchema, type StrategistRuntimeContext, type StrategistRuntimeState } from "@/server/campaign/domain";
import { ProductionStrategistPlannerProvider, ProductionStrategistProviderError } from "@/server/campaign/services";

const smokeCase = process.env.STRATEGIST_SMOKE_CASE === "n19-n20" ? "n19-n20" : "ordinary-dp";
const requestText = smokeCase === "n19-n20"
  ? "模拟未来三天的路线，每天最多做 3 题。\n把 N19 一维 DP 提升到当前路线的最高优先级。\n如果 N20 无法在期限内达到 mastery，就把 N20 降为 exposure。\n不要修改今天的任务，不查看日历，只做 What-if。"
  : "模拟未来三天的学习路线，每天最多做 3 题。优先复习动态规划，不修改今天的任务，不查看日历。这次只做模拟，不生成正式提案。";

const context: StrategistRuntimeContext = {
  schemaVersion: 1,
  goal: {
    endDate: "2026-08-09",
    dailyQuestionBudget: 3,
    selfReportedWeakNodes: ["N19", "N20"],
    preferredNodes: [],
  },
  route: {
    version: 1,
    nodes: [
      { nodeId: "N19", priority: 1, included: true, goalDepth: "mastery", targetByDate: null },
      { nodeId: "N20", priority: 11, included: true, goalDepth: "mastery", targetByDate: null },
    ],
  },
  recentPerformance: [],
  repairSummary: { total: 0, top: [] },
  problemSupply: [
    { nodeId: "N19", remainingNeverSeenCount: 3, externallySeenCount: 0, cooldownAvailableCount: 3 },
    { nodeId: "N20", remainingNeverSeenCount: 3, externallySeenCount: 0, cooldownAvailableCount: 3 },
  ],
  planningHistory: [],
  externalPracticeSummary: { available: false, nodeCounts: [] },
  truncation: { truncated: false, droppedCounts: {} },
  contextDigest: "a".repeat(64),
};

const deterministicFacts = {
  todayTaskImmutable: true as const,
  activeCampaign: true,
  activeSkeletonVersion: 1,
  requiredEdges: [],
  campaignDailyQuestionBudget: 3,
  acceptedDateOverrides: [],
  planningHorizon: { start: "2026-08-06", end: "2026-08-09" },
  pendingPatchExists: false,
  nodeIds: ["N19" as const, "N20" as const],
  userId: "smoke-user",
  campaignId: "smoke-campaign",
};

function print(stage: string, status: "started" | "succeeded" | "failed", details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ stage, status, ...details }));
}

function safeFailure(stage: string, startedAt: number, error: unknown) {
  if (error instanceof ProductionStrategistProviderError) {
    print(stage, "failed", {
      safeErrorCode: error.diagnostic.safeErrorCode,
      schemaValidation: error.diagnostic.schemaIssuePaths,
      schemaIssues: error.diagnostic.schemaIssues,
      outputShape: error.diagnostic.outputShape,
      finishReason: error.diagnostic.finishReason,
      responseChars: error.diagnostic.responseChars,
      jsonFailureKind: error.diagnostic.jsonFailureKind,
      latencyMs: error.diagnostic.latencyMs || Date.now() - startedAt,
      providerStage: error.diagnostic.providerStage,
      httpStatus: error.diagnostic.httpStatus,
      modelName: error.diagnostic.modelName,
      endpointHost: error.diagnostic.endpointHost,
      timeoutType: error.diagnostic.timeoutType,
      responseEmpty: error.diagnostic.responseEmpty,
      repairAttempted: error.diagnostic.repairAttempted,
    });
  } else {
    print(stage, "failed", {
      safeErrorCode: error instanceof Error ? error.name : "unknown_error",
      schemaValidation: [],
      latencyMs: Date.now() - startedAt,
    });
  }
}

async function main() {
  const provider = new ProductionStrategistPlannerProvider();
  print("configuration", "succeeded", { modelName: provider.modelAlias, smokeCase });

  let startedAt = Date.now();
  print("constraint_extraction", "started");
  let extracted;
  try {
    extracted = await provider.extractConstraints({ context, requestText, deterministicFacts });
    print("constraint_extraction", "succeeded", {
      safeErrorCode: null,
      schemaValidation: [],
      latencyMs: extracted.audit.latencyMs,
      modelCalls: extracted.audit.modelCallCount,
      repairCalls: extracted.audit.schemaRepairCount,
    });
  } catch (error) {
    safeFailure("constraint_extraction", startedAt, error);
    process.exitCode = 1;
    return;
  }

  const state: StrategistRuntimeState = {
    schemaVersion: 1,
    runtimeVersion: "plan-execute-v1",
    runMode: "simulation",
    strategyBrief: null,
    resolvedConstraints: extracted.constraints,
    ladderState: { overturnedAssumptionIds: [] },
    ladderRevisionCount: 0,
    candidates: [],
    rejectedCandidates: [],
    observations: [],
    selectedCandidateId: null,
    budgetSnapshot: {
      constraintExtraction: { used: 1, limit: 1 },
      plannerDecisions: { used: 0, limit: 4 },
      batchSimulations: { used: 0, limit: 3 },
      calendarMcp: { used: 0, limit: 1 },
      clarification: { used: 0, limit: 1 },
      ladderRevision: { used: 0, limit: 1 },
      proposalWrite: { used: 0, limit: 1 },
    },
    clarification: null,
    status: "running",
    contextDigest: context.contextDigest,
    strategyBriefDigest: null,
  };

  startedAt = Date.now();
  print("strategy_brief", "started");
  print("first_planner_action", "started");
  try {
    const response = await provider.next({
      context,
      state,
      allowedActions: ["simulate_campaign_plan", "request_clarification", "finalize"],
    });
    const turn = strategistPlannerTurnSchema.parse(response.output);
    strategistStrategyBriefSchema.parse(turn.strategyBrief);
    print("strategy_brief", "succeeded", {
      safeErrorCode: null,
      schemaValidation: [],
      latencyMs: response.audit.latencyMs,
    });
    print("first_planner_action", "succeeded", {
      safeErrorCode: null,
      schemaValidation: [],
      latencyMs: response.audit.latencyMs,
      actionType: turn.action.type,
      modelCalls: response.audit.modelCallCount,
      repairCalls: response.audit.schemaRepairCount,
      candidateShape: turn.action.type === "simulate_campaign_plan"
        ? turn.action.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          nodeOperations: candidate.nodeOperations.map((operation) => ({ type: operation.type, ...(operation.type === "set_node_priority" ? { nodeId: operation.nodeId, priority: operation.priority } : "nodeId" in operation ? { nodeId: operation.nodeId } : {}) })),
          goalDepth: candidate.goalDepth,
          targetByDate: candidate.targetByDate,
          dailyBudgetCount: candidate.dailyBudgetSuggestions.length,
        }))
        : [],
    });
  } catch (error) {
    safeFailure("strategy_brief", startedAt, error);
    safeFailure("first_planner_action", startedAt, error);
    process.exitCode = 1;
  }
}

await main();
