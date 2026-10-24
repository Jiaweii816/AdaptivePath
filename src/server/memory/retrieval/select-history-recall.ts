import type { MemoryCandidate, RetrievalQueryPlan } from "./candidate-core.types";
import {
  canonicalizeConcept,
  conceptsOverlap,
  extractKnownConcepts,
  isGenericConcept,
  normalizeConceptToken,
} from "./concepts";

export type HistoryRecallMode =
  | "past_problem_recall"
  | "past_mistake_recall";

export type HistoricalRecallItem = {
  kind: "past_problem" | "past_mistake";
  title: string;
  summary: string;
  sourceProblem?: { slug: string; title: string };
  outcome?: string;
  relationToCurrent: "same_problem_history" | "cross_problem_history" | "profile_only";
  learnerSignalBasis: "earned_evidence" | "self_reported" | "saved_by_learner";
  evidenceBasis:
    | "durable_negative_claim"
    | "accepted_negative_observation"
    | "learner_confirmed_artifact"
    | "validated_negative_synthesis"
    | "recorded_problem_activity"
    | "durable_nonnegative_claim"
    | "validated_profile_synthesis";
  mechanisms: string[];
  executionAuthority: "official" | "local_visible" | "mixed" | "not_applicable" | "unknown";
  resolutionStatus: "active" | "improving" | "resolved" | "unknown";
};

export type HistoryRecallSelection = {
  items: HistoricalRecallItem[];
  decisions: Array<{ candidateId: string; selected: boolean; reason: string }>;
};

const MIN_FOCUSED_RECALL_SCORE = 0.12;

export function selectHistoryRecall(args: {
  mode: HistoryRecallMode;
  query: string;
  searchHints?: string[];
  queryPlan: RetrievalQueryPlan;
  candidates: MemoryCandidate[];
  limit?: number;
}): HistoryRecallSelection {
  const terms = recallTerms(args.query, args.searchHints, args.queryPlan);
  const broadRecall = isBroadRecallQuery(args.query);
  const decisions: HistoryRecallSelection["decisions"] = [];
  const ranked = args.candidates
    .flatMap((candidate) => {
      if (recallEligible(args.mode, candidate)) return [candidate];
      decisions.push({
        candidateId: candidate.id,
        selected: false,
        reason: args.mode === "past_mistake_recall" ? "not_mistake_eligible" : "not_history_eligible",
      });
      return [];
    })
    .map((candidate) => ({
      candidate,
      score: recallScore(candidate, terms, args),
    }))
    .sort((left, right) => right.score - left.score);
  // A very strong same-problem/mechanism match must not raise the eligibility
  // floor for every other candidate. Explicit history recall is a bounded list,
  // not a winner-takes-all lookup: independently relevant cross-problem
  // evidence should survive even when the first result is an exact match.
  const focusedFloor = broadRecall ? 0 : MIN_FOCUSED_RECALL_SCORE;
  const items: HistoricalRecallItem[] = [];
  const dedupe = new Set<string>();
  let totalChars = 0;
  const limit = Math.min(8, Math.max(1, args.limit ?? 8));

  for (const { candidate, score } of ranked) {
    if (!broadRecall && relationClass(candidate, args.queryPlan, args.query) === "broad_history") {
      decisions.push({
        candidateId: candidate.id,
        selected: false,
        reason: "focused_scope_mismatch",
      });
      continue;
    }
    if (score < focusedFloor) {
      decisions.push({
        candidateId: candidate.id,
        selected: false,
        reason: "insufficient_relevance",
      });
      continue;
    }
    const item = projectRecallItem(args.mode, candidate, args.queryPlan);
    const key = `${item.kind}:${item.sourceProblem?.slug ?? item.title}:${item.summary}`;
    if (dedupe.has(key)) {
      decisions.push({ candidateId: candidate.id, selected: false, reason: "duplicate" });
      continue;
    }
    if (items.length >= limit || totalChars + item.summary.length > 1800) {
      decisions.push({ candidateId: candidate.id, selected: false, reason: "recall_budget" });
      continue;
    }
    if (score < 0.12 && items.length >= 3) {
      decisions.push({ candidateId: candidate.id, selected: false, reason: "weak_tail" });
      continue;
    }
    items.push(item);
    dedupe.add(key);
    totalChars += item.summary.length;
    decisions.push({ candidateId: candidate.id, selected: true, reason: "recall_first_rank" });
  }

  return { items, decisions };
}

