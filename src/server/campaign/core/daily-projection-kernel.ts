import type {
  DailySelectorInput,
  CarryoverTaskItem,
  LearnerNodeStateProjection,
  ProblemAvailability,
  RepairQueueCandidate,
} from "../domain/contracts";
import { campaignDateSchema } from "../domain/contracts";
import type {
  DailyTaskProjectionOptions,
  DailyTaskProjectionState,
  ProjectedDailyTask,
  SerializableLearnerNodeState,
  SerializableProblemAvailability,
  SerializableRepairQueueCandidate,
} from "../domain/simulator-contracts";
import { selectDailyTask } from "./daily-selector";

function parseInstant(value: string | null | undefined, label: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC ISO-8601 instant`);
  }
  return parsed;
}

function parseRequiredInstant(value: string, label: string): Date {
  const parsed = parseInstant(value, label);
  if (!parsed) throw new Error(`${label} is required`);
  return parsed;
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains duplicate value: ${value}`);
    seen.add(value);
  }
}

export function serializeLearnerNodeState(
  state: LearnerNodeStateProjection,
): SerializableLearnerNodeState {
  return {
    ...state,
    unlockedAt: state.unlockedAt?.toISOString() ?? null,
    startedAt: state.startedAt?.toISOString() ?? null,
    masteredAt: state.masteredAt?.toISOString() ?? null,
    latestSettlementIds: [...state.latestSettlementIds],
  };
}

export function serializeRepairQueueCandidate(
  candidate: RepairQueueCandidate,
): SerializableRepairQueueCandidate {
  return { ...candidate, createdAt: candidate.createdAt.toISOString() };
}

export function serializeProblemAvailability(
  problem: ProblemAvailability,
): SerializableProblemAvailability {
  return {
    ...problem,
    eligibleRoles: [...problem.eligibleRoles],
    lastAttemptedAt: problem.lastAttemptedAt?.toISOString() ?? null,
  };
}

export function serializeCarryoverTaskItem(
  item: CarryoverTaskItem,
): CarryoverTaskItem {
  return { ...item };
}

export function deserializeLearnerNodeState(
  state: SerializableLearnerNodeState,
): LearnerNodeStateProjection {
  return {
    ...state,
    unlockedAt: parseInstant(state.unlockedAt, `${state.nodeId}.unlockedAt`),
    startedAt: parseInstant(state.startedAt, `${state.nodeId}.startedAt`),
    masteredAt: parseInstant(state.masteredAt, `${state.nodeId}.masteredAt`),
    latestSettlementIds: [...state.latestSettlementIds],
  };
}

export function deserializeProblemAvailability(
  problem: SerializableProblemAvailability,
): ProblemAvailability {
  return {
    ...problem,
    eligibleRoles: [...problem.eligibleRoles],
    lastAttemptedAt: parseInstant(
      problem.lastAttemptedAt,
      `${problem.problemSlug}.lastAttemptedAt`,
    ),
  };
}

/**
 * Shared Daily Selector kernel boundary. It reads no DB, clock, environment, or
 * uncontrolled randomness; every decision input is explicit JSON data.
 */
export function projectNextDailyTask(
  state: DailyTaskProjectionState,
  skeleton: DailySelectorInput["skeleton"],
  budget: number,
  campaignDate: string,
  options: DailyTaskProjectionOptions,
): ProjectedDailyTask {
  campaignDateSchema.parse(campaignDate);
  campaignDateSchema.parse(state.endDate);
  if (!Number.isInteger(options.selectorVersion) || options.selectorVersion < 1) {
    throw new Error("selectorVersion must be a positive integer");
  }
  assertUnique(state.learnerNodeStates.map((entry) => entry.nodeId), "learnerNodeStates");
  assertUnique(
    state.problemAvailability.map((entry) => entry.problemSlug),
    "problemAvailability",
  );
  assertUnique(
    state.repairQueueCandidates.map((entry) => entry.repairQueueItemId),
    "repairQueueCandidates",
  );
  assertUnique(
    (state.carryoverItems ?? []).map((entry) => entry.carryoverFromTaskItemId),
    "carryoverItems",
  );
  assertUnique(
    (state.existingDailyTasks ?? []).map((entry) => entry.campaignDate),
    "existingDailyTasks",
  );
  assertUnique(state.exposurePlanning?.satisfiedNodeIds ?? [], "exposurePlanning.satisfiedNodeIds");
  assertUnique(state.exposurePlanning?.pendingProbeNodeIds ?? [], "exposurePlanning.pendingProbeNodeIds");
  assertUnique(
    (state.acceptedDailyBudgetOverrides ?? []).map((entry) => entry.campaignDate),
    "acceptedDailyBudgetOverrides",
  );

  const effectiveBudget = resolveDailyTaskBudget(state, budget, campaignDate);

  return selectDailyTask({
    campaignId: state.campaignId,
    campaignDate,
    endDate: state.endDate,
    budget: effectiveBudget,
    skeleton,
    curriculum: state.curriculum,
    learnerNodeStates: state.learnerNodeStates.map(deserializeLearnerNodeState),
    repairQueueCandidates: state.repairQueueCandidates.map((candidate) => ({
      ...candidate,
      createdAt: parseRequiredInstant(
        candidate.createdAt,
        `${candidate.repairQueueItemId}.createdAt`,
      ),
    })),
    problemAvailability: state.problemAvailability.map(deserializeProblemAvailability),
    carryoverItems: state.carryoverItems?.map((item) => ({ ...item })),
    existingDailyTask:
      state.existingDailyTasks?.find((task) => task.campaignDate === campaignDate) ?? null,
    exposurePlanning: state.exposurePlanning ?? {
      skeletonVersion: skeleton.version,
      satisfiedNodeIds: [],
      pendingProbeNodeIds: [],
    },
    excludedNodeIds: options.excludedNodeIds,
    selectorVersion: options.selectorVersion,
  });
}

/** Accepted date state wins over the explicit campaign/default budget. */
export function resolveDailyTaskBudget(
  state: Pick<DailyTaskProjectionState, "acceptedDailyBudgetOverrides">,
  defaultBudget: number,
  campaignDate: string,
): number {
  if (!Number.isInteger(defaultBudget) || defaultBudget < 3) {
    throw new Error("Campaign daily budget must be an integer of at least 3");
  }
  const override = state.acceptedDailyBudgetOverrides?.find((entry) =>
    entry.campaignDate === campaignDate &&
    entry.status === "accepted" &&
    (!entry.expiresAt || entry.expiresAt.slice(0, 10) >= campaignDate),
  );
  if (!override) return defaultBudget;
  if (!Number.isInteger(override.maxQuestions) || override.maxQuestions < 3) {
    throw new Error("Accepted daily budget override must be an integer of at least 3");
  }
  return override.maxQuestions;
}
