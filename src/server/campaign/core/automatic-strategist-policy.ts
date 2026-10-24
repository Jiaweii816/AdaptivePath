import type { CampaignSkeletonPatchOperation } from "../domain/skeleton-patch-contracts";

export type AutomaticStrategistPolicyIssue = Readonly<{
  code: string;
  operationIndex: number;
  message: string;
}>;

export function validateAutomaticStrategistProposal(input: {
  operations: readonly CampaignSkeletonPatchOperation[];
  nodeStates: readonly { nodeId: string; started: boolean; masteryState: "learning" | "mastered" }[];
  transferableNodeIds: readonly string[];
}) {
  const stateByNode = new Map(input.nodeStates.map((state) => [state.nodeId, state]));
  const transferable = new Set(input.transferableNodeIds);
  const errors: AutomaticStrategistPolicyIssue[] = [];
  input.operations.forEach((operation, operationIndex) => {
    if (operation.type === "set_mixed_window_days") return;
    if (!transferable.has(operation.nodeId)) {
      errors.push({ code: "non_transferable_or_unknown_node", operationIndex, message: `Node '${operation.nodeId}' is not an automatic planning target.` });
      return;
    }
    const state = stateByNode.get(operation.nodeId);
    if (operation.type === "set_node_included") {
      errors.push({
        code: state?.started ? "started_node_inclusion_change" : "automatic_inclusion_change_forbidden",
        operationIndex,
        message: "Automatic Strategist proposals cannot include or exclude nodes.",
      });
      return;
    }
    if (state?.started || state?.masteryState === "mastered") {
      errors.push({ code: "started_or_mastered_node_change", operationIndex, message: "Automatic Strategist proposals can change only future unstarted nodes." });
    }
  });
  errors.sort((left, right) => left.operationIndex - right.operationIndex || left.code.localeCompare(right.code));
  return { valid: errors.length === 0, errors } as const;
}
