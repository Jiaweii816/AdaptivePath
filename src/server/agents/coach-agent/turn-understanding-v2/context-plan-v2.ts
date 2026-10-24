import type { ChatTurnContextNeeds } from "../coach-agent.types";
import type {
  BasisSource,
  RespondTurnRequest,
  TurnRequest,
  TurnUnderstandingV2,
} from "./turn-understanding-v2.types";

type MutableContextPlan = {
  -readonly [Key in keyof ChatTurnContextNeeds]: ChatTurnContextNeeds[Key];
};

function initialContext(): MutableContextPlan {
  return {
    // Truth is not an intent-classification privilege. The problem card,
    // workspace summary, and latest aligned execution are always available.
    workspace: true,
    currentCode: false,
    selectedTests: false,
    runEvidence: true,
    reviewContext: false,
    // Tier-1 personalization is ambient and subordinate on every turn.
    learnerSignals: true,
    handbook: false,
    episodes: false,
  };
}

function addBasis(context: MutableContextPlan, basis: BasisSource) {
  if (basis === "concept_kb" || basis === "api_kb") {
    context.handbook = true;
  }
  if (
    basis === "past_problems" ||
    basis === "past_mistakes" ||
    basis === "learner_profile"
  ) {
    context.episodes = true;
    context.learnerSignals = true;
  }
}

function projectResponse(
  context: MutableContextPlan,
  request: RespondTurnRequest,
) {
  if (request.target === "current") context.currentCode = true;
  if (request.target === "api" || request.target === "concept") {
    context.handbook = true;
  }
  if (request.deliverable === "fix") {
    context.selectedTests = true;
    context.reviewContext = true;
  }
  for (const basis of request.basis) addBasis(context, basis);
}

function projectEffect(context: MutableContextPlan, request: TurnRequest) {
  if (request.kind === "execute") {
    if (request.target === "current") context.currentCode = true;
    context.selectedTests = true;
    return;
  }
  if (request.kind === "persist" && request.collection === "mistake_book") {
    context.currentCode = true;
  }
}

/**
 * Context is an additive projection. Canonical truth stays visible regardless
 * of classification; Target and Basis only decide which richer material joins it.
 */
export function buildContextPlanV2(
  understanding: Pick<TurnUnderstandingV2, "requests" | "categoryDenials">,
): ChatTurnContextNeeds {
  const context = initialContext();
  for (const request of understanding.requests) {
    if (request.kind === "respond") projectResponse(context, request);
    else projectEffect(context, request);
  }
  const deniedBasis = new Set(
    understanding.categoryDenials
      .filter((denial) => denial.category === "basis")
      .map((denial) => denial.value),
  );
  if (deniedBasis.has("past_problems") || deniedBasis.has("past_mistakes")) {
    context.episodes = false;
  }
  if (deniedBasis.has("learner_profile")) {
    context.learnerSignals = false;
    context.episodes = false;
  }
  return context;
}
