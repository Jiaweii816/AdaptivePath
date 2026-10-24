import type { CurriculumAssets } from "../curriculum";
import type {
  LearnerNodeStateProjection,
  SkeletonProjection,
} from "../domain/contracts";

export type AdvanceFrontierEntry = Readonly<{
  nodeId: string;
  started: boolean;
  priority: number;
  order: number;
}>;

/** Higher numeric priority wins; order and nodeId make every tie stable. */
export function buildAdvanceFrontier(input: {
  skeleton: SkeletonProjection;
  curriculum: CurriculumAssets;
  nodeStates: readonly LearnerNodeStateProjection[];
  excludedNodeIds?: readonly string[];
}): AdvanceFrontierEntry[] {
  const stateByNode = new Map(input.nodeStates.map((state) => [state.nodeId, state]));
  const excluded = new Set(input.excludedNodeIds ?? []);
  const kindByNode = new Map(
    input.curriculum.graph.nodes.map((node) => [node.nodeId, node.kind]),
  );
  return input.skeleton.nodePlans
    .filter((plan) => {
      const state = stateByNode.get(plan.nodeId);
      return (
        plan.included &&
        kindByNode.get(plan.nodeId) === "transferable" &&
        !excluded.has(plan.nodeId) &&
        Boolean(state?.unlockedAt) &&
        state?.masteryState !== "mastered"
      );
    })
    .map((plan) => ({
      nodeId: plan.nodeId,
      started: Boolean(stateByNode.get(plan.nodeId)?.startedAt),
      priority: plan.priority,
      order: plan.order,
    }))
    .sort(
      (left, right) =>
        Number(right.started) - Number(left.started) ||
        right.priority - left.priority ||
        left.order - right.order ||
        left.nodeId.localeCompare(right.nodeId),
    );
}
