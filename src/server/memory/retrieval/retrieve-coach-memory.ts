import type { PrismaClient } from "@prisma/client";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import { getKbDocumentById } from "@/server/memory/kb/kb-catalog";
import {
  isTrustedL2FactForConsumption,
} from "@/server/memory/integrity/memory-integrity-policy";
import { isSafeEpisodeForConsumption } from "@/server/memory/store/episode-store";
import {
  getDefaultFtsStore,
  type FtsStore,
} from "@/server/memory/store/fts-store";
import type { VectorStore } from "@/server/memory/store/vector-store";
import { readableFactTeachingText } from "@/server/memory/store/memory-document-content";
import { findActiveSlotsByIds } from "@/server/memory/store/synthesis-store";
import type {
  MemoryCandidate,
  RetrievalQueryPlan,
} from "./candidate-core.types";
import type { EmbedClient } from "./embed-client";
import { searchCandidateRanks } from "./hybrid-candidate-recall";
import {
  episodeCandidate,
  factCandidate,
  problemHistoryCandidate,
  synthesisCandidate,
  mistakeBookCandidate,
  type EpisodeCandidateRow,
  type FactCandidateRow,
  type ProblemHistoryCandidateRow,
  type SynthesisCandidateRow,
  type MistakeBookCandidateRow,
} from "./candidate-source-adapters";
import { applySourceBudget } from "./source-budget";

type CandidatePrisma = Pick<
  PrismaClient,
  "l2MemoryFact" | "memoryEpisode" | "problemHistory" | "synthesisSlot" | "mistakeBookEntry"
>;

const PRE_HYDRATION_RECALL_POOL_LIMIT = 80;

export type RetrievedCoachMemory = {
  candidates: MemoryCandidate[];
  durableOutputPreferences: string[];
  teachingStrategy?: string;
  retrievalStatus: "full" | "lexical_only" | "partial_failure" | "failed";
  sourceErrors: string[];
};

