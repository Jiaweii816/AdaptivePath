import type { PrismaClient } from "@prisma/client";
import {
  getDefaultFtsStore,
  type FtsStore,
} from "@/server/memory/store/fts-store";
import {
  getDefaultVectorStore,
  type VectorStore,
} from "@/server/memory/store/vector-store";
import {
  createEmbedClient,
  getEmbeddingDim,
  isEmbeddingConfigured,
  type EmbedClient,
} from "@/server/memory/retrieval/embed-client";
import { MAX_ACCEPTED_VECTOR_COSINE_DISTANCE } from "@/server/memory/retrieval/hybrid-candidate-recall";
import {
  memoryClaimScopeSchema,
  type MemoryClaimScope,
} from "./open-world-claim-contract";

const CLAIM_CLUSTER_PREFIX = "claim_cluster:";
const MAX_RECALL_POOL = 40;

type ClaimRecallPrisma = Pick<PrismaClient, "l2MemoryFact">;

export type ClaimRelationCandidate = {
  factId: string;
  claimText: string;
  claimType: string;
  polarity: string;
  scope: MemoryClaimScope;
  optionalMechanisms: string[];
  status: "candidate" | "active" | "improving";
  retrievalSignals: {
    lexicalRank?: number;
    vectorRank?: number;
  };
};

export type ClaimRelationCandidateRecall = {
  candidates: ClaimRelationCandidate[];
  mode: "full" | "lexical_only" | "partial_failure";
  errors: string[];
};

/**
 * Retrieves possible semantic neighbours for later MemoryAgent adjudication.
 * This function deliberately has no relation label, merge, arbitration, or
 * confidence mutation: lexical/vector similarity is candidate recall only.
 */
export async function recallClaimRelationCandidates(
  prisma: ClaimRecallPrisma,
  args: {
    userId: string;
    query: string;
    limit: number;
    ftsStore?: FtsStore;
    vectorStore?: VectorStore;
    embedClient?: EmbedClient;
    vectorMode?: "auto" | "disabled";
  },
): Promise<ClaimRelationCandidateRecall> {
  const limit = normalizeLimit(args.limit);
  const query = args.query.trim();
  if (!query || limit === 0) {
    return { candidates: [], mode: "lexical_only", errors: [] };
  }

  const fts = args.ftsStore ?? getDefaultFtsStore();
  const lexicalRanks = rankMap(
    fts.searchMemoryFts(query, {
      kind: "claim_cluster",
      learnerId: args.userId,
      limit: MAX_RECALL_POOL,
    }),
  );
  const vectorRanks = new Map<string, number>();
  const errors: string[] = [];
  let mode: ClaimRelationCandidateRecall["mode"] = "lexical_only";

  const shouldTryVector =
    args.vectorMode !== "disabled" &&
    (Boolean(args.vectorStore && args.embedClient) || isEmbeddingConfigured());
  if (shouldTryVector) {
    try {
      const vectorStore =
        args.vectorStore ?? getDefaultVectorStore(getEmbeddingDim());
      const embedClient = args.embedClient ?? createEmbedClient();
      if (vectorStore && embedClient) {
        const [embedding] = await embedClient.embed([query]);
        vectorStore
          .searchSimilar(embedding, {
            kind: "claim_cluster",
            learnerId: args.userId,
            limit: MAX_RECALL_POOL,
          })
          .filter((hit) => hit.distance <= MAX_ACCEPTED_VECTOR_COSINE_DISTANCE)
          .forEach((hit, index) => vectorRanks.set(hit.refId, index));
        mode = "full";
      }
    } catch (error) {
      errors.push(`vector:${errorMessage(error)}`);
      mode = "partial_failure";
    }
  }

  const rankedFactIds = mergeCandidateRanks(lexicalRanks, vectorRanks)
    .map(({ refId }) => parseClaimClusterRefId(refId))
    .filter((id): id is string => Boolean(id))
    .slice(0, Math.max(limit * 4, limit));
  if (rankedFactIds.length === 0) {
    return { candidates: [], mode, errors };
  }

  // Similarity indexes are rebuildable and untrusted. Re-hydrate through the
  // relational learner ledger with owner/origin/status/version hard guards.
  const rows = await prisma.l2MemoryFact.findMany({
    where: {
      id: { in: rankedFactIds },
      userId: args.userId,
      memoryOrigin: "learner",
      status: { in: ["candidate", "active", "improving"] },
      integrityVersion: 2,
      claimText: { not: null },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const candidates = rankedFactIds.flatMap((factId) => {
    const row = byId.get(factId);
    const claimText = row?.claimText?.trim();
    if (!row || !claimText) return [];
    return [
      {
        factId: row.id,
        claimText,
        claimType: row.factType,
        polarity: row.polarity ?? inferPolarity(row.factType),
        scope: parseScope(row.scopeJson),
        optionalMechanisms: parseStringArray(row.mechanismKeysJson),
        status: row.status as ClaimRelationCandidate["status"],
        retrievalSignals: {
          lexicalRank: lexicalRanks.get(claimClusterRefId(row.id)),
          vectorRank: vectorRanks.get(claimClusterRefId(row.id)),
        },
      },
    ];
  });

  return { candidates: candidates.slice(0, limit), mode, errors };
}

export function claimClusterRefId(factId: string) {
  return `${CLAIM_CLUSTER_PREFIX}${factId}`;
}

function parseClaimClusterRefId(refId: string) {
  return refId.startsWith(CLAIM_CLUSTER_PREFIX)
    ? refId.slice(CLAIM_CLUSTER_PREFIX.length)
    : undefined;
}

function rankMap(hits: Array<{ refId: string }>) {
  return new Map(hits.map((hit, index) => [hit.refId, index]));
}

function mergeCandidateRanks(
  lexical: Map<string, number>,
  vector: Map<string, number>,
) {
  return [...new Set([...lexical.keys(), ...vector.keys()])]
    .map((refId) => ({
      refId,
      score:
        (lexical.has(refId) ? 1 / (1 + lexical.get(refId)!) : 0) +
        (vector.has(refId) ? 1 / (1 + vector.get(refId)!) : 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.refId.localeCompare(right.refId),
    );
}

function parseScope(value: string): MemoryClaimScope {
  try {
    const result = memoryClaimScopeSchema.safeParse(JSON.parse(value));
    if (result.success) return result.data;
  } catch {
    // Invalid projection metadata must not broaden relational hydration.
  }
  return { level: "mechanism", problemIds: [], topicHints: [] };
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function inferPolarity(factType: string) {
  if (["strength", "skill"].includes(factType)) return "positive";
  if (["weakness", "mistake", "unresolved_confusion"].includes(factType)) {
    return "negative";
  }
  return "neutral";
}

function normalizeLimit(limit: number) {
  return Number.isFinite(limit) ? Math.max(0, Math.min(20, Math.floor(limit))) : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
