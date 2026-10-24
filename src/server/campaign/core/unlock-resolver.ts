import type {
  UnlockResolutionInput,
  UnlockResolutionOutput,
} from "../domain/contracts";

export function resolveUnlockedNodes(
  input: UnlockResolutionInput,
): UnlockResolutionOutput {
  const stateByNode = new Map(input.nodeStates.map((state) => [state.nodeId, state]));
  const orderedPlans = [...input.skeleton.nodePlans]
    .filter((plan) => plan.included)
    .sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId));
  const requiredByNode = new Map<string, string[]>();
  for (const edge of input.curriculum.graph.edges) {
    if (edge.type !== "required") continue;
    const current = requiredByNode.get(edge.toNodeId) ?? [];
    current.push(edge.fromNodeId);
    requiredByNode.set(edge.toNodeId, current);
  }

  const unlockedNodeIds: string[] = [];
  const newlyUnlockedNodeIds: string[] = [];
  const lockedNodeIds: string[] = [];
  for (const plan of orderedPlans) {
    const state = stateByNode.get(plan.nodeId);
    const alreadyUnlocked = Boolean(state?.unlockedAt);
    const prerequisites = requiredByNode.get(plan.nodeId) ?? [];
    const prerequisitesMastered = prerequisites.every(
      (nodeId) => stateByNode.get(nodeId)?.masteryState === "mastered",
    );
    if (alreadyUnlocked || prerequisitesMastered) {
      unlockedNodeIds.push(plan.nodeId);
      if (!alreadyUnlocked) newlyUnlockedNodeIds.push(plan.nodeId);
    } else {
      lockedNodeIds.push(plan.nodeId);
    }
  }
  return { unlockedNodeIds, newlyUnlockedNodeIds, lockedNodeIds };
}