export async function retrieveCoachMemoryCandidates(
  prisma: CandidatePrisma,
  args: {
    userId: string;
    /** Process-owned scope. Callers must not infer this from candidate rows. */
    memoryOrigin?: MemoryOrigin;
    plan: RetrievalQueryPlan;
    ftsStore?: FtsStore;
    vectorMode?: "auto" | "disabled";
    vectorStore?: VectorStore;
    embedClient?: EmbedClient;
  },
): Promise<RetrievedCoachMemory> {
  const memoryOrigin = args.memoryOrigin ?? "learner";
  const fts = args.ftsStore ?? getDefaultFtsStore();
  const sourceErrors: string[] = [];
  const recall = await searchOnly(
    fts,
    args.plan,
    args.userId,
    sourceErrors,
    args.vectorMode,
    args.vectorStore,
    args.embedClient,
  );
  const factIds = rankedIds(
    recall.factRanks,
    recall.vectorFactRanks,
    PRE_HYDRATION_RECALL_POOL_LIMIT,
  );
  const episodeIds = rankedIds(
    recall.episodeRanks,
    recall.vectorEpisodeRanks,
    PRE_HYDRATION_RECALL_POOL_LIMIT,
  );
  const historyIds = rankedIds(
    recall.problemHistoryRanks,
    new Map(),
    PRE_HYDRATION_RECALL_POOL_LIMIT,
  );
  const synthesisIds = rankedIds(
    recall.synthesisRanks,
    recall.vectorSynthesisRanks,
    PRE_HYDRATION_RECALL_POOL_LIMIT,
  );
  const mistakeBookIds = rankedIds(
    recall.mistakeBookRanks,
    recall.vectorMistakeBookRanks,
    PRE_HYDRATION_RECALL_POOL_LIMIT,
  );
  const [factResult, episodeResult, historyResult, synthesisResult, mistakeBookResult] = await Promise.allSettled([
    loadFactRows(prisma, args.userId, factIds, memoryOrigin),
    loadEpisodeRows(prisma, args.userId, episodeIds, memoryOrigin),
    loadProblemHistoryRows(prisma, args.userId, historyIds, memoryOrigin),
    loadSynthesisRows(prisma, args.userId, synthesisIds, memoryOrigin),
    loadMistakeBookRows(prisma, args.userId, mistakeBookIds, memoryOrigin),
  ]);
  recordSourceError(factResult, "l2_fact", sourceErrors);
  recordSourceError(episodeResult, "episode", sourceErrors);
  recordSourceError(historyResult, "problem_history", sourceErrors);
  recordSourceError(synthesisResult, "synthesis", sourceErrors);
  recordSourceError(mistakeBookResult, "mistake_book", sourceErrors);

  const facts = rankHydratedRows(
    factResult.status === "fulfilled" ? factResult.value : [],
    recall.factRanks,
    recall.vectorFactRanks,
  );
  const episodes = rankHydratedRows(
    episodeResult.status === "fulfilled" ? episodeResult.value : [],
    recall.episodeRanks,
    recall.vectorEpisodeRanks,
  );
  const problemHistory = rankHydratedRows(
    historyResult.status === "fulfilled" ? historyResult.value : [],
    recall.problemHistoryRanks,
    new Map(),
  );
  const synthesis = rankHydratedRows(
    synthesisResult.status === "fulfilled" ? synthesisResult.value : [],
    recall.synthesisRanks,
    recall.vectorSynthesisRanks,
  );
  const mistakeBooks = rankHydratedRows(
    mistakeBookResult.status === "fulfilled" ? mistakeBookResult.value : [],
    recall.mistakeBookRanks,
    recall.vectorMistakeBookRanks,
  );
  const supportingFactIds = [...new Set(
    synthesis.flatMap((slot) => parseJsonStrings(slot.evidenceFactIds)),
  )];
  const supportingFacts = await loadFactRows(
    prisma,
    args.userId,
    supportingFactIds,
    memoryOrigin,
  ).catch((error) => {
    sourceErrors.push(`synthesis_supporting_fact:${errorMessage(error)}`);
    return [];
  });
  const controlFacts = await loadDurableControlFacts(prisma, args.userId, memoryOrigin).catch(
    (error) => {
      sourceErrors.push(`l2_control_fact:${errorMessage(error)}`);
      return [];
    },
  );
  const constructedCandidates = [
    ...facts.map((fact) =>
      factCandidate(
        fact,
        args.plan,
        recall.factRanks,
        recall.vectorFactRanks,
      ),
    ),
    ...episodes.map((episode) =>
      episodeCandidate(
        episode,
        args.plan,
        recall.episodeRanks,
        recall.vectorEpisodeRanks,
      ),
    ),
    ...problemHistory.map((history) =>
      problemHistoryCandidate(history, args.plan, recall.problemHistoryRanks),
    ),
    ...synthesis.map((slot) =>
      synthesisCandidate(
        slot,
        args.plan,
        recall.synthesisRanks,
        recall.vectorSynthesisRanks,
        supportingFacts.filter((fact) =>
          parseJsonStrings(slot.evidenceFactIds).includes(fact.id),
        ),
      ),
    ),
    ...mistakeBooks.map((entry) =>
      mistakeBookCandidate(
        entry,
        args.plan,
        recall.mistakeBookRanks,
        recall.vectorMistakeBookRanks,
      ),
    ),
    ...domainCandidates(fts, args.plan, sourceErrors),
  ].filter((candidate): candidate is MemoryCandidate => Boolean(candidate));
  const facetFiltered = args.plan.requiredFacet
    ? constructedCandidates.filter((candidate) =>
        candidate.historyFacets?.includes(args.plan.requiredFacet!),
      )
    : constructedCandidates;
  const candidates = Object.entries(groupBySource(facetFiltered)).flatMap(
    ([source, sourceCandidates]) =>
      source === "domain_kb"
        ? sourceCandidates
        : applySourceBudget(
            sourceCandidates,
            sourcePolicy(args.plan, source as keyof RetrievalQueryPlan["sourcePolicy"]),
          ),
  );

  return {
    candidates,
    durableOutputPreferences: controlFacts
      .filter((fact) => fact.factType === "preference")
      .map(readableFactTeachingText)
      .filter((value): value is string => Boolean(value)),
    teachingStrategy: controlFacts
      .filter(
        (fact) => fact.factType === "strategy" && fact.status === "validated",
      )
      .map(readableFactTeachingText)
      .find((value): value is string => Boolean(value)),
    retrievalStatus:
      sourceErrors.length === 0
        ? recall.mode
        : candidates.length > 0
          ? "partial_failure"
          : "failed",
    sourceErrors,
  };
}

