import type { LearnerNodeStateProjection, SettlementProjection } from "../domain/contracts";
import { campaignDateSchema } from "../domain/contracts";
import type {
  CampaignPlanSimulationCandidate,
  CampaignSimulationBranch,
  CampaignSimulationBranchResult,
  CampaignSimulationResult,
  CampaignSimulationState,
  CampaignSimulationUnknown,
  CampaignSimulationViolation,
  EarliestReachableDate,
  InternalDayProjection,
  ObservedPaceInput,
  SerializableLearnerNodeState,
  SerializableProblemAvailability,
  SerializableRepairQueueCandidate,
  SerializableSettlementProjection,
  SimulateCampaignPlanInput,
  SimulationPaceAssessment,
} from "../domain/simulator-contracts";
import { deriveRepairQueueDecision } from "./repair-queue-policy";
import { reduceLearnerNodeState } from "./mastery-reducer";
import { resolveUnlockedNodes } from "./unlock-resolver";
import {
  deserializeLearnerNodeState,
  projectNextDailyTask,
  resolveDailyTaskBudget,
  serializeLearnerNodeState,
} from "./daily-projection-kernel";

function addCampaignDays(value: string, days: number): string {
  campaignDateSchema.parse(value);
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function campaignInstant(value: string, endOfDay = false): string {
  return `${value}T${endOfDay ? "23:59:59.000" : "00:00:00.000"}Z`;
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains duplicate value: ${value}`);
    seen.add(value);
  }
}

function validateObservedPace(value: ObservedPaceInput): void {
  if (!Number.isInteger(value.sampleDays) || value.sampleDays < 0) {
    throw new Error("observedPace.sampleDays must be a non-negative integer");
  }
  if (value.observedCapacityRange) {
    const { min, max } = value.observedCapacityRange;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
      throw new Error("observedPace.observedCapacityRange must be an ordered integer range");
    }
  }
  assertUnique(
    value.supportedPositiveItemsByDate.map((entry) => entry.campaignDate),
    "observedPace.supportedPositiveItemsByDate",
  );
  for (const outcome of value.supportedPositiveItemsByDate) {
    campaignDateSchema.parse(outcome.campaignDate);
    if (!Number.isInteger(outcome.positiveItemCount) || outcome.positiveItemCount < 0) {
      throw new Error("Observed positiveItemCount must be a non-negative integer");
    }
    if (
      value.observedCapacityRange &&
      outcome.positiveItemCount > value.observedCapacityRange.max
    ) {
      throw new Error("Observed positiveItemCount must stay inside the observed range");
    }
  }
}

function assessPace(
  observed: ObservedPaceInput,
  campaignDate: string,
  plannedCapacity: number,
): SimulationPaceAssessment {
  if (observed.sampleDays < 3 || !observed.observedCapacityRange) {
    return {
      date: campaignDate,
      plannedCapacity,
      observedCapacityRange: observed.observedCapacityRange,
      sampleDays: observed.sampleDays,
      assessment: "unknown",
      reason: "insufficient_sample",
    };
  }
  if (
    plannedCapacity < observed.observedCapacityRange.min ||
    plannedCapacity > observed.observedCapacityRange.max
  ) {
    return {
      date: campaignDate,
      plannedCapacity,
      observedCapacityRange: observed.observedCapacityRange,
      sampleDays: observed.sampleDays,
      assessment: "unknown",
      reason: "out_of_observed_range",
    };
  }
  if (
    !observed.supportedPositiveItemsByDate.some(
      (outcome) => outcome.campaignDate === campaignDate,
    )
  ) {
    return {
      date: campaignDate,
      plannedCapacity,
      observedCapacityRange: observed.observedCapacityRange,
      sampleDays: observed.sampleDays,
      assessment: "unknown",
      reason: "missing_supported_outcome",
    };
  }
  return {
    date: campaignDate,
    plannedCapacity,
    observedCapacityRange: observed.observedCapacityRange,
    sampleDays: observed.sampleDays,
    assessment: "supported",
    reason: "within_observed_range",
  };
}

function unknownForAssessment(
  assessment: SimulationPaceAssessment,
): CampaignSimulationUnknown | null {
  if (
    assessment.assessment === "supported" ||
    assessment.reason === "within_observed_range"
  ) return null;
  return {
    code: assessment.reason,
    campaignDate: assessment.date,
    message:
      assessment.reason === "insufficient_sample"
        ? "Fewer than three observed days; the observed-supported outcome remains unknown."
        : assessment.reason === "out_of_observed_range"
          ? "Planned capacity is outside the observed range and was not extrapolated."
          : "No directly observed positive-item count supports this branch outcome.",
  };
}

function deserializeSettlement(
  settlement: SerializableSettlementProjection,
): SettlementProjection {
  const settledAt = new Date(settlement.settledAt);
  if (
    Number.isNaN(settledAt.valueOf()) ||
    settledAt.toISOString() !== settlement.settledAt
  ) {
    throw new Error(
      `${settlement.settlementId}.settledAt must be a canonical UTC ISO-8601 instant`,
    );
  }
  return { ...settlement, settledAt };
}

function cloneNodeState(state: SerializableLearnerNodeState): SerializableLearnerNodeState {
  return { ...state, latestSettlementIds: [...state.latestSettlementIds] };
}

function cloneProblem(
  problem: SerializableProblemAvailability,
): SerializableProblemAvailability {
  return { ...problem, eligibleRoles: [...problem.eligibleRoles] };
}

function inputHistoryUnknowns(
  state: CampaignSimulationState,
): CampaignSimulationUnknown[] {
  const settlementIds = new Set(state.settlements.map((entry) => entry.settlementId));
  return state.learnerNodeStates.flatMap((node): CampaignSimulationUnknown[] => {
    const missingLearningHistory =
      node.latestPositiveStreak > 0 &&
      (node.latestSettlementIds.length === 0 ||
        node.latestSettlementIds.some((settlementId) => !settlementIds.has(settlementId)));
    const missingMasteryHistory =
      node.masteryState === "mastered" &&
      Boolean(node.masteredBySettlementId) &&
      !settlementIds.has(node.masteredBySettlementId!);
    if (!missingLearningHistory && !missingMasteryHistory) {
      return [];
    }
    return [{
      code: "incomplete_settlement_history",
      nodeId: node.nodeId,
      message: `Full settlement history is unavailable for ${node.nodeId}; no existing streak is extrapolated.`,
    }];
  });
}

function initialReachability(
  state: CampaignSimulationState,
  candidate: CampaignPlanSimulationCandidate,
  startCampaignDate: string,
): Map<string, EarliestReachableDate> {
  const stateByNode = new Map(state.learnerNodeStates.map((entry) => [entry.nodeId, entry]));
  const included = new Set(
    candidate.skeleton.nodePlans.filter((plan) => plan.included).map((plan) => plan.nodeId),
  );
  return new Map(
    state.curriculum.graph.nodes.map((node) => {
      const nodeState = stateByNode.get(node.nodeId);
      const unlockedDate = nodeState?.unlockedAt?.slice(0, 10) ?? null;
      const earliestEligibleDate = node.kind === "non_transferable"
        ? startCampaignDate
        : !included.has(node.nodeId)
          ? null
          : unlockedDate && unlockedDate > startCampaignDate
            ? unlockedDate
            : unlockedDate
              ? startCampaignDate
              : null;
      return [node.nodeId, {
        nodeId: node.nodeId,
        earliestEligibleDate,
        firstSelectedDate: null,
      }];
    }),
  );
}

function outcomeKinds(input: {
  branch: CampaignSimulationBranch;
  itemCount: number;
  assessment: SimulationPaceAssessment;
  observedPace: ObservedPaceInput;
}): ("positive" | "negative" | "neutral")[] {
  if (input.branch === "optimistic") {
    return Array.from({ length: input.itemCount }, () => "positive" as const);
  }
  if (input.branch === "conservative") {
    return Array.from({ length: input.itemCount }, () => "negative" as const);
  }
  const supportedOutcome = input.observedPace.supportedPositiveItemsByDate.find(
    (outcome) => outcome.campaignDate === input.assessment.date,
  );
  const supportedCount = input.assessment.assessment === "supported"
    ? Math.min(supportedOutcome?.positiveItemCount ?? 0, input.itemCount)
    : 0;
  return Array.from(
    { length: input.itemCount },
    (_, index) => index < supportedCount ? "positive" as const : "neutral" as const,
  );
}

function addRepairCandidate(input: {
  repairs: SerializableRepairQueueCandidate[];
  candidateId: string;
  branch: CampaignSimulationBranch;
  campaignDate: string;
  itemOrder: number;
  nodeId: string;
  reason: string;
  priority: number;
}): void {
  input.repairs.push({
    repairQueueItemId: [
      "sim-repair",
      input.candidateId,
      input.branch,
      input.campaignDate,
      input.itemOrder,
      input.reason,
    ].join(":"),
    nodeId: input.nodeId,
    priority: input.priority,
    createdAt: campaignInstant(input.campaignDate, true),
  });
}

function runBranch(input: {
  simulation: SimulateCampaignPlanInput;
  candidate: CampaignPlanSimulationCandidate;
  branch: CampaignSimulationBranch;
  dates: readonly string[];
  historyUnknowns: readonly CampaignSimulationUnknown[];
}): CampaignSimulationBranchResult {
  let nodeStates = input.simulation.state.learnerNodeStates.map(cloneNodeState);
  let repairs = input.simulation.state.repairQueueCandidates.map((entry) => ({ ...entry }));
  let problems = input.simulation.state.problemAvailability.map(cloneProblem);
  const exposureSatisfied = new Set(
    input.simulation.state.exposurePlanning?.skeletonVersion === input.candidate.skeleton.version
      ? input.simulation.state.exposurePlanning.satisfiedNodeIds
      : [],
  );
  const exposurePending = new Set(
    input.simulation.state.exposurePlanning?.skeletonVersion === input.candidate.skeleton.version
      ? input.simulation.state.exposurePlanning.pendingProbeNodeIds
      : [],
  );
  const settlements = input.simulation.state.settlements.map((entry) => ({ ...entry }));
  const reachability = initialReachability(
    input.simulation.state,
    input.candidate,
    input.simulation.startCampaignDate,
  );
  const allViolations: CampaignSimulationViolation[] = [];
  const allUnknowns: CampaignSimulationUnknown[] = [...input.historyUnknowns];
  const incompleteHistoryNodeIds = new Set(
    input.historyUnknowns.flatMap((unknown) =>
      unknown.code === "incomplete_settlement_history" && unknown.nodeId
        ? [unknown.nodeId]
        : [],
    ),
  );
  const days: InternalDayProjection[] = [];
  const cooldownDays = input.simulation.options.internalCooldownDays;

  for (let dayIndex = 0; dayIndex < input.dates.length; dayIndex += 1) {
    const campaignDate = input.dates[dayIndex];
    const budget = resolveDailyTaskBudget(
      input.simulation.state,
      input.simulation.dailyBudgets[dayIndex],
      campaignDate,
    );
    const nextCampaignDate = addCampaignDays(campaignDate, 1);
    const assessment = assessPace(input.simulation.observedPace, campaignDate, budget);
    const dayUnknowns: CampaignSimulationUnknown[] = [];
    if (input.branch === "observed_supported") {
      const assessmentUnknown = unknownForAssessment(assessment);
      if (assessmentUnknown) {
        dayUnknowns.push(assessmentUnknown);
        allUnknowns.push(assessmentUnknown);
      }
    }

    const preOutcomeStateByNode = new Map(nodeStates.map((entry) => [entry.nodeId, entry]));
    const projection = projectNextDailyTask(
      {
        ...input.simulation.state,
        learnerNodeStates: nodeStates,
        repairQueueCandidates: repairs,
        problemAvailability: problems,
        exposurePlanning: {
          skeletonVersion: input.candidate.skeleton.version,
          satisfiedNodeIds: [...exposureSatisfied],
          pendingProbeNodeIds: [...exposurePending],
        },
      },
      input.candidate.skeleton,
      budget,
      campaignDate,
      {
        excludedNodeIds: input.candidate.excludedNodeIds,
        selectorVersion: input.simulation.options.selectorVersion,
      },
    );
    const items = projection.kind === "task" ? projection.items : [];
    const outcomes = outcomeKinds({
      branch: input.branch,
      itemCount: items.length,
      assessment,
      observedPace: input.simulation.observedPace,
    });
    const dayViolations: CampaignSimulationViolation[] = [];
    const newlyMasteredNodeIds = new Set<string>();

    if (projection.kind === "task") {
      if (projection.primaryNodeId) {
        nodeStates = nodeStates.map((state) =>
          state.nodeId === projection.primaryNodeId && !state.startedAt
            ? { ...state, startedAt: campaignInstant(campaignDate) }
            : state,
        );
      }
      const scheduledRepairs = new Set(projection.scheduledRepairQueueItemIds);
      repairs = repairs.filter((repair) => !scheduledRepairs.has(repair.repairQueueItemId));

      for (const item of items) {
        const currentReachability = reachability.get(item.nodeId);
        if (currentReachability && !currentReachability.firstSelectedDate) {
          reachability.set(item.nodeId, {
            ...currentReachability,
            firstSelectedDate: campaignDate,
          });
        }
        const requiredEdges = input.simulation.state.curriculum.graph.edges.filter(
          (edge) => edge.type === "required" && edge.toNodeId === item.nodeId,
        );
        if (
          requiredEdges.length > 0 &&
          !preOutcomeStateByNode.get(item.nodeId)?.unlockedAt &&
          requiredEdges.some(
            (edge) =>
              preOutcomeStateByNode.get(edge.fromNodeId)?.masteryState !== "mastered",
          )
        ) {
          dayViolations.push({
            code: "required_edge_violation",
            campaignDate,
            nodeId: item.nodeId,
            message: `${item.nodeId} was selected before all required predecessors were mastered.`,
          });
        }
      }

      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex];
        let outcome = outcomes[itemIndex];
        problems = problems.map((problem) =>
          problem.problemSlug === item.problemSlug
            ? {
                ...problem,
                exposureType: "internally_attempted",
                lastAttemptedAt: campaignInstant(campaignDate, true),
                cooldownUntil: addCampaignDays(campaignDate, cooldownDays),
              }
            : problem,
        );
        if (incompleteHistoryNodeIds.has(item.nodeId)) {
          outcomes[itemIndex] = "neutral";
          outcome = "neutral";
        }
        const isExposureGoal =
          (input.candidate.skeleton.nodePlans.find((plan) => plan.nodeId === item.nodeId)?.goalDepth ?? "mastery") === "exposure";
        if (isExposureGoal) {
          // Every branch represents a settled end-of-day result. Neutral is a
          // real settlement with no mastery polarity, not an unfinished probe.
          exposurePending.delete(item.nodeId);
          exposureSatisfied.add(item.nodeId);
        }

        const positiveForMastery = outcome === "positive";
        const negativeOutcome = outcome === "negative";
        const settlementId = [
          "sim-settlement",
          input.candidate.candidateId,
          input.branch,
          campaignDate,
          item.order,
          item.problemSlug,
        ].join(":");
        const settlement: SerializableSettlementProjection = {
          settlementId,
          problemSlug: item.problemSlug,
          nodeId: item.nodeId,
          slotRole: item.slotRole,
          positiveForMastery,
          negativeOutcome,
          settledAt: campaignInstant(campaignDate, true),
        };
        settlements.push(settlement);

        const stateIndex = nodeStates.findIndex((state) => state.nodeId === item.nodeId);
        let beforeState: LearnerNodeStateProjection | null = null;
        let reduction: ReturnType<typeof reduceLearnerNodeState> | null = null;
        if (stateIndex >= 0) {
          beforeState = deserializeLearnerNodeState(nodeStates[stateIndex]);
          reduction = reduceLearnerNodeState({
            currentState: beforeState,
            settlements: settlements
              .filter((entry) => entry.nodeId === item.nodeId)
              .map(deserializeSettlement),
          });
          nodeStates[stateIndex] = serializeLearnerNodeState({
            ...reduction.state,
            exposureState: "internally_attempted",
          });
          if (reduction.becameMastered) newlyMasteredNodeIds.add(item.nodeId);
        }

        const nodeKind = input.simulation.state.curriculum.graph.nodes.find(
          (node) => node.nodeId === item.nodeId,
        )?.kind;
        if (!nodeKind) continue;
        const repair = deriveRepairQueueDecision({
          nodeKind,
          beforeState,
          reduction,
          slotRole: item.slotRole,
          positiveForMastery,
          negativeOutcome,
        });
        if (repair.enqueue && repair.reason && repair.priority !== null) {
          addRepairCandidate({
            repairs,
            candidateId: input.candidate.candidateId,
            branch: input.branch,
            campaignDate,
            itemOrder: item.order,
            nodeId: item.nodeId,
            reason: repair.reason,
            priority: repair.priority,
          });
        }
      }

      if (projection.shortfall) {
        dayViolations.push({
          code: "problem_supply_shortfall",
          campaignDate,
          message: `DailyTask is short by ${projection.shortfall.missing} problem(s).`,
          ...(projection.primaryNodeId ? { nodeId: projection.primaryNodeId } : {}),
        });
      }
    }

    const unlock = resolveUnlockedNodes({
      curriculum: input.simulation.state.curriculum,
      skeleton: input.candidate.skeleton,
      nodeStates: nodeStates.map(deserializeLearnerNodeState),
    });
    if (unlock.newlyUnlockedNodeIds.length > 0) {
      const newlyUnlocked = new Set(unlock.newlyUnlockedNodeIds);
      nodeStates = nodeStates.map((state) =>
        newlyUnlocked.has(state.nodeId)
          ? { ...state, unlockedAt: campaignInstant(nextCampaignDate) }
          : state,
      );
      for (const nodeId of unlock.newlyUnlockedNodeIds) {
        const current = reachability.get(nodeId);
        if (current && !current.earliestEligibleDate) {
          reachability.set(nodeId, {
            ...current,
            earliestEligibleDate: nextCampaignDate,
          });
        }
        if (items.some((item) => item.nodeId === nodeId)) {
          dayViolations.push({
            code: "same_day_unlock_violation",
            campaignDate,
            nodeId,
            message: `${nodeId} was selected on the same day it became unlocked.`,
          });
        }
      }
    }

    allViolations.push(...dayViolations);
    days.push({
      campaignDate,
      budget,
      phase: projection.kind === "task" ? projection.phase : null,
      projection,
      outcome: {
        positiveItemCount: outcomes.filter((outcome) => outcome === "positive").length,
        negativeItemCount: outcomes.filter((outcome) => outcome === "negative").length,
        neutralItemCount: outcomes.filter((outcome) => outcome === "neutral").length,
      },
      newlyMasteredNodeIds: [...newlyMasteredNodeIds].sort(),
      newlyUnlockedNodeIds: [...unlock.newlyUnlockedNodeIds],
      nextCampaignDate,
      paceAssessment: assessment,
      violations: dayViolations,
      unknowns: dayUnknowns,
    });
  }

  return {
    branch: input.branch,
    internalDayProjections: days,
    violations: allViolations,
    earliestReachableDates: [...reachability.values()],
    unknowns: allUnknowns,
  };
}

/**
 * Deterministically projects candidates and outcome branches in memory. It
 * never creates a DailyTask or writes learner, mastery, repair, or settlement data.
 */
export function simulateCampaignPlan(
  input: SimulateCampaignPlanInput,
): CampaignSimulationResult {
  campaignDateSchema.parse(input.startCampaignDate);
  campaignDateSchema.parse(input.state.endDate);
  if (!Number.isInteger(input.horizon) || input.horizon < 1) {
    throw new Error("horizon must be a positive integer");
  }
  if (input.dailyBudgets.length !== input.horizon) {
    throw new Error("dailyBudgets must contain exactly one budget per horizon day");
  }
  for (const budget of input.dailyBudgets) {
    if (!Number.isInteger(budget) || budget < 3) {
      throw new Error("Every simulated DailyTask budget must be an integer of at least 3");
    }
  }
  if (input.candidates.length === 0) throw new Error("At least one candidate is required");
  assertUnique(input.candidates.map((candidate) => candidate.candidateId), "candidates");
  for (const candidate of input.candidates) {
    assertUnique(
      candidate.skeleton.nodePlans.map((plan) => plan.nodeId),
      `${candidate.candidateId}.skeleton.nodePlans`,
    );
  }
  assertUnique(
    input.state.settlements.map((settlement) => settlement.settlementId),
    "settlements",
  );
  validateObservedPace(input.observedPace);
  if (!Number.isInteger(input.options.selectorVersion) || input.options.selectorVersion < 1) {
    throw new Error("selectorVersion must be a positive integer");
  }
  for (const settlement of input.state.settlements) deserializeSettlement(settlement);
  const cooldownDays = input.options.internalCooldownDays;
  if (!Number.isInteger(cooldownDays) || cooldownDays < 0) {
    throw new Error("internalCooldownDays must be a non-negative integer");
  }

  const dates = Array.from(
    { length: input.horizon },
    (_, index) => addCampaignDays(input.startCampaignDate, index),
  );
  if (dates.at(-1)! > input.state.endDate) {
    throw new Error("Simulation horizon cannot extend beyond the Campaign endDate");
  }
  for (const outcome of input.observedPace.supportedPositiveItemsByDate) {
    const dateIndex = dates.indexOf(outcome.campaignDate);
    if (
      dateIndex >= 0 &&
      outcome.positiveItemCount > resolveDailyTaskBudget(input.state, input.dailyBudgets[dateIndex], outcome.campaignDate)
    ) {
      throw new Error("Observed positiveItemCount cannot exceed that date's budget");
    }
  }
  const historyUnknowns = inputHistoryUnknowns(input.state);
  const paceUnknowns = dates.flatMap((campaignDate, index) => {
    const unknown = unknownForAssessment(
      assessPace(
        input.observedPace,
        campaignDate,
        resolveDailyTaskBudget(input.state, input.dailyBudgets[index], campaignDate),
      ),
    );
    return unknown ? [unknown] : [];
  });

  return {
    horizon: {
      startCampaignDate: input.startCampaignDate,
      endCampaignDate: dates.at(-1)!,
      days: input.horizon,
    },
    dailyBudgets: dates.map((campaignDate, index) => ({
      campaignDate,
      budget: resolveDailyTaskBudget(input.state, input.dailyBudgets[index], campaignDate),
    })),
    candidates: input.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      branches: {
        optimistic: runBranch({
          simulation: input,
          candidate,
          branch: "optimistic",
          dates,
          historyUnknowns,
        }),
        observed_supported: runBranch({
          simulation: input,
          candidate,
          branch: "observed_supported",
          dates,
          historyUnknowns,
        }),
        conservative: runBranch({
          simulation: input,
          candidate,
          branch: "conservative",
          dates,
          historyUnknowns,
        }),
      },
    })),
    unknowns: [...historyUnknowns, ...paceUnknowns],
  };
}
