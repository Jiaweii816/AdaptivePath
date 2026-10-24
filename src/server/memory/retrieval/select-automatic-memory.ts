import { compareAutomaticCandidates } from "./automatic-candidate-ranking";
import {
  cleanOptionalText,
  cleanSourceText,
  relevanceExplanation,
  sanitizeTeachingText,
  sourceLabel,
} from "./candidate-presentation";
import type {
  AutomaticMemoryIntent,
  AutomaticMemorySelection,
  CandidateSelectionDecision,
  CoachMemoryBrief,
  CompactReference,
  MemoryApplicability,
  MemoryCandidate,
  RetrievalQueryPlan,
  TeachableMemory,
} from "./candidate-core.types";

export type SelectAutomaticMemoryInput = {
  profileId: string;
  plan: RetrievalQueryPlan;
  candidates: MemoryCandidate[];
  outputPreferences?: string[];
  teachingStrategy?: string;
  retrievalStatus: CoachMemoryBrief["retrievalStatus"];
};

type Projected =
  | { kind: "teachable"; bucket: "learner" | "reference"; memory: TeachableMemory }
  | { kind: "reference"; bucket: "reference"; reference: CompactReference };

type Eligible = { candidate: MemoryCandidate; projected: Projected };

const MIN_INTENT_FIT = 0.35;
const PROFILE_MIN_INTENT_FIT = 0.55;
const RELATED_PATTERN_MIN_INTENT_FIT = 0.55;

export function selectAutomaticMemory(
  input: SelectAutomaticMemoryInput,
): AutomaticMemorySelection {
  const decisions: CandidateSelectionDecision[] = [];
  const eligible: Eligible[] = [];

  for (const candidate of input.candidates) {
    const result = evaluateCandidate(input.plan, candidate);
    if (typeof result === "string") {
      decisions.push({ candidateId: candidate.id, selected: false, reason: result });
    } else {
      eligible.push({ candidate, projected: result });
    }
  }

  eligible.sort((left, right) =>
    compareAutomaticCandidates(input.plan.intent, left, right),
  );

  const selected: Eligible[] = [];
  const usedBuckets = new Set<string>();
  for (const item of eligible) {
    if (selected.length >= 2) {
      decisions.push({ candidateId: item.candidate.id, selected: false, reason: "automatic_limit_reached" });
      continue;
    }
    const budgetKey = selectionBudgetKey(input.plan.intent, item);
    if (usedBuckets.has(budgetKey)) {
      decisions.push({ candidateId: item.candidate.id, selected: false, reason: "teaching_role_budget" });
      continue;
    }

    selected.push(item);
    usedBuckets.add(budgetKey);
    decisions.push({ candidateId: item.candidate.id, selected: true, reason: "selected_for_distinct_teaching_role" });
  }

  return {
    brief: {
      profileId: input.profileId,
      teachableMemories: selected.flatMap((item) =>
        item.projected.kind === "teachable" ? [item.projected.memory] : [],
      ),
      outputPreferences: uniqueStrings(input.outputPreferences ?? [])
        .filter((preference) => !/c\+\+/i.test(preference))
        .map((preference) => cleanOptionalText(preference))
        .filter((preference): preference is string => Boolean(preference))
        .slice(0, 3),
      teachingStrategy: cleanOptionalText(input.teachingStrategy),
      domainReferences: selected.flatMap((item) =>
        item.projected.kind === "reference" ? [item.projected.reference] : [],
      ),
      retrievalStatus: input.retrievalStatus,
    },
    decisions,
  };
}

