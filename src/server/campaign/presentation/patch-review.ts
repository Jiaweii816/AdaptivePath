import { campaignCurriculumAssets } from "../curriculum";
import { validateCampaignSkeletonPatch } from "../core";
import {
  campaignPatchStatusSchema,
  dailyBudgetSuggestionSchema,
  dateBudgetSuggestionSchema,
  storedCampaignSkeletonPatchOperationsSchema,
  type CampaignSkeletonPatchOperation,
  type StoredCampaignSkeletonPatchOperation,
  type SkeletonProjection,
} from "../domain";
import type {
  CampaignPatchReviewView,
  PatchOperationReviewItem,
} from "./contracts";

export type CampaignPatchReviewPresenterInput = Readonly<{
  patch: Readonly<{
    id: string;
    status: string;
    trigger: string;
    rationale: string;
    createdAt: Date;
    baseVersion: number;
    operationsJson: string;
    dailyBudgetSuggestionJson: string | null;
  }>;
  baseSkeleton: SkeletonProjection;
  activeVersion: number;
  currentDailyBudget: number;
  now?: Date;
  externalDataAsOf?: string | null;
  externalDataValidUntil?: string | null;
  rejectedCandidateReasons?: readonly string[];
}>;

const TRIGGER_LABELS: Readonly<Record<string, string>> = {
  goal_changed: "Learning goal updated",
  strategist_goal_changed: "Learning goal updated",
  significant_state_change: "Recent learning state changed",
  strategist_significant_state_change: "Recent learning state changed",
  weekly_boundary: "Weekly route check",
  strategist_weekly_boundary: "Weekly route check",
  repair_backlog: "Recovery work accumulated",
  consecutive_partial: "Recent tasks were not fully settled",
  phase_changed: "Learning phase changed",
  user_route_adjustment: "User route adjustment",
};

function operationWithoutId(
  operation: StoredCampaignSkeletonPatchOperation,
): CampaignSkeletonPatchOperation {
  return Object.fromEntries(
    Object.entries(operation).filter(([key]) => key !== "operationId"),
  ) as CampaignSkeletonPatchOperation;
}

function displayValue(value: string | number | boolean | null) {
  if (value === null) return "Not set";
  if (typeof value === "boolean") return value ? "Included" : "Not included";
  return String(value);
}

function safeWarning(code: string) {
  if (code === "recommended_order_not_followed") {
    return "This change does not follow a recommended learning order, but it does not block the route.";
  }
  if (code === "pending_patch_exists") {
    return "Another proposal is already awaiting review.";
  }
  return "This change has route effects that need attention.";
}

function operationTitle(type: CampaignSkeletonPatchOperation["type"]) {
  return {
    set_node_included: "Route scope",
    move_node: "Route order",
    set_node_priority: "Route priority",
    set_target_week: "Target week",
    set_goal_depth: "Target depth",
    set_target_by_date: "Target date",
    set_node_rationale: "Route rationale",
    set_mixed_window_days: "Mixed-practice window",
  }[type];
}

