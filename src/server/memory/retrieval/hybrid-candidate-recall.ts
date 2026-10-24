import type { FtsStore } from "@/server/memory/store/fts-store";
import {
  getDefaultVectorStore,
  type VectorStore,
} from "@/server/memory/store/vector-store";
import {
  createEmbedClient,
  getEmbeddingDim,
  isEmbeddingConfigured,
  type EmbedClient,
} from "./embed-client";

export type CandidateRecallRanks = {
  factRanks: Map<string, number>;
  episodeRanks: Map<string, number>;
  synthesisRanks: Map<string, number>;
  problemHistoryRanks: Map<string, number>;
  mistakeBookRanks: Map<string, number>;
  vectorFactRanks: Map<string, number>;
  vectorEpisodeRanks: Map<string, number>;
  vectorSynthesisRanks: Map<string, number>;
  vectorMistakeBookRanks: Map<string, number>;
  vectorFactDistances: Map<string, number>;
  vectorEpisodeDistances: Map<string, number>;
  vectorSynthesisDistances: Map<string, number>;
  vectorMistakeBookDistances: Map<string, number>;
  mode: "full" | "lexical_only" | "partial_failure";
  errors: string[];
};

/**
 * sqlite-vec returns cosine distance (0 identical, 1 orthogonal). A 0.30 cap
 * admits close paraphrases on the current fake-embedding calibration while
 * rejecting weak/orthogonal neighbours. Lexical recall remains independent.
 */
export const MAX_ACCEPTED_VECTOR_COSINE_DISTANCE = 0.3;
const RECALL_POOL_LIMIT = 80;