async function loadFactRows(
  prisma: CandidatePrisma,
  userId: string,
  ids: string[],
  memoryOrigin: MemoryOrigin,
): Promise<FactCandidateRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.l2MemoryFact.findMany({
    where: {
      userId,
      id: { in: ids },
      memoryOrigin,
      status: { in: ["active", "improving", "validated"] },
    },
    include: { problem: true },
  });
  return rows.filter(isTrustedL2FactForConsumption);
}

async function loadEpisodeRows(
  prisma: CandidatePrisma,
  userId: string,
  ids: string[],
  memoryOrigin: MemoryOrigin,
): Promise<EpisodeCandidateRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.memoryEpisode.findMany({
    where: { userId, id: { in: ids }, memoryOrigin },
    include: { problem: true, claimObservations: true },
  });
  return rows.filter(isSafeEpisodeForConsumption);
}

async function loadProblemHistoryRows(
  prisma: CandidatePrisma,
  userId: string,
  ids: string[],
  memoryOrigin: MemoryOrigin,
): Promise<ProblemHistoryCandidateRow[]> {
  if (ids.length === 0) return [];
  return prisma.problemHistory.findMany({
    where: { userId, id: { in: ids }, memoryOrigin },
    include: { problem: true },
  });
}

async function loadSynthesisRows(
  prisma: CandidatePrisma,
  userId: string,
  ids: string[],
  memoryOrigin: MemoryOrigin,
): Promise<SynthesisCandidateRow[]> {
  return findActiveSlotsByIds(prisma, { userId, ids, memoryOrigin });
}

async function loadMistakeBookRows(
  prisma: CandidatePrisma,
  userId: string,
  ids: string[],
  memoryOrigin: MemoryOrigin,
): Promise<MistakeBookCandidateRow[]> {
  if (ids.length === 0) return [];
  return prisma.mistakeBookEntry.findMany({
    where: { userId, id: { in: ids }, memoryOrigin },
    include: { problem: true },
  });
}

async function searchOnly(
  fts: FtsStore,
  plan: RetrievalQueryPlan,
  userId: string,
  errors: string[],
  vectorMode?: "auto" | "disabled",
  vectorStore?: VectorStore,
  embedClient?: EmbedClient,
) {
  try {
    const query = retrievalQueryText(plan);
    const lexicalExpansionQuery = retrievalExpansionQueryText(plan);
    const recall = await searchCandidateRanks({
      fts,
      userId,
      query,
      lexicalExpansionQuery,
      semanticQuery: plan.semanticQuery,
      semanticQueryPlan: plan.semanticQueryPlan,
      vectorMode,
      vectorStore,
      embedClient,
    });
    errors.push(...recall.errors);
    return recall;
  } catch (error) {
    errors.push(`fts:${errorMessage(error)}`);
    return {
      factRanks: new Map<string, number>(),
      episodeRanks: new Map<string, number>(),
      synthesisRanks: new Map<string, number>(),
      problemHistoryRanks: new Map<string, number>(),
      mistakeBookRanks: new Map<string, number>(),
      vectorFactRanks: new Map<string, number>(),
      vectorEpisodeRanks: new Map<string, number>(),
      vectorSynthesisRanks: new Map<string, number>(),
      vectorMistakeBookRanks: new Map<string, number>(),
      vectorFactDistances: new Map<string, number>(),
      vectorEpisodeDistances: new Map<string, number>(),
      vectorSynthesisDistances: new Map<string, number>(),
      vectorMistakeBookDistances: new Map<string, number>(),
      mode: "partial_failure" as const,
      errors: [],
    };
  }
}

