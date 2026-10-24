import { campaignDateSchema, type SkeletonProjection } from "../domain/contracts";
import {
  campaignSkeletonPatchProposalSchema,
  canonicalJson,
  type CampaignSkeletonPatchOperation,
} from "../domain/skeleton-patch-contracts";
import {
  validateCampaignSkeletonPatch,
  type CampaignSkeletonPatchIssue,
  type CampaignSkeletonPatchValidationInput,
  type CampaignSkeletonPatchValidationResult,
} from "./skeleton-patch-validator";

export const STRATEGIST_PROPOSAL_POLICY_SCHEMA_VERSION = 1 as const;

export type StrategistPolicyGoalSource = Readonly<{
  nodeId: string;
  source: "user" | "system";
}>;

export type StrategistPolicyAcceptedChange = Readonly<{
  operationType: CampaignSkeletonPatchOperation["type"];
  nodeId?: string;
  beforeValue: unknown;
  afterValue: unknown;
  acceptedAt: string;
}>;

export type StrategistPolicyNewFact = Readonly<{
  type:
    | "mastery"
    | "repair_trigger"
    | "user_constraint"
    | "deadline_change"
    | "external_observation";
  observedAt: string;
  nodeId?: string;
}>;

export type StrategistProposalPolicyContext = Readonly<{
  schemaVersion: typeof STRATEGIST_PROPOSAL_POLICY_SCHEMA_VERSION;
  activeSkeletonVersion: number;
  planningHorizon: Readonly<{ startDate: string; endDate: string }>;
  goalSources: readonly StrategistPolicyGoalSource[];
  currentDailyTask?: Readonly<{ taskId: string; campaignDate: string }> | null;
  externalFreshness?: Readonly<{ observedAt: string; expiresAt: string }> | null;
  recentlyAcceptedChanges?: readonly StrategistPolicyAcceptedChange[];
  newFacts?: readonly StrategistPolicyNewFact[];
  evaluatedAt: string;
}>;

export type StrategistProposalPolicyValidationResult = Readonly<{
  valid: boolean;
  errors: readonly CampaignSkeletonPatchIssue[];
  warnings: readonly CampaignSkeletonPatchIssue[];
  skeletonValidation: CampaignSkeletonPatchValidationResult;
  resultingSkeletonPreview: SkeletonProjection | null;
}>;

function issueSort(left: CampaignSkeletonPatchIssue, right: CampaignSkeletonPatchIssue) {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code);
}

function parseInstant(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : parsed;
}

function operationResultValue(
  operation: CampaignSkeletonPatchOperation,
  preview: SkeletonProjection | null,
): unknown {
  if (operation.type === "set_mixed_window_days") return preview?.mixedWindowDays ?? operation.mixedWindowDays;
  const plan = preview?.nodePlans.find((entry) => entry.nodeId === operation.nodeId);
  if (!plan) return null;
  switch (operation.type) {
    case "set_node_included": return plan.included;
    case "set_goal_depth": return plan.goalDepth ?? "mastery";
    case "set_target_by_date": return plan.targetByDate ?? null;
    case "set_target_week": return plan.targetWeek;
    case "set_node_priority": return plan.priority;
    case "set_node_rationale": return plan.rationale;
    case "move_node": return plan.order;
  }
}

function hasNewFactAfter(
  context: StrategistProposalPolicyContext,
  accepted: StrategistPolicyAcceptedChange,
): boolean {
  return (context.newFacts ?? []).some((fact) =>
    fact.observedAt > accepted.acceptedAt &&
    (!fact.nodeId || !accepted.nodeId || fact.nodeId === accepted.nodeId),
  );
}

/**
 * Policy-only validation layered on the M4A Skeleton Validator. Curriculum
 * existence, required edges, ordering, and Skeleton legality stay in M4A.
 */
