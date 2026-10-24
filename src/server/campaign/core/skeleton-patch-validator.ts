import {
  campaignCurriculumAssets,
  validateCurriculumAssets,
  type CampaignSkeletonNodePlan,
  type CurriculumAssets,
} from "../curriculum";
import type { SkeletonProjection } from "../domain/contracts";
import {
  campaignSkeletonPatchProposalSchema,
  canonicalizePatchOperations,
  fingerprintCampaignPatch,
  type CampaignSkeletonPatchProposal,
  type StoredCampaignSkeletonPatchOperation,
} from "../domain/skeleton-patch-contracts";

export type CampaignSkeletonPatchIssue = Readonly<{
  code: string;
  path: string;
  message: string;
}>;

export type CampaignSkeletonPatchPreview = SkeletonProjection;

export type CampaignSkeletonPatchValidationResult = Readonly<{
  valid: boolean;
  normalizedOperations: readonly StoredCampaignSkeletonPatchOperation[];
  errors: readonly CampaignSkeletonPatchIssue[];
  warnings: readonly CampaignSkeletonPatchIssue[];
  resultingSkeletonPreview: CampaignSkeletonPatchPreview | null;
  changedNodeIds: readonly string[];
  impactSummary: Readonly<{
    changedNodeCount: number;
    changesMixedWindowDays: boolean;
    dailyBudgetSuggestion: number | null;
    dateBudgetSuggestionCount: number;
    currentDailyTaskUnaffected: boolean;
  }>;
  fingerprint: string;
}>;

export type CampaignSkeletonPatchValidationInput = Readonly<{
  activeSkeleton: SkeletonProjection;
  proposedPatch: unknown;
  curriculum?: CurriculumAssets;
  campaignGoal: Readonly<{ dailyQuestionBudget: number }>;
  currentDailyTask?: Readonly<{ taskId: string; campaignDate: string }> | null;
  existingPendingPatch?: Readonly<{ patchId: string; baseVersion: number }> | null;
}>;

function issueSort(left: CampaignSkeletonPatchIssue, right: CampaignSkeletonPatchIssue) {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
}

function applyOperations(
  skeleton: SkeletonProjection,
  operations: readonly StoredCampaignSkeletonPatchOperation[],
): CampaignSkeletonPatchPreview {
  const byNode = new Map<string, CampaignSkeletonNodePlan>(
    skeleton.nodePlans.map((plan) => [plan.nodeId, { ...plan }]),
  );
  let orderedNodeIds = [...skeleton.nodePlans]
    .sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId))
    .map((plan) => plan.nodeId);
  let mixedWindowDays = skeleton.mixedWindowDays;

  for (const operation of operations) {
    if (operation.type === "set_mixed_window_days") {
      mixedWindowDays = operation.mixedWindowDays;
      continue;
    }
    const plan = byNode.get(operation.nodeId);
    if (!plan) continue;
    if (operation.type === "set_node_included") {
      byNode.set(operation.nodeId, { ...plan, included: operation.included });
    } else if (operation.type === "set_node_priority") {
      byNode.set(operation.nodeId, { ...plan, priority: operation.priority });
    } else if (operation.type === "set_target_week") {
      byNode.set(operation.nodeId, { ...plan, targetWeek: operation.targetWeek });
    } else if (operation.type === "set_goal_depth") {
      byNode.set(operation.nodeId, { ...plan, goalDepth: operation.goalDepth });
    } else if (operation.type === "set_target_by_date") {
      byNode.set(operation.nodeId, { ...plan, targetByDate: operation.targetByDate });
    } else if (operation.type === "set_node_rationale") {
      byNode.set(operation.nodeId, { ...plan, rationale: operation.rationale });
    } else if (operation.type === "move_node") {
      orderedNodeIds = orderedNodeIds.filter((nodeId) => nodeId !== operation.nodeId);
      const anchor = operation.beforeNodeId ?? operation.afterNodeId!;
      const anchorIndex = orderedNodeIds.indexOf(anchor);
      if (anchorIndex >= 0) {
        orderedNodeIds.splice(anchorIndex + (operation.afterNodeId ? 1 : 0), 0, operation.nodeId);
      }
    }
  }

  return {
    version: skeleton.version + 1,
    mixedWindowDays,
    nodePlans: orderedNodeIds.map((nodeId, index) => ({
      ...byNode.get(nodeId)!,
      order: index + 1,
    })),
  };
}