function domainCandidates(
  fts: FtsStore,
  plan: RetrievalQueryPlan,
  errors: string[],
) {
  // Domain KB is not learner memory. Hint/API requests have dedicated tools,
  // and the legacy catalog only covers the original demo fixtures. Keep it out
  // of automatic Review, profile, history, practice, and general Chat recall.
  if (plan.intent !== "concept_question") return [];
  try {
    const query = retrievalQueryText(plan);
    return fts
      .searchMemoryFts(query, { kind: "kb", limit: 4 })
      .map((hit, index) => {
        const doc = getKbDocumentById(hit.refId);
        if (!doc) return undefined;
        return {
          id: doc.refId,
          source: "domain_kb",
          truthClass: "domain_reference",
          role: "domain_reference",
          title: doc.title,
          teachingText: doc.content,
          concepts: plan.concepts.active,
          evidenceRefs: [doc.refId],
          retrievalSignals: {
            lexicalRank: index,
            matchTier: plan.concepts.active.length > 0 ? "concept" : "lexical_only",
            conceptMatch: plan.concepts.active.length > 0 ? "active" : "candidate",
            mechanismMatch: false,
            intentFit: domainIntentFit(plan.intent),
          },
        } satisfies MemoryCandidate;
      })
      .filter(Boolean) as MemoryCandidate[];
  } catch (error) {
    errors.push(`domain_kb:${errorMessage(error)}`);
    return [];
  }
}

async function loadDurableControlFacts(
  prisma: CandidatePrisma,
  userId: string,
  memoryOrigin: MemoryOrigin,
) {
  const rows = await prisma.l2MemoryFact.findMany({
    where: {
      userId,
      memoryOrigin,
      status: { in: ["active", "validated"] },
      factType: { in: ["preference", "strategy"] },
    },
    include: { problem: true },
    orderBy: { lastSeenAt: "desc" },
    take: 20,
  });
  return rows.filter(isTrustedL2FactForConsumption);
}

function retrievalQueryText(plan: RetrievalQueryPlan) {
  const terms = plan.queryTerms
    .filter((term) => term.origin !== "taxonomy_expansion")
    .map((term) => term.value);
  if (plan.intent === "profile_meta_question") {
    terms.push(
      "demonstrated strength",
      "area still being strengthened",
      "cross problem learner synthesis",
    );
  }
  return [...new Set(terms)].join(" ");
}

function retrievalExpansionQueryText(plan: RetrievalQueryPlan) {
  return [
    ...new Set(
      plan.queryTerms
        .filter((term) => term.origin === "taxonomy_expansion")
        .map((term) => term.value),
    ),
  ].join(" ");
}

function rankedIds(
  lexical: Map<string, number>,
  vector: Map<string, number>,
  limit: number,
) {
  const ids = [...new Set([...lexical.keys(), ...vector.keys()])];
  return ids
    .sort((left, right) => {
      const leftScore =
        (lexical.has(left) ? 1 / (1 + lexical.get(left)!) : 0) +
        (vector.has(left) ? 1 / (1 + vector.get(left)!) : 0);
      const rightScore =
        (lexical.has(right) ? 1 / (1 + lexical.get(right)!) : 0) +
        (vector.has(right) ? 1 / (1 + vector.get(right)!) : 0);
      return rightScore - leftScore;
    })
    .slice(0, Math.max(0, limit));
}

function rankHydratedRows<T extends { id: string }>(
  rows: T[],
  lexical: Map<string, number>,
  vector: Map<string, number>,
) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rankedIds(lexical, vector, PRE_HYDRATION_RECALL_POOL_LIMIT)
    .flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
}

function sourcePolicy(
  plan: RetrievalQueryPlan,
  source: keyof RetrievalQueryPlan["sourcePolicy"],
) {
  const policy = plan.sourcePolicy[source];
  if (!policy) {
    throw new Error(`Retrieval source ${source} has no declared sourcePolicy.`);
  }
  return policy;
}

function groupBySource(candidates: MemoryCandidate[]) {
  return candidates.reduce<Partial<Record<MemoryCandidate["source"], MemoryCandidate[]>>>(
    (grouped, candidate) => {
      (grouped[candidate.source] ??= []).push(candidate);
      return grouped;
    },
    {},
  );
}

function domainIntentFit(intent: RetrievalQueryPlan["intent"]) {
  return ["concept_question", "api_reference_question", "hint_request"].includes(intent)
    ? 1
    : 0.35;
}

function recordSourceError(
  result: PromiseSettledResult<unknown>,
  source: string,
  errors: string[],
) {
  if (result.status === "rejected") {
    errors.push(`${source}:${errorMessage(result.reason)}`);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonStrings(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
