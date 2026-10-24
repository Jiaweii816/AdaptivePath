import { buildAdvanceFrontier } from "./advance-frontier";
import { deriveCampaignPhase } from "./phase-resolver";
import { compareRepairCandidates } from "./repair-queue-policy";
import {
  campaignDateSchema,
  type CampaignPhase,
  type DailySelectorInput,
  type DailySelectorOutput,
  type LearnerNodeStateProjection,
  type ProblemAvailability,
  type SelectedTaskItem,
  type TaskSlotRole,
} from "../domain/contracts";

const EXPOSURE_RANK = {
  never_seen: 0,
  externally_seen: 1,
  internally_attempted: 2,
} as const;

const HEALTH_RANK = {
  needs_reinforcement: 0,
  watch: 1,
  stable: 2,
} as const;

// v2: three-New core package, Recover-vs-Baseline priority, and carryover.
export const DAILY_SELECTOR_VERSION = 2;

function compareProblems(left: ProblemAvailability, right: ProblemAvailability): number {
  return (
    EXPOSURE_RANK[left.exposureType] - EXPOSURE_RANK[right.exposureType] ||
    left.recommendedOrder - right.recommendedOrder ||
    left.problemSlug.localeCompare(right.problemSlug)
  );
}

function isAvailable(
  problem: ProblemAvailability,
  campaignDate: string,
  selected: ReadonlySet<string>,
): boolean {
  return (
    !selected.has(problem.problemSlug) &&
    (!problem.cooldownUntil || campaignDate >= problem.cooldownUntil)
  );
}

function availableForRole(
  problem: ProblemAvailability,
  role: Exclude<TaskSlotRole, "mixed">,
  campaignDate: string,
  selected: ReadonlySet<string>,
): boolean {
  return (
    problem.eligibleRoles.includes(role) &&
    isAvailable(problem, campaignDate, selected)
  );
}

function pickProblem(input: {
  problems: readonly ProblemAvailability[];
  role: Exclude<TaskSlotRole, "mixed">;
  nodeId?: string;
  campaignDate: string;
  selected: ReadonlySet<string>;
  probeOnly?: boolean;
  newOnly?: boolean;
}): ProblemAvailability | null {
  return (
    input.problems
      .filter(
        (problem) =>
          (!input.nodeId || problem.nodeId === input.nodeId) &&
          (!input.probeOnly || problem.exposureType !== "internally_attempted") &&
          (!input.newOnly || problem.exposureType === "never_seen") &&
          availableForRole(problem, input.role, input.campaignDate, input.selected),
      )
      .sort(compareProblems)[0] ?? null
  );
}

export type DeepFillCandidate = Readonly<{
  nodeId: string;
  health: LearnerNodeStateProjection["masteryHealth"];
  neverSeenAvailableCount: number;
  totalProblemCount: number;
  skeletonOrder: number;
}>;