function relationClass(candidate: MemoryCandidate, plan: RetrievalQueryPlan, query: string) {
  if (candidate.sourceProblem?.slug === plan.problem.slug) return "same_problem";
  if (candidate.retrievalSignals.mechanismMatch) return "same_mechanism";
  if (candidate.retrievalSignals.conceptMatch === "active") return "same_concept";
  if (
    conceptsOverlap(
      plan.concepts.candidate.map((concept) => concept.tag),
      candidate.concepts,
    )
  ) {
    return "same_concept";
  }
  const candidateText = canonicalizeConcept(`${candidate.title} ${candidate.teachingText}`);
  const lexicalTerms = normalizeConceptToken(query)
    .split("_")
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
  if (lexicalTerms.some((term) => candidateText.includes(term))) return "same_concept";
  return "broad_history";
}

function matchesExplicitConcept(
  candidate: MemoryCandidate,
  explicitConcepts: string[],
) {
  const readableText = canonicalizeConcept(
    `${candidate.title} ${candidate.teachingText}`,
  );
  return explicitConcepts.some((concept) => {
    const canonical = canonicalizeConcept(concept);
    return (
      conceptsOverlap([canonical], candidate.concepts) ||
      readableText.includes(canonical)
    );
  });
}

function recallEligible(mode: HistoryRecallMode, candidate: MemoryCandidate) {
  if (candidate.truthClass === "domain_reference") return false;
  if (candidate.source === "onboarding_profile") return false;
  if (mode === "past_mistake_recall") {
    return candidate.historyFacets?.includes("past_mistake") === true;
  }
  return (
    candidate.historyFacets?.includes("past_problem") === true ||
    candidate.truthClass === "historical_evidence" ||
    candidate.source === "l2_fact" ||
    candidate.source === "mistake_book"
  );
}

