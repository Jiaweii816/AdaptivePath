import type { IntentMatch } from "../chat-intent-policy";
import type { CoachChatIntent } from "../coach-agent.types";
import type {
  BasisSource,
  RespondTurnRequest,
  TurnUnderstandingV2,
} from "./turn-understanding-v2.types";

const BASIS_INTENT_PRIORITY: readonly BasisSource[] = [
  "past_mistakes",
  "past_problems",
  "learner_profile",
  "practice_catalog",
  "api_kb",
];

const BASIS_INTENT: Partial<Record<BasisSource, CoachChatIntent>> = {
  past_mistakes: "past_mistake_recall_request",
  past_problems: "past_problem_recall_request",
  learner_profile: "profile_meta_question",
  practice_catalog: "practice_request",
  api_kb: "api_reference_question",
};

/**
 * Compatibility scalar for persistence and teaching-state presentation. The
 * V2 request graph remains canonical; this projection never feeds decisions
 * back into it or consults the retired single-label plan.
 */
export function deriveIntentMatchV2(
  understanding: TurnUnderstandingV2,
): IntentMatch {
  const intent = intentFromUnderstanding(understanding);
  return {
    intent,
    confidence: confidenceFor(understanding),
    rationale: `Derived from Turn Understanding V2 requests (${intent}).`,
  };
}

function intentFromUnderstanding(
  understanding: TurnUnderstandingV2,
): CoachChatIntent {
  if (understanding.affect === "anxious_stuck") return "anxiety_or_stuck";

  const response = firstResponse(understanding);
  const basisIntent = intentFromBasis(understanding);
  if (basisIntent) return basisIntent;
  if (understanding.requests.some((request) => request.kind === "execute")) {
    return "run_case_request";
  }
  if (
    understanding.requests.some(
      (request) => request.kind === "persist" && request.collection === "mistake_book",
    )
  ) {
    return "mistake_book_save_request";
  }
  if (!response) return "general_followup";
  if (response.delivery.depth === "full") return "full_code_request";
  if (response.deliverable === "solve" && response.delivery.depth === "hint") {
    return "hint_request";
  }
  if (response.deliverable === "fix") return "debug_followup";
  if (response.deliverable === "improve") return "optimization_request";
  if (response.deliverable === "recommend") return "practice_request";
  if (response.target === "api") return "api_reference_question";
  if (response.deliverable === "understand") return "concept_question";
  return "general_followup";
}

function firstResponse(
  understanding: TurnUnderstandingV2,
): RespondTurnRequest | undefined {
  return understanding.requests.find(
    (request): request is RespondTurnRequest => request.kind === "respond",
  );
}

function intentFromBasis(
  understanding: TurnUnderstandingV2,
): CoachChatIntent | undefined {
  const basis = new Set<BasisSource>();
  understanding.requests.forEach((request) => {
    if (request.kind === "respond") request.basis.forEach((item) => basis.add(item));
  });
  const selected = BASIS_INTENT_PRIORITY.find((item) => basis.has(item));
  return selected ? BASIS_INTENT[selected] : undefined;
}

function confidenceFor(understanding: TurnUnderstandingV2): number {
  if (understanding.route.kind === "fast_path") return 0.9;
  if (understanding.route.kind === "model_assembled") return 0.75;
  return 0.6;
}
