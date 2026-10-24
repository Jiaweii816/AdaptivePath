import type {
  AutomaticMemoryIntent,
  MemoryCandidate,
} from "./candidate-core.types";

export type RankableCandidate = {
  candidate: MemoryCandidate;
  projected: { bucket: "learner" | "reference" };
};

export function compareAutomaticCandidates(
  intent: AutomaticMemoryIntent,
  left: RankableCandidate,
  right: RankableCandidate,
) {
  const a = left.candidate;
  const b = right.candidate;
  const priorityDelta = rolePriority(intent, a.role) - rolePriority(intent, b.role);
  if (priorityDelta !== 0) return priorityDelta;
  const sourceDelta =
    sourcePriority(intent, a, left) - sourcePriority(intent, b, right);
  if (sourceDelta !== 0) return sourceDelta;
  const tierDelta =
    matchTierRank(a.retrievalSignals.matchTier) -
    matchTierRank(b.retrievalSignals.matchTier);
  if (tierDelta !== 0) return tierDelta;
  const recallDelta = recallFusionScore(b) - recallFusionScore(a);
  if (recallDelta !== 0) return recallDelta;
  if (a.retrievalSignals.intentFit !== b.retrievalSignals.intentFit) {
    return b.retrievalSignals.intentFit - a.retrievalSignals.intentFit;
  }
  return (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
}

function sourcePriority(
  intent: AutomaticMemoryIntent,
  candidate: MemoryCandidate,
  item: RankableCandidate,
) {
  if (item.projected.bucket === "reference") return 1;
  if (intent === "profile_meta_question") {
    if (candidate.source === "synthesis") return 0;
    if (candidate.source === "l2_fact") return 1;
    if (candidate.source === "onboarding_profile") return 2;
    return 3;
  }
  return candidate.source === "episode" || candidate.source === "l2_fact" ? 0 : 1;
}

function recallFusionScore(candidate: MemoryCandidate) {
  return (
    reciprocalRank(candidate.retrievalSignals.lexicalRank) +
    reciprocalRank(candidate.retrievalSignals.vectorRank)
  );
}

function reciprocalRank(rank: number | undefined) {
  return rank === undefined ? 0 : 1 / (60 + rank);
}

function matchTierRank(tier: MemoryCandidate["retrievalSignals"]["matchTier"]) {
  if (tier === "mechanism") return 0;
  if (tier === "concept") return 1;
  return 2;
}

function rolePriority(
  intent: AutomaticMemoryIntent,
  role: MemoryCandidate["role"],
) {
  if (intent === "profile_meta_question") {
    return role === "successful_transfer" ? 0 : role === "recurring_mistake" ? 1 : 2;
  }
  if (["review", "debug_followup", "execute_failed_ask", "run_case_request"].includes(intent)) {
    return role === "recurring_mistake" ? 0 : role === "saved_mistake_guide" ? 1 : 2;
  }
  if (["concept_question", "api_reference_question"].includes(intent)) {
    return role === "saved_knowledge" ? 0 : role === "domain_reference" ? 1 : 2;
  }
  return role === "successful_transfer" ? 0 : role === "learning_preference" ? 1 : 2;
}
