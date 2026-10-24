import type { PrismaClient } from "@prisma/client";
import {
  createEmbedClient,
  getEmbeddingDim,
  isEmbeddingConfigured,
  type EmbedClient,
} from "@/server/memory/retrieval/embed-client";
import {
  buildLearnerMemoryRetrievalDocuments,
  memoryRetrievalIndexRefId,
  type MemoryRetrievalDocument,
} from "@/server/memory/store/retrieval-document-store";
import type { FtsStore } from "@/server/memory/store/fts-store";
import {
  getDefaultVectorStore,
  type VectorStore,
} from "@/server/memory/store/vector-store";

const SEARCH_LIMIT = 500;
const TOP_EXPERIENCE_BUNDLES = 2;
const RRF_K = 60;

type RecallLayer = "episode" | "l2_fact" | "l3_synthesis";

export type ThreeLayerExperience = {
  sourceProblem?: string;
  experienceText: string;
  sourceLayers: RecallLayer[];
};

export type ThreeLayerExperienceRecall = {
  status: "full" | "empty" | "vector_unavailable" | "partial_failure";
  experiences: ThreeLayerExperience[];
  trace: {
    ftsQuery: string;
    vectorQueries: string[];
    candidateCount: number;
    bundleCount: number;
    selectedDocumentIds: string[][];
    errors: string[];
  };
};

/**
 * Searches source-owned retrieval text from Episode, L2, and L3. The model
 * supplies the current-code semantics; deterministic code only retrieves,
 * fuses ranked lists, and collapses records that share an evidence family.
 */
