import type { CoachChatInput } from "../coach-agent.types";
import type {
  RespondTurnRequest,
  TurnRequest,
  TurnUnderstandingV2,
} from "../turn-understanding-v2/turn-understanding-v2.types";
import type {
  ReplyDirective,
  ReplyPrecondition,
  ResponsePlanV2,
  TransferPlan,
} from "./response-plan-v2.types";

export type BuildResponsePlanV2Options = {
  /** Transitional override for callers that still own durable-turn state. */
  readonly pureDurable?: boolean;
};

function preconditionAction(request: TurnRequest): ReplyPrecondition["action"] {
  if (request.kind === "respond") return "respond";
  if (request.kind === "execute") {
    return request.target === "candidate"
      ? "execute_candidate"
      : "execute_current";
  }
  return `persist_${request.collection}`;
}

function transferPlan(request: RespondTurnRequest): TransferPlan | undefined {
  const sources = request.basis.filter(
    (basis): basis is "past_problems" | "learner_profile" =>
      basis === "past_problems" || basis === "learner_profile",
  );
  if (sources.length === 0) return undefined;

  return {
    sources,
    kernel:
      "Extract one reusable algorithmic kernel from the recalled problem evidence or learner profile; do not transfer surface details.",
    difference:
      "Name the decisive difference between that prior pattern and the current Active Problem Card.",
    mapping:
      "Map the learner's demonstrated pattern onto the current problem's state, invariant, and next operation.",
    strengthBridge:
      "Start from an evidenced strength. If the current problem needs a weak or unknown skill, bridge from the nearest strength and do not claim mastery.",
    currentCardAnchor:
      "Keep every comparison anchored to the Active Problem Card. Transfer the pattern only; never treat a recalled problem or profile cue as the current problem.",
  };
}

function buildDirective(
  request: RespondTurnRequest,
  byId: ReadonlyMap<string, TurnRequest>,
): ReplyDirective {
  const preconditions = request.dependsOn.flatMap((requestId) => {
    const dependency = byId.get(requestId);
    return dependency
      ? [
          {
            requestId,
            kind: dependency.kind,
            action: preconditionAction(dependency),
          } satisfies ReplyPrecondition,
        ]
      : [];
  });

  return {
    request,
    coreTask: request.deliverable,
    deliveryMode: request.delivery,
    preconditions,
    transferPlan: transferPlan(request),
  };
}

export function buildResponsePlanV2(
  understanding: TurnUnderstandingV2,
  input: CoachChatInput,
  options: BuildResponsePlanV2Options = {},
): ResponsePlanV2 {
  const objectives = [...understanding.requests];
  const byId = new Map(objectives.map((request) => [request.id, request]));
  const directives = objectives
    .filter(
      (request): request is RespondTurnRequest => request.kind === "respond",
    )
    .map((request) => buildDirective(request, byId));
  const persistOnly =
    objectives.length > 0 &&
    objectives.every((request) => request.kind === "persist");

  return {
    objectives,
    directives,
    disclosure: understanding.disclosure,
    affect: understanding.affect,
    route: understanding.route,
    languageScope: understanding.languageScope,
    compound: objectives.length > 1,
    pureDurable: options.pureDurable ?? persistOnly,
    hasPendingRequiredAction: Boolean(
      input.requiredActions?.some((action) => action.status === "pending"),
    ),
    campaignPolicy: input.campaignCoaching?.policy,
  };
}
