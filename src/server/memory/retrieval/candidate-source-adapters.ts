import type { Prisma } from "@prisma/client";
import { readDurableFactIntegrity } from "@/server/memory/integrity/memory-integrity-policy";
import { safeStoredMemoryTeachingText } from "@/server/memory/store/episode-store";
import { readableFactTeachingText } from "@/server/memory/store/memory-document-content";
import { mistakeRecallBasis } from "./mistake-eligibility";
import type { MemoryCandidate, RetrievalQueryPlan } from "./candidate-core.types";
import {
  canonicalizeConcept,
  classifyProblemConcepts,
  conceptsOverlap,
  extractKnownConcepts,
  isGenericConcept,
} from "./concepts";

export type FactCandidateRow = Prisma.L2MemoryFactGetPayload<{
  include: { problem: true };
}>;
export type EpisodeCandidateRow = Prisma.MemoryEpisodeGetPayload<{
  include: { problem: true; claimObservations: true };
}>;
export type ProblemHistoryCandidateRow = Prisma.ProblemHistoryGetPayload<{
  include: { problem: true };
}>;
export type SynthesisCandidateRow = Prisma.SynthesisSlotGetPayload<object>;
export type MistakeBookCandidateRow = Prisma.MistakeBookEntryGetPayload<{
  include: { problem: true };
}>;

export function mistakeBookCandidate(
  entry: MistakeBookCandidateRow,
  plan: RetrievalQueryPlan,
  ranks: Map<string, number>,
  vectorRanks: Map<string, number> = new Map(),
): MemoryCandidate | undefined {
  const teachingText = safeStoredMemoryTeachingText(entry.guideMarkdown);
  if (!teachingText || entry.memoryOrigin !== "learner") return undefined;
  const basis = mistakeRecallBasis({
    source: "mistake_book",
    mistakeBookEntryId: entry.id,
  });
  if (!basis) return undefined;
  const concepts = [
    ...new Set([
      ...classifyProblemConcepts(parseStrings(entry.tags)).candidate.map((candidate) => candidate.tag),
      ...problemConcepts(entry.problem.tags),
    ]),
  ];
  return {
    id: entry.id,
    source: "mistake_book",
    truthClass: "study_artifact",
    role: "saved_mistake_guide",
    historyFacets: ["past_problem", "past_mistake"],
    mistakeRecallBasis: basis,
    title: entry.title,
    teachingText,
    concepts,
    sourceProblem: { slug: entry.problem.slug, title: entry.problem.title },
    evidenceRefs: [entry.id, ...parseStrings(entry.sourceTraceIds)],
    updatedAt: entry.lastSavedAt,
    saveCount: entry.saveCount,
    retrievalSignals: signalsFor({
      plan,
      concepts,
      text: `${entry.title} ${teachingText} ${entry.selfCheckQuestion ?? ""}`,
      lexicalRank: ranks.get(entry.id),
      vectorRank: vectorRanks.get(entry.id),
      role: "saved_mistake_guide",
    }),
  };
}

export function factCandidate(
  fact: FactCandidateRow,
  plan: RetrievalQueryPlan,
  ranks: Map<string, number>,
  vectorRanks: Map<string, number> = new Map(),
): MemoryCandidate | undefined {
  const teachingText = readableFactTeachingText(fact);
  const integrity = readDurableFactIntegrity(fact.validationJson);
  if (!teachingText || !integrity || integrity.evidenceClusters.length === 0) {
    return undefined;
  }
  const factSemantics = factSemanticSignals(fact, integrity.mechanism);
  const concepts = factSemantics.concepts;
  const role = factRole(fact);
  const evidenceRefs = integrity.evidenceClusters.flatMap(
    (cluster) => cluster.evidenceTraceIds,
  );
  const basis = mistakeRecallBasis({
    source: "l2_fact",
    factPolarity: fact.polarity,
    factIntegrityTrusted: integrity.promotionStatus === "trusted",
    factEvidenceTraceIds: evidenceRefs,
  });
  return {
    id: fact.id,
    source: "l2_fact",
    truthClass: "learner_state",
    role,
    historyFacets: basis ? ["past_mistake"] : [],
    mistakeRecallBasis: basis,
    title: fact.problem?.title ?? "Learner pattern",
    teachingText,
    concepts,
    sourceProblem: fact.problem
      ? { slug: fact.problem.slug, title: fact.problem.title }
      : undefined,
    confidence: fact.confidence,
    status: fact.status,
    evidenceRefs,
    updatedAt: fact.lastSeenAt,
    retrievalSignals: signalsFor({
      plan,
      concepts,
      text: `${teachingText} ${factSemantics.text}`,
      mechanismKeys: factSemantics.mechanismKeys,
      lexicalRank: ranks.get(fact.id),
      vectorRank: vectorRanks.get(fact.id),
      role,
    }),
  };
}