export function buildDeepFillCandidates(input: Pick<
  DailySelectorInput,
  "campaignDate" | "curriculum" | "skeleton" | "learnerNodeStates" | "problemAvailability"
>): DeepFillCandidate[] {
  const kindByNode = new Map(
    input.curriculum.graph.nodes.map((node) => [node.nodeId, node.kind]),
  );
  const totalByNode = new Map(
    input.curriculum.graph.nodes.map((node) => [node.nodeId, node.primaryProblems.length]),
  );
  const planByNode = new Map(input.skeleton.nodePlans.map((plan) => [plan.nodeId, plan]));
  const empty = new Set<string>();
  return input.learnerNodeStates
    .flatMap((state): DeepFillCandidate[] => {
      const plan = planByNode.get(state.nodeId);
      if (
        kindByNode.get(state.nodeId) !== "transferable" ||
        state.masteryState !== "mastered" ||
        !plan?.included ||
        (plan.goalDepth ?? "mastery") !== "mastery"
      ) {
        return [];
      }
      const available = input.problemAvailability.filter(
        (problem) =>
          problem.nodeId === state.nodeId &&
          isAvailable(problem, input.campaignDate, empty),
      );
      const neverSeenAvailableCount = available.filter(
        (problem) => problem.exposureType === "never_seen",
      ).length;
      // Deep fill must be able to honor the three-New core package.
      if (neverSeenAvailableCount < 3 || available.length < 3) return [];
      return [{
        nodeId: state.nodeId,
        health: state.masteryHealth,
        neverSeenAvailableCount,
        totalProblemCount: totalByNode.get(state.nodeId) ?? 0,
        skeletonOrder: plan.order,
      }];
    })
    .sort(
      (left, right) =>
        HEALTH_RANK[left.health] - HEALTH_RANK[right.health] ||
        right.neverSeenAvailableCount - left.neverSeenAvailableCount ||
        right.totalProblemCount - left.totalProblemCount ||
        left.skeletonOrder - right.skeletonOrder ||
        left.nodeId.localeCompare(right.nodeId),
    );
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Sort-first + seeded hash makes pseudo-random sampling independent of DB order. */
export function stableSeededOrder<T>(
  values: readonly T[],
  seed: string,
  identity: (value: T) => string,
): T[] {
  return [...values]
    .sort((left, right) => identity(left).localeCompare(identity(right)))
    .sort(
      (left, right) =>
        hash32(`${seed}|${identity(left)}`) - hash32(`${seed}|${identity(right)}`) ||
        identity(left).localeCompare(identity(right)),
    );
}

function selectMixed(input: DailySelectorInput, phase: CampaignPhase): DailySelectorOutput {
  const nodeById = new Map(input.curriculum.graph.nodes.map((node) => [node.nodeId, node]));
  const stateByNode = new Map(input.learnerNodeStates.map((state) => [state.nodeId, state]));
  const planByNode = new Map(input.skeleton.nodePlans.map((plan) => [plan.nodeId, plan]));
  const empty = new Set<string>();
  const candidateNodes = input.curriculum.graph.nodes.flatMap((node) => {
    const available = input.problemAvailability.filter(
      (problem) =>
        problem.nodeId === node.nodeId &&
        isAvailable(problem, input.campaignDate, empty),
    );
    if (available.length === 0) return [];
    if (node.kind === "transferable" && (planByNode.get(node.nodeId)?.goalDepth ?? "mastery") !== "mastery") return [];
    if (node.kind === "non_transferable") {
      return [{ nodeId: node.nodeId, priorityGroup: 3, available }];
    }
    const state = stateByNode.get(node.nodeId);
    if (!state || state.masteryState !== "mastered") return [];
    return [{
      nodeId: node.nodeId,
      priorityGroup: HEALTH_RANK[state.masteryHealth],
      available,
    }];
  });
  const seed = [
    input.campaignId,
    input.campaignDate,
    input.skeleton.version,
    input.selectorVersion ?? DAILY_SELECTOR_VERSION,
  ].join(":");
  const ordered = [0, 1, 2, 3].flatMap((priorityGroup) =>
    stableSeededOrder(
      candidateNodes.filter((candidate) => candidate.priorityGroup === priorityGroup),
      `${seed}:group:${priorityGroup}`,
      (candidate) => candidate.nodeId,
    ),
  );
  const items: SelectedTaskItem[] = [];
  const selectedSlugs = new Set<string>();
  const scheduledRepairQueueItemIds: string[] = [];
  const pendingRepairIds = new Set(input.repairQueueCandidates.map((repair) => repair.repairQueueItemId));
  for (const carryover of input.carryoverItems ?? []) {
    if (items.length >= input.budget || selectedSlugs.has(carryover.problemSlug)) continue;
    selectedSlugs.add(carryover.problemSlug);
    items.push({
      problemSlug: carryover.problemSlug,
      nodeId: carryover.nodeId,
      slotRole: carryover.slotRole,
      exposureType: carryover.exposureType,
      order: items.length + 1,
      ...(carryover.repairQueueItemId && pendingRepairIds.has(carryover.repairQueueItemId)
        ? { repairQueueItemId: carryover.repairQueueItemId }
        : {}),
      carryoverFromTaskItemId: carryover.carryoverFromTaskItemId,
    });
    if (carryover.repairQueueItemId && pendingRepairIds.has(carryover.repairQueueItemId)) {
      scheduledRepairQueueItemIds.push(carryover.repairQueueItemId);
    }
  }
  const hasExposureProbe = exposureProbeNodeIds(input).length > 0;
  const mixedBudget = hasExposureProbe && !items.some((item) => item.slotRole === "probe")
    ? input.budget - 1
    : input.budget;
  for (const candidate of ordered) {
    if (items.length >= mixedBudget) break;
    const problem = stableSeededOrder(
      candidate.available.filter((entry) => isAvailable(entry, input.campaignDate, selectedSlugs)),
      `${seed}:node:${candidate.nodeId}`,
      (entry) => entry.problemSlug,
    ).sort(
      (left, right) =>
        EXPOSURE_RANK[left.exposureType] - EXPOSURE_RANK[right.exposureType] ||
        hash32(`${seed}|${left.problemSlug}`) - hash32(`${seed}|${right.problemSlug}`) ||
        left.problemSlug.localeCompare(right.problemSlug),
    )[0];
    if (!problem || !nodeById.has(problem.nodeId)) continue;
    selectedSlugs.add(problem.problemSlug);
    items.push({
      problemSlug: problem.problemSlug,
      nodeId: problem.nodeId,
      slotRole: "mixed",
      exposureType: problem.exposureType,
      order: items.length + 1,
    });
  }
  if (hasExposureProbe && !items.some((item) => item.slotRole === "probe") && items.length < input.budget) {
    const exposure = pickExposureProbe(
      input,
      selectedSlugs,
      new Set(items.map((item) => item.nodeId)),
    );
    if (exposure) {
      items.push({
        problemSlug: exposure.problemSlug,
        nodeId: exposure.nodeId,
        slotRole: "probe",
        exposureType: exposure.exposureType,
        order: items.length + 1,
      });
    }
  }
  const missing = input.budget - items.length;
  return {
    kind: "task",
    campaignDate: input.campaignDate,
    phase,
    budget: input.budget,
    primaryNodeId: null,
    items,
    scheduledRepairQueueItemIds,
    shortfall: missing > 0 ? {
      requested: input.budget,
      selected: items.length,
      missing,
      reasons: ["Fewer distinct nodes have problems available outside cooldown"],
    } : null,
    reusedExisting: false,
  };
}

function exposureProbeNodeIds(input: DailySelectorInput): string[] {
  if (!input.exposurePlanning || input.exposurePlanning.skeletonVersion !== input.skeleton.version) return [];
  const satisfied = new Set(input.exposurePlanning.satisfiedNodeIds);
  const pending = new Set(input.exposurePlanning.pendingProbeNodeIds);
  const excluded = new Set(input.excludedNodeIds ?? []);
  const stateByNode = new Map(input.learnerNodeStates.map((state) => [state.nodeId, state]));
  return input.skeleton.nodePlans
    .filter((plan) =>
      plan.included &&
      (plan.goalDepth ?? "mastery") === "exposure" &&
      !excluded.has(plan.nodeId) &&
      !satisfied.has(plan.nodeId) &&
      !pending.has(plan.nodeId) &&
      Boolean(stateByNode.get(plan.nodeId)?.unlockedAt),
    )
    .sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId))
    .map((plan) => plan.nodeId);
}

