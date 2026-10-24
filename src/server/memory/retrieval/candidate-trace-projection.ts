import type {
  CandidateSelectionDecision,
  MemoryCandidate,
} from "./candidate-core.types";

export function projectCandidateForTrace(
  candidate: MemoryCandidate,
  decision?: CandidateSelectionDecision,
) {
  return {
    candidateId: candidate.id,
    source: candidate.source,
    title: candidate.title,
    sourceProblem: candidate.sourceProblem,
    truthClass: candidate.truthClass,
    role: candidate.role,
    historyFacets: candidate.historyFacets,
    concepts: candidate.concepts,
    retrievalSignals: candidate.retrievalSignals,
    selected: decision?.selected ?? false,
    decisionReason: decision?.reason ?? "not_evaluated_for_this_selector",
  };
}
