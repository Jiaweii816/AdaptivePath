import { deriveProfile, type AttemptEvidence } from "@/features/adaptivepath/profile";
import { getQuestion } from "@/features/adaptivepath/content";

/**
 * Domain-specific memory projection behind the PatternCoach memory facade.
 * Converts the same durable evidence stored as ChatMessages/L1MemoryEvents
 * into a compact, auditable, *validated* agent context. The model cannot
 * write or promote these fields; the deterministic profile rules own them.
 */
export function buildBiologyMemoryContext(attempts:AttemptEvidence[]) {
  const profile=deriveProfile(attempts);
  return {
    domain:"biology_2e_section_12_2" as const,
    profile,
    recentEvidence:attempts.slice(-5).map(a=>({
      questionId:a.questionId,
      topic:getQuestion(a.questionId)?.topic??"unknown",
      mode:getQuestion(a.questionId)?.mode??"unknown",
      independent:!a.assisted,
      successful:a.evaluation.successful,
      reasoningScore:a.evaluation.reasoningScore,
      misconceptionTags:a.evaluation.misconceptionTags,
    })),
    learningConstraints:{
      stableRequiresDistinctIndependentTransfers:2,
      wrongChoiceIsNotProofOfMisconception:true,
      assistedWorkCannotPromoteStableMastery:true,
    },
  };
}