function evaluateCandidate(
  plan: RetrievalQueryPlan,
  candidate: MemoryCandidate,
): Projected | string {
  if (!candidate.teachingText.trim()) return "empty_teaching_text";
  if (isSameProblemStaleNarrative(plan, candidate)) {
    return "same_problem_stale_narrative";
  }
  if (isUntrustedStatus(candidate.status)) return "untrusted_status";
  if (candidate.confidence !== undefined && candidate.confidence < 0.45) {
    return "low_confidence";
  }
  if (
    (candidate.truthClass === "learner_state" ||
      candidate.truthClass === "historical_evidence") &&
    candidate.evidenceRefs.length === 0
  ) {
    return "missing_evidence";
  }
  if (!roleAllowedForIntent(plan.intent, candidate.role)) {
    return "intent_policy_excluded_role";
  }
  const applicability = resolveApplicability(plan, candidate);
  if (!applicability) return "no_relevance_signal";

  const safeText = sanitizeTeachingText(candidate);
  if (!safeText) return "unsafe_or_non_human_teaching_text";

  if (candidate.role === "domain_reference") {
    return {
      kind: "reference",
      bucket: "reference",
      reference: {
        title: cleanSourceText(candidate.title, "Relevant reference"),
        content: safeText,
        sourceLabel: sourceLabel(candidate),
      },
    };
  }

  return {
    kind: "teachable",
    bucket:
      candidate.truthClass === "study_artifact" ? "reference" : "learner",
    memory: {
      kind: candidate.role,
      cue: safeText,
      sourceLabel: sourceLabel(candidate),
      learnerSignalBasis: signalBasis(candidate),
      applicability,
      whyRelevant: relevanceExplanation(candidate),
      evidenceRefs: [...candidate.evidenceRefs],
    },
  };
}

function resolveApplicability(
  plan: RetrievalQueryPlan,
  candidate: MemoryCandidate,
): MemoryApplicability | undefined {
  const signals = candidate.retrievalSignals;
  if (signals.matchTier === "none") return undefined;

  if (plan.intent === "profile_meta_question") {
    const profileTruth =
      candidate.truthClass === "self_reported_profile" ||
      candidate.truthClass === "learner_state" ||
      candidate.truthClass === "historical_evidence";
    return profileTruth && signals.intentFit >= PROFILE_MIN_INTENT_FIT
      ? "related_pattern"
      : undefined;
  }

  if (signals.intentFit < MIN_INTENT_FIT) return undefined;
  if (signals.matchTier === "mechanism") return "exact_pattern";
  if (
    signals.matchTier === "concept" &&
    candidate.evidenceRefs.length > 0 &&
    signals.intentFit >= RELATED_PATTERN_MIN_INTENT_FIT
  ) {
    return "related_pattern";
  }
  return "teaching_style_only";
}

function roleAllowedForIntent(
  intent: AutomaticMemoryIntent,
  role: MemoryCandidate["role"],
) {
  if (
    intent === "past_problem_recall_request" ||
    intent === "past_mistake_recall_request"
  ) {
    // Explicit history turns must be grounded by the required recall tool.
    // The shared candidate set remains available to that tool, but no passive
    // cue or domain reference is injected before the tool result exists.
    return false;
  }
  if (intent === "profile_meta_question") {
    return role === "successful_transfer" || role === "recurring_mistake";
  }
  if (["hint_request", "anxiety_or_stuck"].includes(intent)) {
    // A strongly relevant historical mistake is useful as a prevention cue.
    // The prompt keeps this scoped to prior evidence and forbids treating it
    // as proof that the current revision repeats the mistake.
    return role !== "saved_mistake_guide";
  }
  if (["optimization_request", "full_code_request"].includes(intent)) {
    return role !== "recurring_mistake";
  }
  if (intent === "practice_request") {
    return role !== "saved_knowledge" && role !== "domain_reference";
  }
  return true;
}

function isSameProblemStaleNarrative(
  plan: RetrievalQueryPlan,
  candidate: MemoryCandidate,
) {
  return (
    (candidate.source === "episode" || candidate.source === "problem_history") &&
    candidate.sourceProblem?.slug === plan.problem.slug
  );
}

function isUntrustedStatus(status: string | undefined) {
  if (!status) return false;
  return new Set([
    "development_noise",
    "invalid",
    "quarantined",
    "rejected",
    "superseded",
    "tombstoned",
  ]).has(status.trim().toLowerCase());
}

function selectionBudgetKey(intent: AutomaticMemoryIntent, item: Eligible) {
  if (item.projected.kind === "reference") return "reference";
  return item.candidate.role === "successful_transfer"
    ? intent === "profile_meta_question"
      ? "profile_strength"
      : "learner_transfer"
    : item.candidate.role === "recurring_mistake"
      ? intent === "profile_meta_question"
        ? "profile_growth_area"
        : "learner_prevention"
      : "learner_strategy";
}

function signalBasis(
  candidate: MemoryCandidate,
): TeachableMemory["learnerSignalBasis"] {
  if (candidate.truthClass === "self_reported_profile") return "self_reported";
  if (candidate.truthClass === "study_artifact") return "saved_by_learner";
  return "earned_evidence";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