function pickExposureProbe(
  input: DailySelectorInput,
  selected: ReadonlySet<string>,
  alreadySelectedNodeIds: ReadonlySet<string>,
): ProblemAvailability | null {
  for (const nodeId of exposureProbeNodeIds(input)) {
    if (alreadySelectedNodeIds.has(nodeId)) continue;
    const problem = pickProblem({
      problems: input.problemAvailability,
      role: "probe",
      nodeId,
      campaignDate: input.campaignDate,
      selected,
      probeOnly: true,
    });
    if (problem) return problem;
  }
  return null;
}

function selectExposureOnly(input: DailySelectorInput): DailySelectorOutput {
  const selectedSlugs = new Set<string>();
  const selectedNodeIds = new Set<string>();
  const items: SelectedTaskItem[] = [];
  while (items.length < input.budget) {
    const problem = pickExposureProbe(input, selectedSlugs, selectedNodeIds);
    if (!problem) break;
    selectedSlugs.add(problem.problemSlug);
    selectedNodeIds.add(problem.nodeId);
    items.push({
      problemSlug: problem.problemSlug,
      nodeId: problem.nodeId,
      slotRole: "probe",
      exposureType: problem.exposureType,
      order: items.length + 1,
    });
  }
  if (items.length === 0) {
    return { kind: "no_task", campaignDate: input.campaignDate, reason: "no_primary_node" };
  }
  const missing = input.budget - items.length;
  return {
    kind: "task",
    campaignDate: input.campaignDate,
    phase: "coverage",
    budget: input.budget,
    primaryNodeId: null,
    items,
    scheduledRepairQueueItemIds: [],
    shortfall: missing > 0 ? {
      requested: input.budget,
      selected: items.length,
      missing,
      reasons: ["Exposure planning permits at most one unsettled probe per node"],
    } : null,
    reusedExisting: false,
  };
}

