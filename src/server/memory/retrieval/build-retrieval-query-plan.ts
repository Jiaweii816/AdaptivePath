import { createHash } from "node:crypto";
import {
  canonicalizeConcept,
  classifyProblemConcepts,
  extractKnownConcepts,
  isGenericConcept,
  normalizeConceptToken,
} from "./concepts";
import type {
  AutomaticMemoryIntent,
  CandidateSource,
  RetrievalQueryPlan,
  RetrievalQueryTerm,
  SourceBudget,
} from "./candidate-core.types";
import { primarySourcesForIntent } from "./profiles";
import {
  canonicalMechanismsForProblemTags,
  mechanismsFromLearnerQuestion,
} from "@/server/problems/hot150-taxonomy";

export type BuildRetrievalQueryPlanInput = {
  path: "review" | "chat";
  intent: AutomaticMemoryIntent;
  userText: string;
  problem: {
    id: string;
    slug: string;
    title: string;
    leetcodeNumber?: number;
    tags: string[];
  };
  searchHints?: string[];
  modelQuery?: string;
  requiredFacet?: "past_problem" | "past_mistake";
  currentSignal?: {
    mechanism?: string;
    stuckLayer?: string;
    failedCaseSummary?: string;
  };
  code?: string;
  language?: "Python";
};

const SOURCES: CandidateSource[] = [
  "l2_fact",
  "onboarding_profile",
  "synthesis",
  "episode",
  "problem_history",
  "mistake_book",
  "domain_kb",
];

export function buildRetrievalQueryPlan(
  input: BuildRetrievalQueryPlanInput,
): RetrievalQueryPlan {
  const classified = classifyProblemConcepts(input.problem.tags);
  const conceptCandidates = classified.candidate.filter(
    (candidate) => candidate.tier === "concept",
  );
  const explicitConcepts = extractKnownConcepts(input.userText).filter(
    (concept) => !isGenericConcept(concept),
  );
  const mechanismConcepts = deriveMechanismConcepts(
    input.currentSignal?.mechanism,
  );
  const codeConcepts = deriveCodeStructureConcepts(
    input.code,
    conceptCandidates.map((candidate) => candidate.tag),
  );
  const active =
    explicitConcepts.length > 0
      ? explicitConcepts
      : mechanismConcepts.length > 0
        ? mechanismConcepts
        : codeConcepts;
  const activeOrigin =
    explicitConcepts.length > 0
      ? "user_text"
      : mechanismConcepts.length > 0
        ? "current_mechanism"
        : codeConcepts.length > 0
          ? "code_structure"
          : "none";
  const searchHints = uniqueStrings(input.searchHints ?? []).slice(0, 8);
  const modelQuery = input.modelQuery?.trim();
  const questionMechanisms = mechanismsFromLearnerQuestion(
    [input.userText, modelQuery].filter(Boolean).join(" "),
  );
  const canonicalMechanismEntries = canonicalMechanismsForProblemTags(
    conceptCandidates.map((candidate) => candidate.tag),
  );
  const taxonomyMechanismTerms = canonicalMechanismEntries.flatMap((entry) => [
    entry.key,
    entry.label.en,
    entry.label.zh,
    ...entry.aliases,
  ]);
  const activeProblemSemanticFingerprint = buildActiveProblemSemanticFingerprint(
    input.problem,
    classified.candidate.map((candidate) => candidate.tag),
  );

  return {
    mode: "automatic_personalization",
    path: input.path,
    intent: input.intent,
    userText: input.userText,
    semanticQuery: buildSemanticQuery(
      [input.userText, modelQuery].filter(Boolean).join("\n"),
      activeProblemSemanticFingerprint.text,
      input.intent,
    ),
    semanticQueryPlan: buildSemanticQueryPlan(
      [input.userText, modelQuery].filter(Boolean).join("\n"),
      activeProblemSemanticFingerprint.text,
      input.intent,
    ),
    activeProblemSemanticFingerprint,
    problem: {
      id: input.problem.id,
      slug: input.problem.slug,
      title: input.problem.title,
      leetcodeNumber: input.problem.leetcodeNumber,
    },
    searchHints,
    modelQuery,
    requiredFacet: input.requiredFacet,
    canonicalMechanisms: canonicalMechanismEntries.map((entry) => entry.key),
    concepts: {
      candidate: classified.candidate,
      active: uniqueStrings(active),
      activeOrigin,
      droppedTags: classified.droppedTags,
    },
    queryTerms: buildQueryTerms({
      problem: input.problem,
      active,
      activeOrigin,
      candidateConcepts: conceptCandidates.map((candidate) => candidate.tag),
      mechanism: input.currentSignal?.mechanism,
      taxonomyMechanismTerms,
      questionMechanisms,
      modelQuery,
      intent: input.intent,
      searchHints,
      includeProblemContext: input.intent !== "profile_meta_question",
    }),
    currentSignal: input.currentSignal,
    language: input.language ?? "Python",
    selectionThreshold: active.length > 0 ? "normal" : "raised",
    sourcePolicy: buildSourcePolicy(input.intent),
  };
}

function deriveMechanismConcepts(mechanism: string | undefined) {
  if (!mechanism?.trim()) return [];
  const known = extractKnownConcepts(mechanism);
  if (known.length > 0) return known;

  const normalized = canonicalizeConcept(mechanism);
  if (
    !normalized ||
    isGenericConcept(normalized) ||
    ["unknown", "failed", "wrong_answer", "runtime_error"].includes(normalized)
  ) {
    return [];
  }

  return [normalized];
}