export async function searchCandidateRanks(args: {
  fts: FtsStore;
  userId?: string;
  /** Structured aliases/terms for lexical retrieval. */
  query: string;
  /** Optional low-authority taxonomy aliases; these may add candidates but never outrank primary lexical hits. */
  lexicalExpansionQuery?: string;
  /** Natural-language learner request for semantic retrieval. */
  semanticQuery?: string;
  /** Separates learner intent from active-problem context while sharing one embed batch. */
  semanticQueryPlan?: { learnerRequest?: string; problemContext?: string };
  /** Explicit acceptance/control switch; production callers leave this on auto. */
  vectorMode?: "auto" | "disabled";
  vectorStore?: VectorStore;
  embedClient?: EmbedClient;
}): Promise<CandidateRecallRanks> {
  const primaryFactRanks = rankMap(
    args.fts.searchMemoryFts(args.query, { kind: "fact", learnerId: args.userId, limit: RECALL_POOL_LIMIT }),
  );
  const primaryEpisodeRanks = rankMap(
    args.fts.searchMemoryFts(args.query, { kind: "episode", learnerId: args.userId, limit: RECALL_POOL_LIMIT }),
  );
  const primarySynthesisRanks = rankMap(
    args.fts.searchMemoryFts(args.query, { kind: "synthesis", learnerId: args.userId, limit: RECALL_POOL_LIMIT }),
  );
  const primaryProblemHistoryRanks = rankMap(
    args.fts.searchMemoryFts(args.query, {
      kind: "problem_history",
      learnerId: args.userId,
      limit: RECALL_POOL_LIMIT,
    }),
  );
  const primaryMistakeBookRanks = rankMap(
    args.fts.searchMemoryFts(args.query, { kind: "mistake_book", learnerId: args.userId, limit: RECALL_POOL_LIMIT }),
  );
  const factRanks = mergeSoftExpansion(
    primaryFactRanks,
    expansionRanks(args, "fact"),
  );
  const episodeRanks = mergeSoftExpansion(
    primaryEpisodeRanks,
    expansionRanks(args, "episode"),
  );
  const synthesisRanks = mergeSoftExpansion(
    primarySynthesisRanks,
    expansionRanks(args, "synthesis"),
  );
  const problemHistoryRanks = mergeSoftExpansion(
    primaryProblemHistoryRanks,
    expansionRanks(args, "problem_history"),
  );
  const mistakeBookRanks = mergeSoftExpansion(
    primaryMistakeBookRanks,
    expansionRanks(args, "mistake_book"),
  );
  const vectorFactRanks = new Map<string, number>();
  const vectorEpisodeRanks = new Map<string, number>();
  const vectorSynthesisRanks = new Map<string, number>();
  const vectorMistakeBookRanks = new Map<string, number>();
  const vectorFactDistances = new Map<string, number>();
  const vectorEpisodeDistances = new Map<string, number>();
  const vectorSynthesisDistances = new Map<string, number>();
  const vectorMistakeBookDistances = new Map<string, number>();
  const errors: string[] = [];
  const configured = isEmbeddingConfigured();

  if (
    args.vectorMode === "disabled" ||
    (!configured && (!args.vectorStore || !args.embedClient))
  ) {
    return {
      factRanks,
      episodeRanks,
      synthesisRanks,
      problemHistoryRanks,
      mistakeBookRanks,
      vectorFactRanks,
      vectorEpisodeRanks,
      vectorSynthesisRanks,
      vectorMistakeBookRanks,
      vectorFactDistances,
      vectorEpisodeDistances,
      vectorSynthesisDistances,
      vectorMistakeBookDistances,
      mode: "lexical_only",
      errors,
    };
  }

  try {
    const vectorStore =
      args.vectorStore ?? getDefaultVectorStore(getEmbeddingDim());
    const embedClient = args.embedClient ?? createEmbedClient();
    if (!vectorStore || !embedClient) {
      return {
        factRanks,
        episodeRanks,
        synthesisRanks,
        problemHistoryRanks,
        mistakeBookRanks,
        vectorFactRanks,
        vectorEpisodeRanks,
        vectorSynthesisRanks,
        vectorMistakeBookRanks,
        vectorFactDistances,
        vectorEpisodeDistances,
        vectorSynthesisDistances,
        vectorMistakeBookDistances,
        mode: "lexical_only",
        errors,
      };
    }
    const queryPlan = args.semanticQueryPlan;
    const queries = [queryPlan?.learnerRequest, queryPlan?.problemContext]
      .filter((query): query is string => Boolean(query?.trim()));
    const embeddings = await embedClient.embed(
      queries.length > 0 ? queries : [args.semanticQuery?.trim() || args.query],
    );
    for (const [index, embedding] of embeddings.entries()) {
      const contextPenalty = index === 0 ? 0 : 2;
      acceptVectorHits(
        vectorStore.searchSimilar(embedding, {
        kind: "fact",
        learnerId: args.userId,
        limit: RECALL_POOL_LIMIT,
        }),
        vectorFactRanks,
        vectorFactDistances,
        contextPenalty,
      );
      acceptVectorHits(
        vectorStore.searchSimilar(embedding, {
          kind: "mistake_book",
          learnerId: args.userId,
          limit: RECALL_POOL_LIMIT,
        }),
        vectorMistakeBookRanks,
        vectorMistakeBookDistances,
        contextPenalty,
      );
      acceptVectorHits(
        vectorStore.searchSimilar(embedding, {
        kind: "episode",
        learnerId: args.userId,
        limit: RECALL_POOL_LIMIT,
        }),
        vectorEpisodeRanks,
        vectorEpisodeDistances,
        contextPenalty,
      );
      acceptVectorHits(
        vectorStore.searchSimilar(embedding, {
        kind: "synthesis",
        learnerId: args.userId,
        limit: RECALL_POOL_LIMIT,
        }),
        vectorSynthesisRanks,
        vectorSynthesisDistances,
        contextPenalty,
      );
    }
    return {
      factRanks,
      episodeRanks,
      synthesisRanks,
      problemHistoryRanks,
      mistakeBookRanks,
      vectorFactRanks,
      vectorEpisodeRanks,
      vectorSynthesisRanks,
      vectorMistakeBookRanks,
      vectorFactDistances,
      vectorEpisodeDistances,
      vectorSynthesisDistances,
      vectorMistakeBookDistances,
      mode: "full",
      errors,
    };
  } catch (error) {
    errors.push(`vector:${errorMessage(error)}`);
    return {
      factRanks,
      episodeRanks,
      synthesisRanks,
      problemHistoryRanks,
      mistakeBookRanks,
      vectorFactRanks,
      vectorEpisodeRanks,
      vectorSynthesisRanks,
      vectorMistakeBookRanks,
      vectorFactDistances,
      vectorEpisodeDistances,
      vectorSynthesisDistances,
      vectorMistakeBookDistances,
      mode: "partial_failure",
      errors,
    };
  }
}

function rankMap(hits: Array<{ refId: string }>) {
  return new Map(hits.map((hit, index) => [hit.refId, index]));
}

function expansionRanks(
  args: Parameters<typeof searchCandidateRanks>[0],
  kind: "fact" | "episode" | "synthesis" | "problem_history" | "mistake_book",
) {
  const query = args.lexicalExpansionQuery?.trim();
  return query
    ? rankMap(
        args.fts.searchMemoryFts(query, { kind, learnerId: args.userId, limit: RECALL_POOL_LIMIT }),
      )
    : new Map<string, number>();
}

function acceptVectorHits(
  hits: Array<{ refId: string; distance: number }>,
  ranks: Map<string, number>,
  distances: Map<string, number>,
  rankPenalty = 0,
) {
  hits
    .filter(
      (hit) =>
        Number.isFinite(hit.distance) &&
        hit.distance <= MAX_ACCEPTED_VECTOR_COSINE_DISTANCE,
    )
    .forEach((hit, index) => {
      const rank = index + rankPenalty;
      if (!ranks.has(hit.refId) || rank < ranks.get(hit.refId)!) {
        ranks.set(hit.refId, rank);
        distances.set(hit.refId, hit.distance);
      }
    });
}

function mergeSoftExpansion(
  primary: Map<string, number>,
  expansion: Map<string, number>,
) {
  const merged = new Map(primary);
  const penalty = Math.max(40, primary.size + 20);
  for (const [id, rank] of expansion) {
    if (!merged.has(id)) merged.set(id, penalty + rank);
  }
  return merged;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