export function episodeCandidate(
  episode: EpisodeCandidateRow,
  plan: RetrievalQueryPlan,
  ranks: Map<string, number>,
  vectorRanks: Map<string, number> = new Map(),
): MemoryCandidate | undefined {
  const summary = safeStoredMemoryTeachingText(episode.summary);
  const evidenceRefs = parseStrings(episode.sourceTraceIds);
  if (
    !summary ||
    !episode.problem ||
    episode.memoryOrigin !== "learner" ||
    evidenceRefs.length === 0
  ) {
    return undefined;
  }
  const concepts = episodeConcepts(episode);
  const negativeObservations = acceptedNegativeObservations(episode);
  const mechanismKeys = mechanismKeysForObservations(negativeObservations);
  const basis = mistakeRecallBasis({
    source: "episode",
    acceptedNegativeObservationIds: negativeObservations.map((observation) => observation.id),
  });
  const role = basis ? "recurring_mistake" : "successful_transfer";
  return {
    id: episode.id,
    source: "episode",
    truthClass: "historical_evidence",
    role,
    historyFacets: basis ? ["past_problem", "past_mistake"] : ["past_problem"],
    mistakeRecallBasis: basis,
    title: episode.title,
    teachingText: summary,
    concepts,
    sourceProblem: { slug: episode.problem.slug, title: episode.problem.title },
    outcome: episode.outcome,
    evidenceRefs,
    updatedAt: episode.createdAt,
    retrievalSignals: signalsFor({
      plan,
      concepts,
      text: `${episode.title} ${summary} ${negativeObservations
        .map((observation) => observation.claimText)
        .join(" ")}`,
      mechanismKeys,
      lexicalRank: ranks.get(episode.id),
      vectorRank: vectorRanks.get(episode.id),
      role,
    }),
  };
}

export function problemHistoryCandidate(
  history: ProblemHistoryCandidateRow,
  plan: RetrievalQueryPlan,
  ranks: Map<string, number> = new Map(),
): MemoryCandidate | undefined {
  const teachingText = safeStoredMemoryTeachingText(
    history.userIssueSummary ?? composeHistoryLedgerSentence(history),
  );
  if (!teachingText) return undefined;
  const concepts = problemConcepts(history.problemTags);
  return {
    id: history.id,
    source: "problem_history",
    truthClass: "historical_evidence",
    role: "successful_transfer",
    historyFacets: ["past_problem"],
    title: history.problem.title,
    teachingText,
    concepts,
    sourceProblem: {
      slug: history.problem.slug,
      title: history.problem.title,
    },
    outcome: history.runStatus,
    evidenceRefs: [history.reviewAttemptId],
    updatedAt: history.createdAt,
    retrievalSignals: signalsFor({
      plan,
      concepts,
      text: `${history.problem.title} ${teachingText}`,
      mechanismKeys: [],
      role: "successful_transfer",
      lexicalRank: ranks.get(history.id),
    }),
  };
}