/**
 * A carryover is already an explicitly selected Campaign obligation. If the
 * route has no fresh frontier at all, preserve that obligation instead of
 * dropping it merely because no new node can currently be chosen.
 */
function selectCarryoverOnly(
  input: DailySelectorInput,
  phase: CampaignPhase,
): DailySelectorOutput {
  const selectedSlugs = new Set<string>();
  const pendingRepairIds = new Set(input.repairQueueCandidates.map((repair) => repair.repairQueueItemId));
  const items: SelectedTaskItem[] = [];
  const scheduledRepairQueueItemIds: string[] = [];
  for (const carryover of input.carryoverItems ?? []) {
    if (items.length >= input.budget || selectedSlugs.has(carryover.problemSlug)) continue;
    selectedSlugs.add(carryover.problemSlug);
    items.push({
      problemSlug: carryover.problemSlug,
      nodeId: carryover.nodeId,
      slotRole: carryover.slotRole,
      exposureType: carryover.exposureType,
      order: items.length + 1,
      ...(carryover.repairQueueItemId && pendingRepairIds.has(carryover.repairQueueItemId)
        ? { repairQueueItemId: carryover.repairQueueItemId }
        : {}),
      carryoverFromTaskItemId: carryover.carryoverFromTaskItemId,
    });
    if (carryover.repairQueueItemId && pendingRepairIds.has(carryover.repairQueueItemId)) {
      scheduledRepairQueueItemIds.push(carryover.repairQueueItemId);
    }
  }
  if (items.length === 0) {
    return { kind: "no_task", campaignDate: input.campaignDate, reason: "no_primary_node" };
  }
  const missing = input.budget - items.length;
  return {
    kind: "task",
    campaignDate: input.campaignDate,
    phase,
    budget: input.budget,
    primaryNodeId: null,
    items,
    scheduledRepairQueueItemIds,
    shortfall: missing > 0 ? {
      requested: input.budget,
      selected: items.length,
      missing,
      reasons: ["Only carried-forward Campaign work is currently eligible"],
    } : null,
    reusedExisting: false,
  };
}

