import type { CoachChatInput } from "../coach-agent.types";
import {
  PURE_DURABLE_INSTRUCTION,
  REQUIRED_ACTION_INSTRUCTION,
} from "../chat-policy-prompt";
import { backboneInstructions } from "./family-backbone";
import { modifierOverlayInstructions } from "./modifier-overlays";
import type { ResponseObjective, ResponsePlan } from "./response-plan.types";

const COMPOUND_INSTRUCTION =
  "[COMPOUND OBJECTIVES] Complete each objective in the user's stated order; do not merge or drop any. Give one short synthesis at the end.";

function hasModifierOverlay(plan: ResponsePlan): boolean {
  return (
    plan.modifiers.deliveryMode === "hint" ||
    plan.modifiers.affect === "anxious_stuck" ||
    plan.modifiers.codeDisclosure.level === "full_code" ||
    plan.modifiers.requestedArtifact === "full_implementation"
  );
}

function suppressModifierOnlyBackbone(plan: ResponsePlan): boolean {
  return (
    !plan.compound &&
    plan.backbone.family === "answer" &&
    plan.backbone.target === "active_problem" &&
    hasModifierOverlay(plan)
  );
}

function renderObjective(objective: ResponseObjective, index: number): string {
  const dependencies =
    objective.dependsOn.length > 0 ? objective.dependsOn.join(",") : "none";
  return `  ${index + 1}. operationId=${objective.operationId}; family=${objective.family}; target=${objective.target}; dependsOn=${dependencies}`;
}

function renderCompoundObjectives(plan: ResponsePlan): string[] {
  if (!plan.compound) return [];
  return [
    COMPOUND_INSTRUCTION,
    ...plan.objectives.map((objective, index) =>
      renderObjective(objective, index),
    ),
  ];
}

export function renderResponsePlanInstructions(
  plan: ResponsePlan,
  input: CoachChatInput,
): string[] {
  void input;
  if (plan.pureDurable) return [PURE_DURABLE_INSTRUCTION];

  const lines = suppressModifierOnlyBackbone(plan)
    ? []
    : [...backboneInstructions(plan.backbone)];
  lines.push(...modifierOverlayInstructions(plan.modifiers));
  lines.push(...renderCompoundObjectives(plan));
  if (plan.hasPendingRequiredAction) {
    lines.push(REQUIRED_ACTION_INSTRUCTION);
  }
  return lines;
}