function describeOperation(input: {
  operation: StoredCampaignSkeletonPatchOperation;
  baseSkeleton: SkeletonProjection;
  preview: SkeletonProjection;
  warnings: readonly string[];
}): PatchOperationReviewItem {
  const { operation, baseSkeleton, preview } = input;
  const nodeById = new Map(campaignCurriculumAssets.graph.nodes.map((node) => [node.nodeId, node]));
  const beforeByNode = new Map(baseSkeleton.nodePlans.map((plan) => [plan.nodeId, plan]));
  const afterByNode = new Map(preview.nodePlans.map((plan) => [plan.nodeId, plan]));
  const nodeName = operation.type === "set_mixed_window_days"
    ? null
    : nodeById.get(operation.nodeId)?.label.en ?? operation.nodeId;
  const before = operation.type === "set_mixed_window_days" ? null : beforeByNode.get(operation.nodeId);
  const after = operation.type === "set_mixed_window_days" ? null : afterByNode.get(operation.nodeId);
  let readableDescription: string;
  let beforeValue: string | undefined;
  let afterValue: string | undefined;
  let affectedNodeIds: string[] = [];

  switch (operation.type) {
    case "set_node_included":
      readableDescription = operation.included
        ? `Add “${nodeName}” to the future learning route.`
        : `Remove “${nodeName}” from the future learning route for now.`;
      beforeValue = displayValue(before?.included ?? null);
      afterValue = displayValue(after?.included ?? operation.included);
      affectedNodeIds = [operation.nodeId];
      break;
    case "move_node": {
      const anchorId = operation.beforeNodeId ?? operation.afterNodeId!;
      const anchorName = nodeById.get(anchorId)?.label.en ?? "the referenced route node";
      const anchorDirection = operation.beforeNodeId ? "before" : "after";
      readableDescription = `Move “${nodeName}” from position ${before?.order ?? "?"} to ${anchorDirection} “${anchorName}”.`;
      beforeValue = before ? `Position ${before.order}` : "Unknown";
      afterValue = `${anchorDirection === "before" ? "Before" : "After"} ${anchorName}${after ? ` (position ${after.order})` : ""}`;
      affectedNodeIds = [operation.nodeId, anchorId];
      break;
    }
    case "set_node_priority": {
      const direction = !before || operation.priority === before.priority
        ? "Adjust"
        : operation.priority > before.priority
          ? "Raise"
          : "Lower";
      readableDescription = `${direction} the route priority for “${nodeName}”.`;
      beforeValue = displayValue(before?.priority ?? null);
      afterValue = displayValue(operation.priority);
      affectedNodeIds = [operation.nodeId];
      break;
    }
    case "set_target_week":
      readableDescription = `Change the target week for “${nodeName}” from ${before?.targetWeek ? `Week ${before.targetWeek}` : "Not set"} to Week ${operation.targetWeek}.`;
      beforeValue = before?.targetWeek ? `Week ${before.targetWeek}` : "Not set";
      afterValue = `Week ${operation.targetWeek}`;
      affectedNodeIds = [operation.nodeId];
      break;
    case "set_goal_depth":
      readableDescription = `Change the target depth for “${nodeName}” to ${operation.goalDepth === "mastery" ? "Mastery" : "Exposure"}.`;
      beforeValue = (before?.goalDepth ?? "mastery") === "mastery" ? "Mastery" : "Exposure";
      afterValue = operation.goalDepth === "mastery" ? "Mastery" : "Exposure";
      affectedNodeIds = [operation.nodeId];
      break;
    case "set_target_by_date":
      readableDescription = operation.targetByDate
        ? `Set the target date for “${nodeName}” to ${operation.targetByDate}.`
        : `Remove the target date for “${nodeName}”.`;
      beforeValue = displayValue(before?.targetByDate ?? null);
      afterValue = displayValue(operation.targetByDate);
      affectedNodeIds = [operation.nodeId];
      break;
    case "set_node_rationale":
      readableDescription = `Update the route rationale for “${nodeName}”.`;
      beforeValue = before?.rationale || "No rationale";
      afterValue = operation.rationale;
      affectedNodeIds = [operation.nodeId];
      break;
    case "set_mixed_window_days":
      readableDescription = `Change the mixed-practice window from ${baseSkeleton.mixedWindowDays} to ${operation.mixedWindowDays} days before the end date.`;
      beforeValue = `${baseSkeleton.mixedWindowDays} days`;
      afterValue = `${operation.mixedWindowDays} days`;
      break;
  }

  return {
    operationId: operation.operationId,
    operationType: operation.type,
    title: operationTitle(operation.type),
    readableDescription,
    affectedNodeIds: [...new Set(affectedNodeIds)].sort((left, right) => left.localeCompare(right)),
    beforeValue,
    afterValue,
    warnings: input.warnings,
    selectable: true,
    selectedByDefault: true,
  };
}

