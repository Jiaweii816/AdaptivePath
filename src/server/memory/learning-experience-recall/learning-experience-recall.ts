import { MAX_ACCEPTED_VECTOR_COSINE_DISTANCE } from "@/server/memory/retrieval/hybrid-candidate-recall";
import type { EmbedClient } from "@/server/memory/retrieval/embed-client";
import type { FtsStore } from "@/server/memory/store/fts-store";
import type { VectorStore } from "@/server/memory/store/vector-store";
import {
  LEARNING_EXPERIENCE_CARD_KIND,
  type LearningExperienceCard,
  type LearningExperienceCardResult,
  type LearningExperienceLaneTrace,
  type LearningExperiencePolarity,
  type LearningExperienceRecall,
} from "./contracts";

const RECALL_LIMIT = 80;
// DashScope's OpenAI-compatible embedding endpoint rejects batches above ten.
// Keep this local, bounded corpus compatible with the shared provider limit.
const EMBEDDING_BATCH_SIZE = 10;

/**
 * The Pilot's only deterministic tag operation is formatting normalization.
 * It deliberately does not infer an algorithm from either the user message or
 * an LLM-generated pattern.
 */
export function resolveBinarySearchPilotAlgorithmTag(tags: readonly string[]) {
  return tags.map(normalizeAlgorithmTag).find((tag) => tag === "binary_search");
}

export function buildExperienceVectorQuery(args: {
  polarity: LearningExperiencePolarity;
  algorithmTag: string;
  pattern: string;
}) {
  const heading =
    args.polarity === "negative"
      ? "失败表现、代码行为与原因"
      : "正确行为、关键不变量与作用";
  const kind = args.polarity === "negative" ? "失败" : "成功";
  return [
    `经验类型：${kind}`,
    `算法：${args.algorithmTag}`,
    `${heading}：`,
    args.pattern,
  ]
    .join("\n")
    .trim();
}

/**
 * Indexes the small, separately owned Pilot corpus. The caller chooses an
 * isolated FTS/vector store; this function never opens the learner database.
 */
export async function indexLearningExperienceCards(args: {
  cards: readonly LearningExperienceCard[];
  ftsStore: FtsStore;
  vectorStore: VectorStore;
  embedClient: EmbedClient;
}) {
  const cards = args.cards.filter(isIndexableCard);
  for (const card of cards) {
    args.ftsStore.indexMemoryDocument({
      kind: LEARNING_EXPERIENCE_CARD_KIND,
      refId: card.id,
      learnerId: card.learnerId,
      content: cardDocument(card),
    });
  }
  if (cards.length === 0) return;
  for (let start = 0; start < cards.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = cards.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await args.embedClient.embed(batch.map(cardDocument));
    for (const [index, card] of batch.entries()) {
      const embedding = embeddings[index];
      if (!embedding)
        throw new Error(`Missing embedding for experience card ${card.id}.`);
      args.vectorStore.upsertEmbedding({
        kind: LEARNING_EXPERIENCE_CARD_KIND,
        refId: card.id,
        learnerId: card.learnerId,
        embedding,
        contentHash: `pilot:${card.id}`,
        embeddingModel: args.embedClient.model,
      });
    }
  }
}

/**
 * FTS supplies the deterministic algorithm scope.  A card can only become a
 * learner-facing result after its lane's semantic vector hit crosses the
 * existing cosine-distance threshold; lexical membership alone is never a
 * relevance authorization.
 */
export async function recallLearningExperienceCards(args: {
  cards: readonly LearningExperienceCard[];
  learnerId: string;
  problemTags: readonly string[];
  failurePattern?: string;
  successPattern?: string;
  ftsStore: FtsStore;
  vectorStore?: VectorStore;
  embedClient?: EmbedClient;
}): Promise<LearningExperienceRecall> {
  const algorithmTag = resolveBinarySearchPilotAlgorithmTag(args.problemTags);
  const errors: string[] = [];
  const emptyTrace = (): LearningExperienceRecall["trace"] => ({
    ftsQuery: algorithmTag,
    failurePattern: cleanPattern(args.failurePattern),
    successPattern: cleanPattern(args.successPattern),
    lanes: [],
    errors,
  });
  if (!algorithmTag) {
    return { status: "algorithm_tag_unavailable", trace: emptyTrace() };
  }

  const scopedCards = args.cards.filter(
    (card) =>
      isIndexableCard(card) &&
      card.learnerId === args.learnerId &&
      normalizeAlgorithmTag(card.algorithmTag) === algorithmTag,
  );
  const ftsIds = args.ftsStore
    .searchMemoryFts(algorithmTag, {
      kind: LEARNING_EXPERIENCE_CARD_KIND,
      learnerId: args.learnerId,
      limit: RECALL_LIMIT,
    })
    .map((hit) => hit.refId);
  const cardById = new Map(scopedCards.map((card) => [card.id, card]));
  const trace = emptyTrace();

  if (!args.vectorStore || !args.embedClient) {
    errors.push("vector_unavailable");
    trace.lanes.push(
      emptyLane("negative", ftsIds),
      emptyLane("positive", ftsIds),
    );
    return { algorithmTag, status: "vector_unavailable", trace };
  }

  try {
    const negative = await recallLane({
      polarity: "negative",
      pattern: cleanPattern(args.failurePattern),
      algorithmTag,
      learnerId: args.learnerId,
      cardById,
      ftsIds,
      vectorStore: args.vectorStore,
      embedClient: args.embedClient,
    });
    const positive = await recallLane({
      polarity: "positive",
      pattern: cleanPattern(args.successPattern),
      algorithmTag,
      learnerId: args.learnerId,
      cardById,
      ftsIds,
      vectorStore: args.vectorStore,
      embedClient: args.embedClient,
    });
    trace.lanes.push(negative.trace, positive.trace);
    return {
      algorithmTag,
      status:
        negative.trace.ftsCandidateIds.length === 0 &&
        positive.trace.ftsCandidateIds.length === 0
          ? "empty"
          : "full",
      negative: negative.card ? presentCard(negative.card) : undefined,
      positive: positive.card ? presentCard(positive.card) : undefined,
      trace,
    };
  } catch (error) {
    errors.push(`vector:${errorMessage(error)}`);
    trace.lanes.push(
      emptyLane("negative", ftsIds),
      emptyLane("positive", ftsIds),
    );
    return { algorithmTag, status: "partial_failure", trace };
  }
}

