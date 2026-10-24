import type { CoachChatIntent } from "../coach-agent.types";
import type {
  BasisSource,
  TurnUnderstandingV2,
} from "./turn-understanding-v2.types";

const BASIS_PRIORITY: readonly BasisSource[] = [
  "past_mistakes",
  "past_problems",
  "learner_profile",
  "practice_catalog",
  "api_kb",
  "concept_kb",
  "current_evidence",
];

const BASIS_MEMORY_INTENT: Record<BasisSource, CoachChatIntent> = {
  past_mistakes: "past_mistake_recall_request",
  past_problems: "past_problem_recall_request",
  learner_profile: "profile_meta_question",
  practice_catalog: "practice_request",
  api_kb: "api_reference_question",
  concept_kb: "concept_question",
  current_evidence: "general_followup",
};

/**
 * Selects the existing retrieval-profile key from Basis alone. The scalar key
 * is a memory-facade compatibility boundary; it never feeds intent back into V2.
 */
export function deriveMemoryIntentV2(
  understanding: Pick<TurnUnderstandingV2, "requests">,
): CoachChatIntent {
  const requestedBasis = new Set<BasisSource>();
  for (const request of understanding.requests) {
    if (request.kind !== "respond") continue;
    request.basis.forEach((basis) => requestedBasis.add(basis));
  }

  const selected = BASIS_PRIORITY.find((basis) => requestedBasis.has(basis));
  return selected ? BASIS_MEMORY_INTENT[selected] : "general_followup";
}