export function buildCampaignPatchReviewView(
  input: CampaignPatchReviewPresenterInput,
): CampaignPatchReviewView {
  const stored = storedCampaignSkeletonPatchOperationsSchema.parse(JSON.parse(input.patch.operationsJson));
  const rawBudget: unknown = input.patch.dailyBudgetSuggestionJson
    ? JSON.parse(input.patch.dailyBudgetSuggestionJson)
    : null;
  const legacyParsed = dailyBudgetSuggestionSchema.safeParse(rawBudget);
  const budgetEnvelope = rawBudget && typeof rawBudget === "object"
    ? rawBudget as { legacyDailyBudgetSuggestion?: unknown; dateBudgetSuggestions?: unknown }
    : {};
  const budgetSuggestion = legacyParsed.success
    ? legacyParsed.data
    : budgetEnvelope.legacyDailyBudgetSuggestion
      ? dailyBudgetSuggestionSchema.parse(budgetEnvelope.legacyDailyBudgetSuggestion)
      : null;
  const dateBudgetSuggestions = Array.isArray(budgetEnvelope.dateBudgetSuggestions)
    ? budgetEnvelope.dateBudgetSuggestions.map((entry) => dateBudgetSuggestionSchema.parse(entry))
    : [];
  const validation = validateCampaignSkeletonPatch({
    activeSkeleton: input.baseSkeleton,
    proposedPatch: {
      patchSchemaVersion: stored.patchSchemaVersion,
      baseVersion: input.patch.baseVersion,
      trigger: input.patch.trigger,
      rationale: input.patch.rationale,
      operations: stored.operations.map(operationWithoutId),
      dailyBudgetSuggestion: budgetSuggestion,
      dateBudgetSuggestions,
    },
    campaignGoal: { dailyQuestionBudget: input.currentDailyBudget },
  });
  if (!validation.resultingSkeletonPreview) {
    throw new Error("Stored Campaign Skeleton Patch cannot be safely presented.");
  }
  const operationWarnings = new Map<number, string[]>();
  for (const warning of validation.warnings) {
    const match = /^operations\.(\d+)/.exec(warning.path);
    if (!match) continue;
    const index = Number(match[1]);
    operationWarnings.set(index, [...(operationWarnings.get(index) ?? []), safeWarning(warning.code)]);
  }
  const status = campaignPatchStatusSchema.parse(input.patch.status);
  const isStale = input.patch.baseVersion !== input.activeVersion;
  const pending = status === "pending";
  const validationBlocked = validation.errors.length > 0;
  const now = input.now ?? new Date();
  const externalDataStale = Boolean(input.externalDataValidUntil && Date.parse(input.externalDataValidUntil) <= now.valueOf());
  return {
    patchId: input.patch.id,
    status,
    triggerLabel: TRIGGER_LABELS[input.patch.trigger] ?? "Route planning check",
    rationale: input.patch.rationale,
    createdAt: input.patch.createdAt.toISOString(),
    baseVersion: input.patch.baseVersion,
    activeVersion: input.activeVersion,
    isStale,
    operations: stored.operations.map((operation, index) => describeOperation({
      operation,
      baseSkeleton: input.baseSkeleton,
      preview: validation.resultingSkeletonPreview!,
      warnings: operationWarnings.get(index) ?? [],
    })),
    warnings: [
      ...new Set(validation.warnings.map((warning) => safeWarning(warning.code))),
      ...(validationBlocked ? ["This proposal does not currently pass route validation. Keep the current route or refresh later."] : []),
    ],
    impactSummary: {
      affectedNodeCount: validation.impactSummary.changedNodeCount,
      changesMixedWindowDays: validation.impactSummary.changesMixedWindowDays,
      currentDailyTaskUnaffected: true,
    },
    dailyBudgetSuggestion: budgetSuggestion
      ? {
          currentBudget: input.currentDailyBudget,
          proposedBudget: budgetSuggestion.proposedBudget,
          rationale: budgetSuggestion.rationale,
        }
      : null,
    dateBudgetSuggestions: dateBudgetSuggestions.map((suggestion) => ({
      campaignDate: suggestion.campaignDate,
      currentBudget: input.currentDailyBudget,
      maxQuestions: suggestion.maxQuestions,
      rationale: suggestion.rationale,
      expiresAt: suggestion.expiresAt ?? null,
      stale: externalDataStale || Boolean(suggestion.expiresAt && Date.parse(suggestion.expiresAt) <= now.valueOf()),
    })),
    externalDataAsOf: input.externalDataAsOf ?? null,
    externalDataValidUntil: input.externalDataValidUntil ?? null,
    externalDataStale,
    rejectedCandidateReasons: input.rejectedCandidateReasons ?? [],
    canAccept: pending && !isStale && !validationBlocked,
    canPartiallyAccept: pending && !isStale && !validationBlocked && stored.operations.length > 1,
    canReject: pending,
  };
}