export async function recallThreeLayerLearningExperiences(args: {
  prisma: PrismaClient;
  learnerId: string;
  ftsKeywords: readonly string[];
  failurePattern?: string;
  successPattern?: string;
  ftsStore: FtsStore;
  vectorStore?: VectorStore;
  embedClient?: EmbedClient;
  /** Isolated test/eval seam; production always loads source rows through Prisma. */
  documents?: readonly MemoryRetrievalDocument[];
}): Promise<ThreeLayerExperienceRecall> {
  const errors: string[] = [];
  const ftsQuery = cleanKeywords(args.ftsKeywords).join(" ");
  const vectorQueries = [
    cleanPattern(args.failurePattern)
      ? buildPatternQuery("negative", args.failurePattern!)
      : undefined,
    cleanPattern(args.successPattern)
      ? buildPatternQuery("positive", args.successPattern!)
      : undefined,
  ].filter((value): value is string => Boolean(value));

  try {
    const documents = (
      args.documents ??
      (await buildLearnerMemoryRetrievalDocuments(args.prisma, {
        userId: args.learnerId,
      }))
    ).filter(isThreeLayerDocument);
    const byIndexId = new Map(
      documents.map((document) => [
        memoryRetrievalIndexRefId(document),
        document,
      ]),
    );
    const contributions = new Map<string, number>();

    const ftsHits = args.ftsStore
      .searchMemoryFts(ftsQuery, {
        learnerId: args.learnerId,
        limit: SEARCH_LIMIT,
      })
      .filter((hit) => byIndexId.has(hit.refId));
    addRrfLane(
      contributions,
      ftsHits.map((hit) => hit.refId),
      0.35,
    );

    const embedClient =
      args.embedClient ??
      (isEmbeddingConfigured() ? createEmbedClient() : undefined);
    const vectorStore =
      args.vectorStore ??
      (embedClient ? getDefaultVectorStore(getEmbeddingDim()) : undefined);
    if (!embedClient || !vectorStore) {
      const selected = selectBundles(documents, contributions);
      return {
        status: selected.length > 0 ? "vector_unavailable" : "empty",
        experiences: selected.map(presentBundle),
        trace: traceFor(
          ftsQuery,
          vectorQueries,
          contributions,
          selected,
          errors,
        ),
      };
    }

    const semanticWeight =
      vectorQueries.length > 0 ? 0.65 / vectorQueries.length : 0;
    for (const query of vectorQueries) {
      const [embedding] = await embedClient.embed([query]);
      if (!embedding)
        throw new Error("Embedding provider returned no query vector.");
      const hits = vectorStore
        .searchSimilar(embedding, {
          learnerId: args.learnerId,
          limit: SEARCH_LIMIT,
        })
        .filter((hit) => byIndexId.has(hit.refId));
      addRrfLane(
        contributions,
        hits.map((hit) => hit.refId),
        semanticWeight,
      );
    }

    const selected = selectBundles(documents, contributions);
    return {
      status: selected.length > 0 ? "full" : "empty",
      experiences: selected.map(presentBundle),
      trace: traceFor(ftsQuery, vectorQueries, contributions, selected, errors),
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return {
      status: "partial_failure",
      experiences: [],
      trace: {
        ftsQuery,
        vectorQueries,
        candidateCount: 0,
        bundleCount: 0,
        selectedDocumentIds: [],
        errors,
      },
    };
  }
}

export function buildPatternQuery(
  polarity: "negative" | "positive",
  pattern: string,
) {
  return [
    `经验方向：${polarity === "negative" ? "失败经验" : "成功经验"}`,
    polarity === "negative"
      ? "检索与当前代码相似的错误表现、具体代码行为、触发条件和原因。"
      : "检索与当前代码相似的正确做法、关键不变量、边界更新和改进作用。",
    cleanPattern(pattern),
  ]
    .filter(Boolean)
    .join("\n");
}

function addRrfLane(
  scores: Map<string, number>,
  ids: readonly string[],
  weight: number,
) {
  ids.forEach((id, index) => {
    scores.set(id, (scores.get(id) ?? 0) + weight / (RRF_K + index + 1));
  });
}

type RankedBundle = {
  documents: MemoryRetrievalDocument[];
  /** Frozen at bundle creation so one broad L2 fact cannot transitively join unrelated families. */
  anchorEvidenceKeys: ReadonlySet<string>;
  score: number;
};

function selectBundles(
  documents: readonly MemoryRetrievalDocument[],
  contributions: ReadonlyMap<string, number>,
) {
  const ranked = documents
    .flatMap((document) => {
      const score = contributions.get(memoryRetrievalIndexRefId(document));
      return score && score > 0 ? [{ document, score }] : [];
    })
    .sort((left, right) => right.score - left.score);
  const bundles: RankedBundle[] = [];
  for (const candidate of ranked) {
    const related = bundles.find((bundle) =>
      candidate.document.evidenceClusterIds.some((key) =>
        bundle.anchorEvidenceKeys.has(key),
      ),
    );
    if (related) {
      related.documents.push(candidate.document);
      // Multiple layers corroborating one evidence family are useful, but do
      // not get to occupy two answer slots or add all duplicate scores.
      related.score = Math.max(candidate.score, related.score) + 0.00001;
    } else {
      bundles.push({
        documents: [candidate.document],
        anchorEvidenceKeys: new Set(candidate.document.evidenceClusterIds),
        score: candidate.score,
      });
    }
  }
  return bundles
    .sort((left, right) => right.score - left.score)
    .slice(0, TOP_EXPERIENCE_BUNDLES);
}

function presentBundle(bundle: RankedBundle): ThreeLayerExperience {
  const ordered = [...bundle.documents].sort(
    (left, right) => layerOrder(left) - layerOrder(right),
  );
  const onePerLayer = ordered.filter(
    (document, index) =>
      ordered.findIndex(
        (candidate) => sourceLayer(candidate) === sourceLayer(document),
      ) === index,
  );
  const texts = [
    ...new Set(onePerLayer.map((document) => document.description.trim())),
  ]
    .filter(Boolean)
    .slice(0, 3);
  const sourceProblem = ordered.find(
    (document) => document.sourceKind === "review_episode",
  )?.title;
  return {
    sourceProblem,
    experienceText: texts.join("\n"),
    sourceLayers: [...new Set(ordered.map(sourceLayer))],
  };
}

function layerOrder(document: MemoryRetrievalDocument) {
  return document.sourceKind === "review_episode"
    ? 0
    : document.sourceKind === "l2_fact"
      ? 1
      : 2;
}

function sourceLayer(document: MemoryRetrievalDocument): RecallLayer {
  return document.sourceKind === "review_episode"
    ? "episode"
    : document.sourceKind === "l2_fact"
      ? "l2_fact"
      : "l3_synthesis";
}

function isThreeLayerDocument(document: MemoryRetrievalDocument) {
  return (
    document.retrievalTextVersion > 0 &&
    (document.sourceKind === "review_episode" ||
      document.sourceKind === "l2_fact" ||
      document.sourceKind === "l3_synthesis")
  );
}

function cleanKeywords(values: readonly string[]) {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 12);
}

function cleanPattern(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 1200) : undefined;
}

function traceFor(
  ftsQuery: string,
  vectorQueries: string[],
  contributions: ReadonlyMap<string, number>,
  selected: RankedBundle[],
  errors: string[],
) {
  return {
    ftsQuery,
    vectorQueries,
    candidateCount: contributions.size,
    bundleCount: selected.length,
    selectedDocumentIds: selected.map((bundle) =>
      bundle.documents.map((document) => document.documentId),
    ),
    errors,
  };
}