function recallScore(
  candidate: MemoryCandidate,
  terms: ReturnType<typeof recallTerms>,
  args: {
    mode: HistoryRecallMode;
    query: string;
    queryPlan: RetrievalQueryPlan;
  },
) {
  const text = canonicalizeConcept(
    [
      candidate.title,
      candidate.teachingText,
      candidate.sourceProblem?.title,
      candidate.sourceProblem?.slug,
      ...candidate.concepts,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const explicitLexical = termScore(text, terms.explicit, 0.05, 0.25);
  const hintLexical = termScore(text, terms.hints, 0.02, 0.08);
  const runtimeLexical = termScore(text, terms.runtime, 0.04, 0.24);
  const activeConcept = conceptsOverlap(
    args.queryPlan.concepts.active,
    candidate.concepts,
  );
  const sameProblem =
    candidate.sourceProblem?.slug === args.queryPlan.problem.slug;
  const mistakeFit =
    args.mode === "past_mistake_recall" && candidate.role === "recurring_mistake";
  const explicitConcepts = extractKnownConcepts(args.query).filter(
    (concept) => !isGenericConcept(concept),
  );
  const explicitConceptAdjustment =
    explicitConcepts.length === 0
      ? 0
      : matchesExplicitConcept(candidate, explicitConcepts)
        ? 0.35
        : 0;
  return (
    explicitLexical +
    hintLexical +
    runtimeLexical +
    (activeConcept ? 0.55 : 0) +
    (candidate.retrievalSignals.matchTier !== "none" ? 0.12 : 0) +
    (candidate.retrievalSignals.mechanismMatch ? 0.65 : 0) +
    (mistakeFit ? 0.03 : 0) +
    Math.min(0.12, Math.max(0, (candidate.saveCount ?? 1) - 1) * 0.04) +
    (sameProblem ? 0.03 : 0) +
    candidate.retrievalSignals.intentFit * 0.02 +
    explicitConceptAdjustment
  );
}

function projectRecallItem(
  mode: HistoryRecallMode,
  candidate: MemoryCandidate,
  plan: RetrievalQueryPlan,
): HistoricalRecallItem {
  return {
    kind: mode === "past_mistake_recall" ? "past_mistake" : "past_problem",
    title: clean(candidate.title, 100),
    summary: clean(candidate.teachingText, 360),
    sourceProblem: candidate.sourceProblem,
    outcome: candidate.outcome,
    relationToCurrent: candidate.sourceProblem
      ? candidate.sourceProblem.slug === plan.problem.slug
        ? "same_problem_history"
        : "cross_problem_history"
      : "profile_only",
    learnerSignalBasis:
      candidate.truthClass === "self_reported_profile"
        ? "self_reported"
        : candidate.truthClass === "study_artifact"
          ? "saved_by_learner"
          : "earned_evidence",
    evidenceBasis:
      candidate.mistakeRecallBasis?.kind ??
      (candidate.source === "problem_history"
        ? "recorded_problem_activity"
        : candidate.source === "synthesis"
          ? "validated_profile_synthesis"
          : "durable_nonnegative_claim"),
    mechanisms: candidate.concepts
      .slice(0, 4)
      .map((concept) => concept.replaceAll("_", " ")),
    executionAuthority:
      candidate.historyProvenance?.executionAuthority ??
      (candidate.mistakeRecallBasis?.kind === "learner_confirmed_artifact"
        ? "not_applicable"
        : "unknown"),
    resolutionStatus:
      candidate.historyProvenance?.resolutionStatus ??
      (candidate.status === "active" ||
      candidate.status === "improving" ||
      candidate.status === "resolved"
        ? candidate.status
        : "unknown"),
  };
}

function recallTerms(
  query: string,
  searchHints: string[] | undefined,
  plan: RetrievalQueryPlan,
) {
  return {
    explicit: uniqueTerms([
      ...extractKnownConcepts(query),
      ...lexicalTerms(query),
    ]),
    hints: uniqueTerms([
      ...extractKnownConcepts((searchHints ?? []).join(" ")),
      ...(searchHints ?? []).flatMap(lexicalTerms),
    ]),
    runtime: uniqueTerms([
      ...plan.concepts.active,
      ...plan.queryTerms.map((term) => term.value),
    ]),
  };
}

function lexicalTerms(value: string) {
  const normalized = normalizeConceptToken(value);
  if (!normalized) return [];
  const tokens = normalized
    .split("_")
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  const bigrams = tokens.slice(0, -1).map(
    (token, index) => `${token}_${tokens[index + 1]}`,
  );
  return [normalized, ...tokens, ...bigrams];
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "past",
  "before",
  "previous",
  "problem",
  "mistake",
  "what",
  "which",
  "was",
  "were",
  "did",
  "does",
  "have",
  "has",
  "my",
  "me",
]);

function uniqueTerms(values: string[]) {
  return values
    .map(canonicalizeConcept)
    .filter((term, index, all) => term && all.indexOf(term) === index);
}

function termScore(
  text: string,
  terms: string[],
  weight: number,
  cap: number,
) {
  return Math.min(
    cap,
    terms.reduce(
      (score, term) => score + (text.includes(term) ? weight : 0),
      0,
    ),
  );
}

function isBroadRecallQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  return [
    /^(?:what|which)?\s*(?:are|were)?\s*(?:my )?(?:past|previous)?\s*(?:mistakes?|problems?|history)\??$/,
    /^(?:show|tell) me (?:my )?(?:past )?(?:mistakes?|problems?|history)\??$/,
    /^(?:我)?(?:以前|之前|过去)?(?:有过|做过|犯过)?(?:什么|哪些)?(?:错|错误|问题|题|历史)[？?]?$/,
  ].some((pattern) => pattern.test(normalized));
}

function clean(value: string, limit: number) {
  const normalized = value
    .replace(/\bconfidence\s*[:=]?\s*\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b(?:cm[a-z0-9]{18,}|trace[-_:][a-z0-9_-]{6,})\b/gi, " ")
    .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi, (token) =>
      token.replaceAll("_", " "),
    )
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}