export function validateStrategistProposalPolicy(input: {
  skeleton: CampaignSkeletonPatchValidationInput;
  context: StrategistProposalPolicyContext;
}): StrategistProposalPolicyValidationResult {
  const skeletonValidation = validateCampaignSkeletonPatch(input.skeleton);
  const errors: CampaignSkeletonPatchIssue[] = [...skeletonValidation.errors];
  const warnings: CampaignSkeletonPatchIssue[] = [...skeletonValidation.warnings];
  const proposal = campaignSkeletonPatchProposalSchema.safeParse(input.skeleton.proposedPatch);
  const { context } = input;

  if (context.schemaVersion !== STRATEGIST_PROPOSAL_POLICY_SCHEMA_VERSION) {
    errors.push({ code: "unsupported_policy_context", path: "policy.schemaVersion", message: "Unsupported Strategist policy context schema version." });
  }
  if (context.activeSkeletonVersion !== input.skeleton.activeSkeleton.version) {
    errors.push({ code: "stale_policy_context", path: "policy.activeSkeletonVersion", message: "Policy context no longer describes the active Skeleton version." });
  }
  const startValid = campaignDateSchema.safeParse(context.planningHorizon.startDate).success;
  const endValid = campaignDateSchema.safeParse(context.planningHorizon.endDate).success;
  if (!startValid || !endValid || context.planningHorizon.startDate > context.planningHorizon.endDate) {
    errors.push({ code: "invalid_planning_horizon", path: "policy.planningHorizon", message: "Planning horizon must be an ordered pair of real campaign dates." });
  }
  const evaluatedAt = parseInstant(context.evaluatedAt);
  if (!evaluatedAt) {
    errors.push({ code: "invalid_policy_clock", path: "policy.evaluatedAt", message: "Policy evaluation time must be a canonical UTC instant." });
  }
  if (context.externalFreshness) {
    const observedAt = parseInstant(context.externalFreshness.observedAt);
    const expiresAt = parseInstant(context.externalFreshness.expiresAt);
    if (!observedAt || !expiresAt || observedAt > expiresAt || (evaluatedAt && expiresAt < evaluatedAt)) {
      errors.push({ code: "invalid_external_freshness", path: "policy.externalFreshness", message: "External freshness must be valid and unexpired at evaluation time." });
    }
  }

  if (proposal.success) {
    const planByNode = new Map(input.skeleton.activeSkeleton.nodePlans.map((plan) => [plan.nodeId, plan]));
    const userGoals = new Set(context.goalSources.filter((goal) => goal.source === "user").map((goal) => goal.nodeId));
    for (const [index, operation] of proposal.data.operations.entries()) {
      if (operation.type === "set_node_included" && !operation.included && userGoals.has(operation.nodeId)) {
        errors.push({ code: "user_goal_removal_forbidden", path: `operations.${index}`, message: `User-sourced goal '${operation.nodeId}' cannot be removed.` });
      }
      if (operation.type === "set_goal_depth" && userGoals.has(operation.nodeId)) {
        const before = planByNode.get(operation.nodeId)?.goalDepth ?? "mastery";
        if (before === "exposure" && operation.goalDepth !== "mastery" && operation.goalDepth !== before) {
          errors.push({ code: "invalid_user_goal_depth_change", path: `operations.${index}`, message: "User goals may only be upgraded to mastery or downgraded from mastery to exposure." });
        }
      }
      if (operation.type === "set_target_by_date" && operation.targetByDate !== null) {
        const validDate = campaignDateSchema.safeParse(operation.targetByDate).success;
        if (!validDate || operation.targetByDate < context.planningHorizon.startDate || operation.targetByDate > context.planningHorizon.endDate) {
          errors.push({ code: "target_date_outside_horizon", path: `operations.${index}.targetByDate`, message: "targetByDate must be a real date inside the planning horizon." });
        }
      }
      const currentValue = operationResultValue(operation, skeletonValidation.resultingSkeletonPreview);
      const inverse = (context.recentlyAcceptedChanges ?? []).find((accepted) =>
        accepted.operationType === operation.type &&
        accepted.nodeId === ("nodeId" in operation ? operation.nodeId : undefined) &&
        canonicalJson(accepted.beforeValue) === canonicalJson(currentValue) &&
        !hasNewFactAfter(context, accepted),
      );
      if (inverse) {
        errors.push({ code: "exact_reverse_patch_churn", path: `operations.${index}`, message: "This operation exactly reverses a recently accepted change without a newer planning fact." });
      }
    }
    for (const [index, suggestion] of (proposal.data.dateBudgetSuggestions ?? []).entries()) {
      const validDate = campaignDateSchema.safeParse(suggestion.campaignDate).success;
      if (!validDate || suggestion.campaignDate < context.planningHorizon.startDate || suggestion.campaignDate > context.planningHorizon.endDate) {
        errors.push({ code: "budget_date_outside_horizon", path: `dateBudgetSuggestions.${index}.campaignDate`, message: "Date budget suggestion must be inside the planning horizon." });
      }
      if (
        context.currentDailyTask &&
        suggestion.campaignDate === context.currentDailyTask.campaignDate
      ) {
        errors.push({ code: "date_budget_conflicts_with_today", path: `dateBudgetSuggestions.${index}.campaignDate`, message: "An already generated Today task cannot receive a date budget override." });
      }
      if (suggestion.expiresAt) {
        const expiresAt = parseInstant(suggestion.expiresAt);
        if (!expiresAt || suggestion.expiresAt.slice(0, 10) < suggestion.campaignDate || (evaluatedAt && expiresAt < evaluatedAt)) {
          errors.push({ code: "invalid_budget_expiration", path: `dateBudgetSuggestions.${index}.expiresAt`, message: "A date budget expiration must remain fresh through its campaign date." });
        }
      }
    }
  }

  errors.sort(issueSort);
  warnings.sort(issueSort);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    skeletonValidation,
    resultingSkeletonPreview: skeletonValidation.resultingSkeletonPreview,
  };
}
