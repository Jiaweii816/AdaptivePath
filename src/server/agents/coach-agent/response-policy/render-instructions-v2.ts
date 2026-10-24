import type { CoachChatInput } from "../coach-agent.types";
import {
  PURE_DURABLE_INSTRUCTION,
  REQUIRED_ACTION_INSTRUCTION,
} from "../chat-policy-prompt";
import type { TurnRequest } from "../turn-understanding-v2/turn-understanding-v2.types";
import { presentationOverlayInstructions } from "./presentation-overlays-v2";
import type {
  ReplyDirective,
  ResponsePlanV2,
  TransferPlan,
} from "./response-plan-v2.types";
import {
  effectBackboneInstructions,
  responseTaskBackboneInstructions,
} from "./task-backbone-v2";

const COMPOUND_INSTRUCTION =
  "[COMPOUND OBJECTIVES] Complete every request in the listed order. Honor dependsOn before answering a dependent request; do not merge or drop requests.";

const STUCK_INSTRUCTION =
  "[STUCK] Acknowledge briefly, reduce cognitive load, narrow the work to one decision, and end with one doable action.";

function requestSummary(request: TurnRequest, index: number): string {
  const details =
    request.kind === "respond"
      ? `; deliverable=${request.deliverable}; target=${request.target}; basis=${request.basis.join("+")}; delivery=${request.delivery.depth}/${request.delivery.form}`
      : request.kind === "execute"
        ? `; target=${request.target}`
        : `; collection=${request.collection}`;
  const dependencies =
    request.dependsOn.length > 0 ? request.dependsOn.join(",") : "none";
  return `  ${index + 1}. requestId=${request.id}; kind=${request.kind}${details}; dependsOn=${dependencies}`;
}

function preconditionInstructions(directive: ReplyDirective): string[] {
  if (directive.preconditions.length === 0) return [];
  return [
    `[PRECONDITIONS] Before objective ${directive.request.id}, complete and use these dependencies in order: ${directive.preconditions.map((item) => `${item.requestId}:${item.action}`).join(", ")}.`,
  ];
}

function transferInstructions(plan: TransferPlan): string[] {
  return [
    `[TRANSFER PLAN] Basis sources: ${plan.sources.join(", ")}. This is personalization material, never current-problem identity or diagnostic evidence.`,
    `1. Kernel: ${plan.kernel}`,
    `2. Difference: ${plan.difference}`,
    `3. Mapping: ${plan.mapping}`,
    `4. Strength bridge: ${plan.strengthBridge}`,
    `5. Current-card anchor: ${plan.currentCardAnchor}`,
  ];
}

function directiveInstructions(directive: ReplyDirective): string[] {
  return [
    ...preconditionInstructions(directive),
    ...responseTaskBackboneInstructions(directive),
    ...presentationOverlayInstructions(directive),
    ...(directive.transferPlan
      ? transferInstructions(directive.transferPlan)
      : []),
  ];
}

export function renderResponsePlanV2Instructions(
  plan: ResponsePlanV2,
  input: CoachChatInput,
): string[] {
  void input;
  if (plan.route.kind === "clarify") {
    return [
      `[CLARIFY] Ask one concise question to resolve ${plan.route.clarificationReason}. Do not run code or perform a durable write before the backend supplies an authorized, resolved request.`,
    ];
  }
  if (plan.pureDurable) return [PURE_DURABLE_INSTRUCTION];

  const lines: string[] = [];
  if (plan.compound) {
    lines.push(COMPOUND_INSTRUCTION, ...plan.objectives.map(requestSummary));
  }

  const directiveByRequestId = new Map(
    plan.directives.map((directive) => [directive.request.id, directive]),
  );
  for (const request of plan.objectives) {
    if (plan.compound) lines.push(`Objective ${request.id} policy:`);
    const directive = directiveByRequestId.get(request.id);
    lines.push(
      ...(directive
        ? directiveInstructions(directive)
        : effectBackboneInstructions(request)),
    );
  }
  if (plan.affect === "anxious_stuck") lines.push(STUCK_INSTRUCTION);
  if (plan.languageScope.unsupportedLanguage) {
    lines.push(
      "[PYTHON-ONLY] The user mentioned a non-Python language. Keep the answer within the product's Python-only scope; do not provide or execute a non-Python implementation.",
    );
  }
  if (plan.hasPendingRequiredAction) lines.push(REQUIRED_ACTION_INSTRUCTION);
  return lines;
}