export function synthesisCandidate(
  slot: SynthesisCandidateRow,
  plan: RetrievalQueryPlan,
  ranks: Map<string, number> = new Map(),
  vectorRanks: Map<string, number> = new Map(),
  supportingFacts: FactCandidateRow[] = [],
): MemoryCandidate | undefined {
  const text = safeStoredMemoryTeachingText(slot.text);
  const supportingFactIds = parseStrings(slot.evidenceFactIds);
  if (!text || supportingFactIds.length === 0) return undefined;
  const evidence = supportingFacts.flatMap((fact) => {
    const integrity = readDurableFactIntegrity(fact.validationJson);
    if (!integrity) return [];
    return [{
      id: fact.id,
      polarity: fact.polarity,
      trusted: integrity.promotionStatus === "trusted",
      evidenceTraceIds: integrity.evidenceClusters.flatMap((cluster) => cluster.evidenceTraceIds),
    }];
  });
  const basis = slot.slot.includes("weakness")
    ? mistakeRecallBasis({
        source: "synthesis",
        synthesisSupportingFacts: evidence,
      })
    : undefined;
  const role = basis
    ? "recurring_mistake"
    : slot.slot.includes("strategy")
      ? "learning_preference"
      : "successful_transfer";
  const concepts = [
    ...new Set([
      ...extractKnownConcepts(text).map(canonicalizeConcept),
      ...supportingFacts.flatMap((fact) =>
        factSemanticSignals(
          fact,
          readDurableFactIntegrity(fact.validationJson)?.mechanism ?? "",
        ).mechanismKeys,
      ),
    ]),
  ];
  return {
    id: slot.id,
    source: "synthesis",
    truthClass: "learner_state",
    role,
    historyFacets: basis ? ["past_mistake"] : [],
    mistakeRecallBasis: basis,
    title: "Cross-problem learner synthesis",
    teachingText: text,
    concepts,
    confidence: slot.confidence,
    status: slot.status,
    evidenceRefs:
      basis && "evidenceTraceIds" in basis
        ? basis.evidenceTraceIds
        : supportingFactIds,
    updatedAt: slot.updatedAt,
    retrievalSignals: signalsFor({
      plan,
      concepts,
      text,
      mechanismKeys: [],
      role,
      lexicalRank: ranks.get(slot.id),
      vectorRank: vectorRanks.get(slot.id),
    }),
  };
}

export function resolveMatchTier(args: {
  plan: RetrievalQueryPlan;
  concepts: string[];
  text: string;
  mechanismKeys: string[];
  lexicalRank?: number;
  vectorRank?: number;
}): MemoryCandidate["retrievalSignals"]["matchTier"] {
  if (hasMechanismSignal(args)) return "mechanism";
  if (hasSpecificConceptSignal(args)) return "concept";
  const recalled =
    args.lexicalRank !== undefined || args.vectorRank !== undefined;
  return recalled ? "lexical_only" : "none";
}

function signalsFor(args: {
  plan: RetrievalQueryPlan;
  concepts: string[];
  text: string;
  role: MemoryCandidate["role"];
  mechanismKeys?: string[];
  lexicalRank?: number;
  vectorRank?: number;
  vectorDistance?: number;
}): MemoryCandidate["retrievalSignals"] {
  const activeMatch = conceptsOverlap(args.plan.concepts.active, args.concepts);
  const candidateMatch = conceptsOverlap(
    args.plan.concepts.candidate.map((candidate) => candidate.tag),
    args.concepts,
  );
  const genericMatch = args.plan.concepts.candidate.some(
    (candidate) =>
      candidate.tier === "generic" && args.concepts.includes(candidate.tag),
  );
  const mechanismKeys = args.mechanismKeys ?? [];
  const matchTier = resolveMatchTier({ ...args, mechanismKeys });
  return {
    lexicalRank: args.lexicalRank,
    vectorRank: args.vectorRank,
    vectorDistance: args.vectorDistance,
    matchTier,
    conceptMatch: activeMatch
      ? "active"
      : candidateMatch
        ? "candidate"
        : genericMatch
          ? "generic"
          : "none",
    mechanismMatch: matchTier === "mechanism",
    intentFit: intentFit(args.plan.intent, args.role),
  };
}

function hasMechanismSignal(args: {
  plan: RetrievalQueryPlan;
  text: string;
  mechanismKeys: string[];
}) {
  const canonical = new Set(args.plan.canonicalMechanisms);
  if (args.mechanismKeys.some((key) => canonical.has(key))) return true;
  const current = args.plan.currentSignal?.mechanism;
  if (!current) return false;
  return canonicalizeConcept(args.text).includes(canonicalizeConcept(current));
}

function hasSpecificConceptSignal(args: {
  plan: RetrievalQueryPlan;
  concepts: string[];
  text: string;
}) {
  const normalizedText = canonicalizeConcept(args.text);
  const candidateConcepts = args.concepts.map(canonicalizeConcept);
  return args.plan.queryTerms.some((term) => {
    if (term.origin === "taxonomy_expansion") return false;
    if (isGenericConcept(term.value)) return false;
    const normalizedTerm = canonicalizeConcept(term.value);
    return (
      candidateConcepts.includes(normalizedTerm) ||
      normalizedText.includes(normalizedTerm)
    );
  });
}