function selectPrimaryPackage(
  input: DailySelectorInput,
  phase: CampaignPhase,
  primaryNodeId: string,
): DailySelectorOutput {
  const primaryState = input.learnerNodeStates.find((state) => state.nodeId === primaryNodeId);
  const selectedSlugs = new Set<string>();
  const items: SelectedTaskItem[] = [];
  const scheduledRepairQueueItemIds: string[] = [];
  const append = (
    problem: ProblemAvailability | null,
    slotRole: Exclude<TaskSlotRole, "mixed">,
    repairQueueItemId?: string,
  ): boolean => {
    if (!problem || items.length >= input.budget) return false;
    selectedSlugs.add(problem.problemSlug);
    items.push({
      problemSlug: problem.problemSlug,
      nodeId: problem.nodeId,
      slotRole,
      exposureType: problem.exposureType,
      order: items.length + 1,
      ...(repairQueueItemId ? { repairQueueItemId } : {}),
    });
    if (repairQueueItemId) scheduledRepairQueueItemIds.push(repairQueueItemId);
    return true;
  };

  const appendCarryover = (carryover: NonNullable<DailySelectorInput["carryoverItems"]>[number]): boolean => {
    if (items.length >= input.budget || selectedSlugs.has(carryover.problemSlug)) return false;
    selectedSlugs.add(carryover.problemSlug);
    items.push({
      problemSlug: carryover.problemSlug,
      nodeId: carryover.nodeId,
      slotRole: carryover.slotRole,
      exposureType: carryover.exposureType,
      order: items.length + 1,
      ...(carryover.repairQueueItemId ? { repairQueueItemId: carryover.repairQueueItemId } : {}),
      carryoverFromTaskItemId: carryover.carryoverFromTaskItemId,
    });
    if (carryover.repairQueueItemId) scheduledRepairQueueItemIds.push(carryover.repairQueueItemId);
    return true;
  };

  const carryovers = input.carryoverItems ?? [];
  const isCore = (item: { slotRole: TaskSlotRole }) =>
    item.slotRole === "advance" || item.slotRole === "target";
  const coreCarryovers = carryovers.filter(isCore);
  const baselineCarryover = carryovers.find((item) => item.slotRole === "probe") ?? null;
  const recoverCarryovers = new Map(
    carryovers
      .filter((item) => item.slotRole === "remedial" && item.repairQueueItemId)
      .map((item) => [item.repairQueueItemId!, item]),
  );
  const orphanedRecoverCarryover = carryovers.find(
    (item) => item.slotRole === "remedial" && !item.repairQueueItemId,
  ) ?? null;

  // Carryover is a task state, not a learning role: unfinished core work keeps
  // its New-core place before fresh questions are chosen.
  for (const carryover of coreCarryovers) {
    if (items.filter(isCore).length >= 3) break;
    appendCarryover(carryover);
  }

  const coreCount = () => items.filter(isCore).length;
  const appendNewCore = (): boolean => {
    const preferredRole: "advance" | "target" =
      coreCount() === 0 && phase === "coverage" && !primaryState?.startedAt
        ? "advance"
        : "target";
    const preferred = pickProblem({
      problems: input.problemAvailability,
      role: preferredRole,
      nodeId: primaryNodeId,
      campaignDate: input.campaignDate,
      selected: selectedSlugs,
      newOnly: true,
    });
    if (preferred && append(preferred, preferredRole)) return true;
    if (preferredRole !== "advance") return false;
    const target = pickProblem({
      problems: input.problemAvailability,
      role: "target",
      nodeId: primaryNodeId,
      campaignDate: input.campaignDate,
      selected: selectedSlugs,
      newOnly: true,
    });
    return append(target, "target");
  };

  while (items.length < input.budget && coreCount() < 3) {
    if (!appendNewCore()) break;
  }

  const repairs = [...input.repairQueueCandidates].sort(compareRepairCandidates);
  const appendRepair = (): boolean => {
    for (const repair of repairs) {
      if (scheduledRepairQueueItemIds.includes(repair.repairQueueItemId)) continue;
      const carryover = recoverCarryovers.get(repair.repairQueueItemId);
      if (carryover && appendCarryover(carryover)) return true;
      const problem = pickProblem({
        problems: input.problemAvailability,
        role: "remedial",
        nodeId: repair.nodeId,
        campaignDate: input.campaignDate,
        selected: selectedSlugs,
      });
      if (append(problem, "remedial", repair.repairQueueItemId)) return true;
    }
    if (orphanedRecoverCarryover && appendCarryover(orphanedRecoverCarryover)) return true;
    return false;
  };
  const appendProbe = (): boolean => append(pickProblem({
    problems: input.problemAvailability.filter((problem) =>
      (input.skeleton.nodePlans.find((plan) => plan.nodeId === problem.nodeId)?.goalDepth ?? "mastery") === "mastery",
    ),
    role: "probe",
    campaignDate: input.campaignDate,
    selected: selectedSlugs,
    probeOnly: true,
  }), "probe");

  const appendExposureProbe = (): boolean => append(
    pickExposureProbe(input, selectedSlugs, new Set(items.map((item) => item.nodeId))),
    "probe",
  );

  const appendBaseline = (): boolean => appendExposureProbe() || appendProbe();

  const appendBaselineSlot = (): boolean =>
    (baselineCarryover ? appendCarryover(baselineCarryover) : false) || appendBaseline();

  // Coverage/deep-fill has three hard New-core places. With one auxiliary
  // place, Recover outranks Baseline; with two, each gets one. Missing role
  // candidates are filled by another new core problem, never a completed revisit.
  if (items.length < input.budget && input.budget >= 5) {
    if (!appendBaselineSlot()) appendNewCore();
  }
  if (items.length < input.budget && input.budget >= 4) {
    if (!appendRepair()) {
      if (input.budget === 4 && appendBaselineSlot()) {
        // The lone auxiliary place was used by Baseline.
      } else {
        appendNewCore();
      }
    }
  }
  while (items.length < input.budget) {
    if (appendNewCore()) continue;
    break;
  }
  const missing = input.budget - items.length;
  return {
    kind: "task",
    campaignDate: input.campaignDate,
    phase,
    budget: input.budget,
    primaryNodeId,
    items,
    scheduledRepairQueueItemIds,
    shortfall: missing > 0 ? {
      requested: input.budget,
      selected: items.length,
      missing,
      reasons: ["No additional new Core Learning problem outside cooldown"],
    } : null,
    reusedExisting: false,
  };
}

