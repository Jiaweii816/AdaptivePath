import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_DATABASE_URL,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";
import {
  createEmbedClient,
  isEmbeddingConfigured,
  type EmbedClient,
} from "@/server/memory/retrieval/embed-client";
import { createFtsStore, type FtsStore } from "@/server/memory/store/fts-store";
import {
  createVectorStore,
  type VectorStore,
} from "@/server/memory/store/vector-store";
import { binarySearchLearningExperienceCards } from "./binary-search-pilot-cards";
import type {
  LearningExperienceCard,
  LearningExperienceRecall,
} from "./contracts";
import {
  indexLearningExperienceCards,
  recallLearningExperienceCards,
} from "./learning-experience-recall";

type PilotIndexHandle = {
  ftsStore: FtsStore;
  vectorStore?: VectorStore;
  embedClient?: EmbedClient;
  indexedFingerprint?: string;
};

const defaultHandles = new Map<string, PilotIndexHandle>();

/**
 * The corpus is a source-controlled Pilot fixture. Its rebuildable indexes are
 * explicitly outside DATABASE_URL so no chat request can mutate `dev.db`.
 */
export async function recallBinarySearchLearningExperiencePilot(args: {
  learnerId: string;
  problemTags: readonly string[];
  failurePattern?: string;
  successPattern?: string;
  cards?: readonly LearningExperienceCard[];
  indexPath?: string;
  embedClient?: EmbedClient;
}): Promise<LearningExperienceRecall> {
  const cards = args.cards ?? binarySearchLearningExperienceCards;
  const path = pilotIndexPath(args.indexPath);
  const handle = createOrReuseHandle(path, args.embedClient);
  try {
    if (handle.vectorStore && handle.embedClient) {
      const fingerprint = cardFingerprint(cards);
      if (handle.indexedFingerprint !== fingerprint) {
        await indexLearningExperienceCards({
          cards,
          ftsStore: handle.ftsStore,
          vectorStore: handle.vectorStore,
          embedClient: handle.embedClient,
        });
        handle.indexedFingerprint = fingerprint;
      }
    } else {
      // Keep the lexical receipt inspectable even when embeddings are not
      // configured. It still cannot authorize a learner-facing card.
      for (const card of cards) {
        handle.ftsStore.indexMemoryDocument({
          kind: "learning_experience_card",
          refId: card.id,
          learnerId: card.learnerId,
          content: `算法：${card.algorithmTag}\n${card.experienceText}`,
        });
      }
    }
    return recallLearningExperienceCards({
      cards,
      learnerId: args.learnerId,
      problemTags: args.problemTags,
      failurePattern: args.failurePattern,
      successPattern: args.successPattern,
      ftsStore: handle.ftsStore,
      vectorStore: handle.vectorStore,
      embedClient: handle.embedClient,
    });
  } catch (error) {
    return {
      status: "partial_failure",
      trace: {
        ftsQuery: "binary_search",
        failurePattern: args.failurePattern?.trim() || undefined,
        successPattern: args.successPattern?.trim() || undefined,
        lanes: [],
        errors: [error instanceof Error ? error.message : String(error)],
      },
    };
  }
}

function createOrReuseHandle(path: string, suppliedEmbedClient?: EmbedClient) {
  if (!suppliedEmbedClient) {
    const existing = defaultHandles.get(path);
    if (existing) return existing;
  }
  const embedClient =
    suppliedEmbedClient ??
    (isEmbeddingConfigured() ? createEmbedClient() : undefined);
  const handle: PilotIndexHandle = {
    ftsStore: createFtsStore(path),
    vectorStore: embedClient
      ? createVectorStore(path, embedClient.dim)
      : undefined,
    embedClient,
  };
  if (!suppliedEmbedClient) defaultHandles.set(path, handle);
  return handle;
}

/** Test-only cleanup for isolated Pilot indexes. */
export function resetLearningExperiencePilotIndexForTests(indexPath?: string) {
  if (indexPath) {
    const path = pilotIndexPath(indexPath);
    const handle = defaultHandles.get(path);
    handle?.ftsStore.close();
    handle?.vectorStore?.close();
    defaultHandles.delete(path);
    return;
  }
  for (const handle of defaultHandles.values()) {
    handle.ftsStore.close();
    handle.vectorStore?.close();
  }
  defaultHandles.clear();
}

function pilotIndexPath(configuredPath?: string) {
  const chosen =
    configuredPath ??
    process.env.PATTERNCOACH_LEARNING_EXPERIENCE_PILOT_DB?.trim() ??
    `${tmpdir()}/patterncoach-learning-experience-pilot.sqlite`;
  const resolved = resolve(chosen);
  const learnerDb = resolve(
    resolveSqliteFilePath(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL),
  );
  if (resolved === learnerDb) {
    throw new Error(
      "PATTERNCOACH_LEARNING_EXPERIENCE_PILOT_DB must not point to DATABASE_URL.",
    );
  }
  return resolved;
}

function cardFingerprint(cards: readonly LearningExperienceCard[]) {
  return JSON.stringify(
    cards.map((card) => [
      card.id,
      card.learnerId,
      card.algorithmTag,
      card.polarity,
      card.answerEligible !== false,
      card.evalOnly === true,
      card.experienceText,
      card.provenance.sourceProblem,
      card.provenance.evidenceRefs,
    ]),
  );
}