function operationConflictKey(operation: StoredCampaignSkeletonPatchOperation) {
  if (operation.type === "set_mixed_window_days") return operation.type;
  return `${operation.type}:${operation.nodeId}`;
}

export function validateCampaignSkeletonPatch(
  input: CampaignSkeletonPatchValidationInput,
): CampaignSkeletonPatchValidationResult {
  const curriculum = input.curriculum ?? campaignCurriculumAssets;
  const parsed = campaignSkeletonPatchProposalSchema.safeParse(input.proposedPatch);
  const errors: CampaignSkeletonPatchIssue[] = [];
  const warnings: CampaignSkeletonPatchIssue[] = [];

  if (!parsed.success) {
    for (const parseIssue of parsed.error.issues) {
      errors.push({
        code: "invalid_patch_schema",
        path: parseIssue.path.join(".") || "patch",
        message: parseIssue.message,
      });
    }
    errors.sort(issueSort);
    return {
      valid: false,
      normalizedOperations: [],
      errors,
      warnings: [],
      resultingSkeletonPreview: null,
      changedNodeIds: [],
      impactSummary: {
        changedNodeCount: 0,
        changesMixedWindowDays: false,
        dailyBudgetSuggestion: null,
        dateBudgetSuggestionCount: 0,
        currentDailyTaskUnaffected: true,
      },
      fingerprint: fingerprintCampaignPatch({ activeVersion: input.activeSkeleton.version, proposedPatch: input.proposedPatch, errors }),
    };
  }

  const proposal: CampaignSkeletonPatchProposal = parsed.data;
  const operations = canonicalizePatchOperations(proposal.operations);
  const nodeById = new Map(curriculum.graph.nodes.map((node) => [node.nodeId, node]));
  const planNodeIds = new Set(input.activeSkeleton.nodePlans.map((plan) => plan.nodeId));
  const conflictOwner = new Map<string, string>();

  if (proposal.baseVersion !== input.activeSkeleton.version) {
    errors.push({
      code: "stale_base_version",
      path: "baseVersion",
      message: `Patch base version ${proposal.baseVersion} is not active version ${input.activeSkeleton.version}.`,
    });
  }
  if (input.existingPendingPatch) {
    warnings.push({
      code: "pending_patch_exists",
      path: "patch",
      message: `Another pending patch already targets version ${input.existingPendingPatch.baseVersion}.`,
    });
  }

  for (const [index, operation] of operations.entries()) {
    const path = `operations.${index}`;
    const conflictKey = operationConflictKey(operation);
    const prior = conflictOwner.get(conflictKey);
    if (prior) {
      errors.push({
        code: "duplicate_or_conflicting_operation",
        path,
        message: `${operation.operationId} conflicts with ${prior} for '${conflictKey}'.`,
      });
    } else {
      conflictOwner.set(conflictKey, operation.operationId);
    }
    if (operation.type === "set_mixed_window_days") continue;
    const node = nodeById.get(operation.nodeId);
    if (!node) {
      errors.push({ code: "unknown_skeleton_node", path: `${path}.nodeId`, message: `Node '${operation.nodeId}' does not exist in the Curriculum Graph.` });
    } else if (node.kind !== "transferable") {
      errors.push({ code: "non_transferable_node", path: `${path}.nodeId`, message: `Non-transferable node '${operation.nodeId}' cannot enter Campaign coverage planning.` });
    } else if (!planNodeIds.has(operation.nodeId)) {
      errors.push({ code: "unknown_skeleton_node", path: `${path}.nodeId`, message: `Node '${operation.nodeId}' is not in the active Skeleton.` });
    }
    if (operation.type === "move_node") {
      const anchor = operation.beforeNodeId ?? operation.afterNodeId!;
      if (anchor === operation.nodeId) {
        errors.push({ code: "self_referential_move", path, message: `Node '${operation.nodeId}' cannot move relative to itself.` });
      }
      const anchorNode = nodeById.get(anchor);
      if (!anchorNode) {
        errors.push({ code: "unknown_move_anchor", path, message: `Move anchor '${anchor}' does not exist in the Curriculum Graph.` });
      } else if (anchorNode.kind !== "transferable") {
        errors.push({ code: "non_transferable_node", path, message: `Move anchor '${anchor}' is non-transferable.` });
      } else if (!planNodeIds.has(anchor)) {
        errors.push({ code: "unknown_move_anchor", path, message: `Move anchor '${anchor}' is not in the active Skeleton.` });
      }
    }
  }

  const preview = applyOperations(input.activeSkeleton, operations);
  const orderSet = new Set(preview.nodePlans.map((plan) => plan.order));
  if (
    orderSet.size !== preview.nodePlans.length ||
    preview.nodePlans.some((plan, index) => plan.order !== index + 1)
  ) {
    errors.push({ code: "non_contiguous_order", path: "resultingSkeleton.nodePlans", message: "Resulting Skeleton order must be unique and contiguous from 1." });
  }

  const planByNode = new Map(preview.nodePlans.map((plan) => [plan.nodeId, plan]));
  for (const edge of curriculum.graph.edges) {
    const from = planByNode.get(edge.fromNodeId);
    const to = planByNode.get(edge.toNodeId);
    if (!from || !to || !to.included) continue;
    if (edge.type === "required") {
      if (!from.included) {
        errors.push({ code: "required_prerequisite_excluded", path: "resultingSkeleton.nodePlans", message: `Included node '${to.nodeId}' requires included prerequisite '${from.nodeId}'.` });
      } else if ((to.goalDepth ?? "mastery") === "mastery" && (from.goalDepth ?? "mastery") === "exposure") {
        errors.push({ code: "required_prerequisite_depth", path: "resultingSkeleton.nodePlans", message: `Mastery goal '${to.nodeId}' requires mastery depth for prerequisite '${from.nodeId}'.` });
      } else if (from.order >= to.order) {
        errors.push({ code: "required_order_violation", path: "resultingSkeleton.nodePlans", message: `Required prerequisite '${from.nodeId}' must precede '${to.nodeId}'.` });
      }
    } else if (edge.type === "recommended" && (!from.included || from.order >= to.order)) {
      warnings.push({ code: "recommended_order_not_followed", path: "resultingSkeleton.nodePlans", message: `Recommended prerequisite '${from.nodeId}' does not precede included node '${to.nodeId}'.` });
    }
  }

  const compatibility = validateCurriculumAssets({
    graph: curriculum.graph,
    skeleton: {
      skeletonId: "campaign-patch-preview",
      curriculumId: curriculum.graph.curriculumId,
      curriculumVersion: curriculum.graph.version,
      version: preview.version,
      mixedWindowDays: preview.mixedWindowDays,
      nodePlans: preview.nodePlans,
    },
  });
  for (const compatibilityIssue of compatibility.issues) {
    if (compatibilityIssue.code === "required_order_violation") continue;
    errors.push({
      code: `curriculum_${compatibilityIssue.code}`,
      path: compatibilityIssue.path,
      message: compatibilityIssue.message,
    });
  }

  const changedNodeIds = [...new Set(operations.flatMap((operation) =>
    operation.type === "set_mixed_window_days" ? [] : [operation.nodeId],
  ))].sort((left, right) => left.localeCompare(right));
  errors.sort(issueSort);
  warnings.sort(issueSort);
  const fingerprint = fingerprintCampaignPatch({
    activeVersion: input.activeSkeleton.version,
    proposal: { ...proposal, operations },
    preview,
    errors,
    warnings,
  });
  return {
    valid: errors.length === 0,
    normalizedOperations: operations,
    errors,
    warnings,
    resultingSkeletonPreview: preview,
    changedNodeIds,
    impactSummary: {
      changedNodeCount: changedNodeIds.length,
      changesMixedWindowDays: operations.some((operation) => operation.type === "set_mixed_window_days"),
      dailyBudgetSuggestion: proposal.dailyBudgetSuggestion?.proposedBudget ?? null,
      dateBudgetSuggestionCount: proposal.dateBudgetSuggestions?.length ?? 0,
      currentDailyTaskUnaffected: true,
    },
    fingerprint,
  };
}