export function selectDailyTask(input: DailySelectorInput): DailySelectorOutput {
  campaignDateSchema.parse(input.campaignDate);
  campaignDateSchema.parse(input.endDate);
  if (!Number.isInteger(input.budget) || input.budget < 3) {
    throw new Error("Campaign daily budget must be an integer of at least 3");
  }
  if (input.existingDailyTask) {
    return { kind: "task", ...input.existingDailyTask, reusedExisting: true };
  }
  const exposureNodeIds = new Set(
    input.skeleton.nodePlans
      .filter((plan) => (plan.goalDepth ?? "mastery") === "exposure")
      .map((plan) => plan.nodeId),
  );
  const effectiveInput: DailySelectorInput = {
    ...input,
    repairQueueCandidates: input.repairQueueCandidates.filter((repair) => !exposureNodeIds.has(repair.nodeId)),
  };
  const frontier = buildAdvanceFrontier({
    skeleton: effectiveInput.skeleton,
    curriculum: effectiveInput.curriculum,
    nodeStates: effectiveInput.learnerNodeStates,
    excludedNodeIds: [...new Set([...(input.excludedNodeIds ?? []), ...exposureNodeIds])],
  });
  const deepFillCandidates = buildDeepFillCandidates(effectiveInput);
  if (
    frontier.length === 0 &&
    deepFillCandidates.length === 0 &&
    exposureProbeNodeIds(input).length > 0 &&
    (input.carryoverItems?.length ?? 0) === 0
  ) {
    return selectExposureOnly(input);
  }
  const { phase } = deriveCampaignPhase({
    advanceFrontier: frontier,
    campaignDate: input.campaignDate,
    endDate: input.endDate,
    mixedWindowDays: input.skeleton.mixedWindowDays,
    hasDeepFillCandidate: deepFillCandidates.length > 0,
  });
  if (phase === "consolidation_mixed") return selectMixed(effectiveInput, phase);
  const primaryNodeId =
    phase === "coverage" ? frontier[0]?.nodeId : deepFillCandidates[0]?.nodeId;
  if (!primaryNodeId) {
    if ((input.carryoverItems?.length ?? 0) > 0) {
      return selectCarryoverOnly(effectiveInput, phase);
    }
    return selectExposureOnly(input);
  }
  return selectPrimaryPackage(effectiveInput, phase, primaryNodeId);
}