function factSemanticSignals(fact: FactCandidateRow, compatibilityMechanism: string) {
  const problem = fact.problem ? problemConcepts(fact.problem.tags) : [];
  if (fact.integrityVersion !== 2) {
    const compatibility = canonicalizeConcept(compatibilityMechanism);
    return {
      concepts: [...new Set([compatibility, ...problem].filter(Boolean))],
      text: compatibilityMechanism,
      mechanismKeys: compatibility ? [compatibility] : [],
    };
  }
  const scope = parseRecord(fact.scopeJson);
  const topicHints = readStrings(scope.topicHints);
  const mechanisms = parseStrings(fact.mechanismKeysJson);
  const claimText = fact.claimText?.trim() ?? "";
  return {
    concepts: [
      ...new Set([
        ...problem,
        ...topicHints.map(canonicalizeConcept),
        ...mechanisms.map(canonicalizeConcept),
        ...extractKnownConcepts(claimText).map(canonicalizeConcept),
      ].filter(Boolean)),
    ],
    text: [claimText, ...topicHints, ...mechanisms].join(" "),
    mechanismKeys: mechanisms,
  };
}

function problemConcepts(tags: string) {
  return classifyProblemConcepts(parseStrings(tags)).candidate.map(
    (candidate) => candidate.tag,
  );
}

function episodeConcepts(episode: EpisodeCandidateRow) {
  const observationConcepts = acceptedNegativeObservations(episode).flatMap(
    (observation) => {
      const scope = parseRecord(observation.scopeJson);
      return [
        ...readStrings(scope.topicHints),
        ...parseStrings(observation.mechanismKeysJson),
        ...extractKnownConcepts(observation.claimText),
      ].map(canonicalizeConcept);
    },
  );
  return [
    ...new Set([
      ...problemConcepts(episode.problem?.tags ?? "[]"),
      ...classifyProblemConcepts(parseStrings(episode.tags)).candidate.map(
        (candidate) => candidate.tag,
      ),
      ...observationConcepts,
    ]),
  ];
}

function acceptedNegativeObservations(episode: EpisodeCandidateRow) {
  return episode.claimObservations.filter(
    (observation) =>
      observation.memoryOrigin === "learner" &&
      observation.status === "accepted" &&
      observation.polarity === "negative",
  );
}

function mechanismKeysForObservations(
  observations: ReturnType<typeof acceptedNegativeObservations>,
) {
  return [
    ...new Set(
      observations.flatMap((observation) =>
        parseStrings(observation.mechanismKeysJson),
      ),
    ),
  ];
}

function factRole(fact: FactCandidateRow): MemoryCandidate["role"] {
  const factType = fact.factType;
  if (fact.integrityVersion === 2) {
    if (factType === "preference" || factType === "strategy") {
      return "learning_preference";
    }
    if (fact.polarity === "negative") return "recurring_mistake";
    if (fact.polarity === "positive") return "successful_transfer";
  }
  if (["mistake", "weakness", "unresolved_confusion"].includes(factType)) {
    return "recurring_mistake";
  }
  if (factType === "preference" || factType === "strategy") {
    return "learning_preference";
  }
  return "successful_transfer";
}

function composeHistoryLedgerSentence(history: ProblemHistoryCandidateRow) {
  const status = history.runStatus.replaceAll("_", " ").trim() || "recorded activity";
  return `${history.problem.title}: recorded ${status} on ${history.createdAt.toISOString().slice(0, 10)}.`;
}

function intentFit(
  intent: RetrievalQueryPlan["intent"],
  role: MemoryCandidate["role"],
) {
  if (role === "saved_mistake_guide") {
    return ["past_mistake_recall_request", "review", "debug_followup"].includes(intent) ? 1 : 0.7;
  }
  if (["hint_request", "anxiety_or_stuck"].includes(intent)) {
    if (role === "successful_transfer") return 1;
    if (role === "recurring_mistake") return 0.72;
    return role === "domain_reference" ? 0.7 : 0.1;
  }
  if (
    ["review", "debug_followup", "execute_failed_ask", "run_case_request"].includes(
      intent,
    )
  ) {
    if (role === "recurring_mistake") return 1;
    return role === "successful_transfer" ? 0.45 : 0.25;
  }
  if (["concept_question", "api_reference_question"].includes(intent)) {
    return role === "domain_reference" || role === "saved_knowledge" ? 1 : 0.35;
  }
  return role === "domain_reference" ? 0.45 : 0.7;
}

function parseStrings(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