async function recallLane(args: {
  polarity: LearningExperiencePolarity;
  pattern?: string;
  algorithmTag: string;
  learnerId: string;
  cardById: ReadonlyMap<string, LearningExperienceCard>;
  ftsIds: readonly string[];
  vectorStore: VectorStore;
  embedClient: EmbedClient;
}): Promise<{
  card?: LearningExperienceCard;
  trace: LearningExperienceLaneTrace;
}> {
  const ftsCandidateIds = args.ftsIds.filter((id) => {
    const card = args.cardById.get(id);
    return card?.polarity === args.polarity;
  });
  if (!args.pattern) {
    return {
      trace: {
        polarity: args.polarity,
        ftsCandidateIds,
        vectorCandidateIds: [],
        rankedCandidates: [],
        eligibleIds: [],
      },
    };
  }
  const vectorQuery = buildExperienceVectorQuery({
    polarity: args.polarity,
    algorithmTag: args.algorithmTag,
    pattern: args.pattern,
  });
  const [embedding] = await args.embedClient.embed([vectorQuery]);
  if (!embedding)
    throw new Error("Embedding provider returned no query vector.");
  const vectorHits = args.vectorStore.searchSimilar(embedding, {
    kind: LEARNING_EXPERIENCE_CARD_KIND,
    learnerId: args.learnerId,
    limit: RECALL_LIMIT,
  });
  const vectorCandidateIds = vectorHits
    .filter((hit) => args.cardById.get(hit.refId)?.polarity === args.polarity)
    .map((hit) => ({ id: hit.refId, distance: hit.distance }));
  // In this Pilot FTS is an exact algorithm-tag scope gate, not a semantic
  // ranker. Re-ranking same-tag cards by its BM25 score caused a lexical
  // artefact to outrank a materially closer vector match.
  const rankedCandidates = vectorCandidateIds
    .sort((left, right) => {
      return left.distance - right.distance || left.id.localeCompare(right.id);
    })
    .map(({ id, distance }) => ({
      id,
      distance,
      ftsMatched: ftsCandidateIds.includes(id),
      answerEligible: isAnswerEligible(args.cardById.get(id)),
    }));
  const eligible = rankedCandidates.filter(
    (candidate) =>
      candidate.distance <= MAX_ACCEPTED_VECTOR_COSINE_DISTANCE &&
      candidate.ftsMatched &&
      candidate.answerEligible,
  );
  const selectedId = eligible[0]?.id;
  return {
    card: selectedId ? args.cardById.get(selectedId) : undefined,
    trace: {
      polarity: args.polarity,
      vectorQuery,
      ftsCandidateIds,
      vectorCandidateIds,
      rankedCandidates,
      eligibleIds: eligible.map(({ id }) => id),
      selectedId,
    },
  };
}

function emptyLane(
  polarity: LearningExperiencePolarity,
  ftsIds: readonly string[],
) {
  return {
    polarity,
    ftsCandidateIds: [...ftsIds],
    vectorCandidateIds: [],
    rankedCandidates: [],
    eligibleIds: [],
  } satisfies LearningExperienceLaneTrace;
}

function presentCard(
  card: LearningExperienceCard,
): LearningExperienceCardResult {
  return {
    sourceProblem: card.provenance.sourceProblem,
    experienceText: card.experienceText,
    evidenceRefs: [...card.provenance.evidenceRefs],
  };
}

function cardDocument(card: LearningExperienceCard) {
  return [
    `经验类型：${card.polarity === "negative" ? "失败" : "成功"}`,
    `算法：${normalizeAlgorithmTag(card.algorithmTag)}`,
    card.experienceText,
  ]
    .join("\n")
    .trim();
}

function isIndexableCard(card: LearningExperienceCard) {
  return Boolean(
    card.id.trim() &&
    card.learnerId.trim() &&
    card.algorithmTag.trim() &&
    card.experienceText.trim() &&
    card.provenance.sourceProblem.trim() &&
    card.provenance.evidenceRefs.length > 0,
  );
}

function isAnswerEligible(card: LearningExperienceCard | undefined) {
  return Boolean(card && card.answerEligible !== false && !card.evalOnly);
}

function cleanPattern(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 1200) : undefined;
}

function normalizeAlgorithmTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