function deriveCodeStructureConcepts(
  code: string | undefined,
  candidateConcepts: string[],
) {
  if (!code?.trim()) return [];
  const candidates = new Set(candidateConcepts.map(canonicalizeConcept));
  const detected: string[] = [];
  const confirm = (concept: string, pattern: RegExp) => {
    if (candidates.has(concept) && pattern.test(code)) detected.push(concept);
  };

  confirm(
    "dynamic_programming",
    /\b(?:dp|memo)\s*=\s*(?:\[|\{|defaultdict)|\bfor\b[^\n]*\bfor\b[^\n]*\bdp\b/i,
  );
  confirm(
    "binary_search",
    /\bmid\b[\s\S]{0,240}\b(?:lo|hi|left|right)\b|\bwhile\s+(?:lo|left)\s*[<]=?\s*(?:hi|right)/i,
  );
  confirm("heap", /\b(?:import\s+heapq|heapq\.|heappush|heappop)\b/i);
  confirm("queue", /\b(?:deque|popleft|appendleft)\b/i);
  confirm(
    "two_pointers",
    /\b(?:left|lo|i)\b[\s\S]{0,160}\b(?:right|hi|j)\b[\s\S]{0,160}(?:\+=\s*1|-=\s*1)/i,
  );

  return uniqueStrings(detected);
}

function buildQueryTerms(args: {
  problem: BuildRetrievalQueryPlanInput["problem"];
  active: string[];
  activeOrigin: RetrievalQueryPlan["concepts"]["activeOrigin"];
  candidateConcepts: string[];
  mechanism?: string;
  taxonomyMechanismTerms: string[];
  questionMechanisms: string[];
  modelQuery?: string;
  intent: AutomaticMemoryIntent;
  searchHints: string[];
  includeProblemContext: boolean;
}) {
  const terms: RetrievalQueryTerm[] = [];
  const add = (value: string | number | undefined, origin: RetrievalQueryTerm["origin"]) => {
    const normalized = normalizeConceptToken(String(value ?? ""));
    if (normalized) terms.push({ value: normalized, origin });
  };

  if (args.includeProblemContext) {
    add(args.problem.title, "problem_metadata");
    add(args.problem.slug, "problem_metadata");
    add(args.problem.leetcodeNumber, "problem_metadata");
    args.candidateConcepts.forEach((concept) => add(concept, "problem_concept"));
    args.taxonomyMechanismTerms.forEach((term) =>
      add(term, "taxonomy_expansion"),
    );
  }
  intentFacetTerms(args.intent).forEach((term) => add(term, "intent_facet"));
  args.questionMechanisms.forEach((term) => add(term, "question_mechanism"));
  lexicalModelQueryTerms(args.modelQuery).forEach((term) => add(term, "model_query"));
  args.active.forEach((concept) =>
    add(
      concept,
      args.activeOrigin === "user_text"
        ? "user_concept"
        : args.activeOrigin === "code_structure"
          ? "code_structure"
          : "current_mechanism",
    ),
  );
  add(args.mechanism, "current_mechanism");
  args.searchHints.forEach((hint) => add(hint, "search_hint"));

  return uniqueBy(terms, (term) => `${term.origin}:${term.value}`);
}

function intentFacetTerms(intent: AutomaticMemoryIntent) {
  const facets: Partial<Record<AutomaticMemoryIntent, string[]>> = {
    past_mistake_recall_request: ["memory_facet_past_mistake"],
    past_problem_recall_request: ["memory_facet_past_problem"],
    practice_request: ["memory_role_practice_target"],
  };
  return facets[intent] ?? [];
}

function lexicalModelQueryTerms(value: string | undefined) {
  if (!value) return [];
  return value
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => /^[\x00-\x7F]+$/.test(token) || (/[\p{Script=Han}]/u.test(token) && token.length <= 12));
}

function buildActiveProblemSemanticFingerprint(
  problem: BuildRetrievalQueryPlanInput["problem"],
  concepts: string[],
) {
  const sourceTerms = uniqueStrings([
    problem.title,
    problem.slug.replaceAll("-", " "),
    ...problem.tags,
    ...concepts.map((concept) => concept.replaceAll("_", " ")),
  ]);
  const text = sourceTerms.join(" | ");
  return {
    value: createHash("sha256").update(text).digest("hex").slice(0, 16),
    text,
    sourceTerms,
  };
}

function buildSemanticQuery(
  userText: string,
  activeProblemText: string,
  intent: AutomaticMemoryIntent,
) {
  if (intent === "profile_meta_question") return userText.trim();
  return [
    userText.trim() ? `Learner request: ${userText.trim()}` : undefined,
    activeProblemText
      ? `Active problem context: ${activeProblemText}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSemanticQueryPlan(
  learnerRequest: string,
  problemContext: string,
  intent: AutomaticMemoryIntent,
) {
  return {
    learnerRequest: learnerRequest.trim() || undefined,
    problemContext: intent === "profile_meta_question" ? undefined : problemContext || undefined,
  };
}

function buildSourcePolicy(intent: AutomaticMemoryIntent) {
  const primary = primarySourcesForIntent(intent);
  return Object.fromEntries(
    SOURCES.map((source) => [
      source,
      {
        candidateLimit: primary.has(source) ? 8 : 4,
        selectionPriority: primary.has(source) ? "primary" : "supporting",
        reservedRoleSlots:
          intent === "review" && (source === "l2_fact" || source === "episode")
            ? { recurring_mistake: 3 }
            : undefined,
      } satisfies SourceBudget,
    ]),
  ) as Partial<Record<CandidateSource, SourceBudget>>;
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
