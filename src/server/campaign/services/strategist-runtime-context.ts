import type { PrismaClient } from "@prisma/client";
import {
  STRATEGIST_PLANNING_HISTORY_LIMIT,
  STRATEGIST_RUNTIME_CONTEXT_MAX_CHARS,
  STRATEGIST_RUNTIME_NODE_LIMIT,
  STRATEGIST_RUNTIME_REPAIR_LIMIT,
  STRATEGIST_RUNTIME_SCHEMA_VERSION,
  canonicalStrategistJson,
  strategistDigest,
  type StrategistReadModel,
  type StrategistRuntimeContext,
} from "../domain";
import { buildStrategistReadModel } from "./strategist-read-model";

function assembleGoal(readModel: StrategistReadModel) {
  return readModel.campaign;
}

function assembleRoute(readModel: StrategistReadModel) {
  return {
    version: readModel.activeSkeleton.version,
    nodes: readModel.activeSkeleton.nodePlans.slice(0, STRATEGIST_RUNTIME_NODE_LIMIT),
  };
}

function assembleRecentPerformance(readModel: StrategistReadModel) {
  return readModel.recentReceipts;
}

function assembleRepairSummary(readModel: StrategistReadModel) {
  return {
    total: readModel.repairQueue.reduce((total, item) => total + item.accumulatedCount, 0),
    top: readModel.repairQueue.slice(0, STRATEGIST_RUNTIME_REPAIR_LIMIT),
  };
}

function assembleProblemSupply(readModel: StrategistReadModel) {
  return readModel.learnerNodes.slice(0, STRATEGIST_RUNTIME_NODE_LIMIT).map((node) => ({
    nodeId: node.nodeId,
    remainingNeverSeenCount: node.remainingNeverSeenCount,
    externallySeenCount: node.externallySeenCount,
    cooldownAvailableCount: node.cooldownAvailableCount,
  }));
}

function assemblePlanningHistory(
  readModel: StrategistReadModel,
  validatorRejections: readonly Readonly<{ errorClass: string; createdAt: string }>[],
) {
  return [
    ...readModel.planningHistory.map((entry) => ({ kind: "decision" as const, ...entry })),
    ...validatorRejections.map((entry) => ({ kind: "validator_rejection" as const, ...entry })),
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || canonicalStrategistJson(left).localeCompare(canonicalStrategistJson(right)))
    .slice(0, STRATEGIST_PLANNING_HISTORY_LIMIT);
}

function assembleExternalPracticeSummary(readModel: StrategistReadModel) {
  return {
    available: readModel.learnerNodes.some((node) => node.externallySeenCount > 0),
    nodeCounts: readModel.learnerNodes
      .filter((node) => node.externallySeenCount > 0)
      .map((node) => ({ nodeId: node.nodeId, count: node.externallySeenCount }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
  };
}

function boundedContext(sections: Omit<StrategistRuntimeContext, "contextDigest" | "truncation">) {
  const mutable = structuredClone(sections) as typeof sections & {
    route: { nodes: unknown[] };
    recentPerformance: unknown[];
    repairSummary: { total: number; top: unknown[] };
    problemSupply: unknown[];
    planningHistory: unknown[];
    externalPracticeSummary: { available: boolean; nodeCounts: unknown[] };
  };
  const droppedCounts: Record<string, number> = {};
  const arrays: Array<[string, unknown[]]> = [
    ["planningHistory", mutable.planningHistory],
    ["recentPerformance", mutable.recentPerformance],
    ["repairSummary.top", mutable.repairSummary.top],
    ["externalPracticeSummary.nodeCounts", mutable.externalPracticeSummary.nodeCounts],
    ["problemSupply", mutable.problemSupply],
    ["route.nodes", mutable.route.nodes],
  ];
  const serializedLength = () => canonicalStrategistJson({
    ...mutable,
    truncation: { truncated: Object.keys(droppedCounts).length > 0, droppedCounts },
    contextDigest: "0".repeat(64),
  }).length;
  while (serializedLength() > STRATEGIST_RUNTIME_CONTEXT_MAX_CHARS) {
    const target = arrays.find(([, values]) => values.length > 0);
    if (!target) throw new Error("Strategist fixed context cannot fit its hard character limit.");
    target[1].pop();
    droppedCounts[target[0]] = (droppedCounts[target[0]] ?? 0) + 1;
  }
  return {
    ...mutable,
    truncation: { truncated: Object.keys(droppedCounts).length > 0, droppedCounts },
  };
}

/** Every fixed section is assembled unconditionally; none is an agent-visible tool. */
export async function buildStrategistRuntimeContext(input: {
  db: PrismaClient;
  campaignId: string;
  campaignDate: string;
}): Promise<{ context: StrategistRuntimeContext; inputDigest: string }> {
  const [projection, validatorRuns] = await Promise.all([
    buildStrategistReadModel(input),
    input.db.campaignStrategistRun.findMany({
      where: {
        campaignId: input.campaignId,
        errorClass: { not: null },
        OR: [
          { errorClass: { contains: "validator" } },
          { errorClass: { contains: "policy" } },
          { errorClass: { contains: "invalid_patch" } },
        ],
      },
      select: { errorClass: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: STRATEGIST_PLANNING_HISTORY_LIMIT,
    }),
  ]);
  const bounded = boundedContext({
    schemaVersion: STRATEGIST_RUNTIME_SCHEMA_VERSION,
    goal: assembleGoal(projection.readModel),
    route: assembleRoute(projection.readModel),
    recentPerformance: assembleRecentPerformance(projection.readModel),
    repairSummary: assembleRepairSummary(projection.readModel),
    problemSupply: assembleProblemSupply(projection.readModel),
    planningHistory: assemblePlanningHistory(projection.readModel, validatorRuns.flatMap((run) => run.errorClass ? [{ errorClass: run.errorClass, createdAt: run.createdAt.toISOString() }] : [])),
    externalPracticeSummary: assembleExternalPracticeSummary(projection.readModel),
  });
  const contextDigest = strategistDigest(bounded);
  return {
    context: { ...bounded, contextDigest },
    inputDigest: projection.inputDigest,
  };
}
