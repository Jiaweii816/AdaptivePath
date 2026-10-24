import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import {
  episodeFtsContent,
  isSafeEpisodeForIndexing,
} from "@/server/memory/store/episode-store";
import {
  factFtsContent,
  problemHistoryFtsContent,
  synthesisFactSearchMetadata,
  synthesisFtsContent,
} from "@/server/memory/store/memory-document-content";
import {
  listActiveSlots,
  evaluateSynthesisEvidenceFacts,
} from "@/server/memory/store/synthesis-store";
import { resolveCanonicalMechanismSignal } from "@/server/problems/hot150-taxonomy";
import type { FtsStore, MemoryDocumentKind } from "./fts-store";

type ProjectionPrisma = Pick<
  PrismaClient,
  | "user"
  | "l2MemoryFact"
  | "memoryEpisode"
  | "problemHistory"
  | "synthesisSlot"
  | "mistakeBookEntry"
>;

type FactRow = Prisma.L2MemoryFactGetPayload<{ include: { problem: true } }>;

export type MemoryRetrievalDocument = {
  documentId: string;
  rootMemoryId: string;
  sourceKind:
    | "l2_fact"
    | "claim_cluster"
    | "l3_synthesis"
    | "review_episode"
    | "problem_history"
    | "mistake_book";
  sourceRefId: string;
  title: string;
  description: string;
  searchableAliases: string[];
  learnerId: string;
  origin: string;
  truthClass: "trusted" | "historical" | "relation_candidate";
  status: string;
  role:
    | "strength"
    | "weakness"
    | "preference"
    | "episode"
    | "synthesis"
    | "claim_cluster"
    | "mistake_guide";
  canonicalMechanisms: string[];
  problemIds: string[];
  evidenceClusterIds: string[];
  evidenceClusterCount: number;
  distinctProblemCount: number;
  updatedAt: string;
  contentVersion: 1;
  contentHash: string;
  /** Source-owned prose revision; 0 means this legacy projection used fallback text. */
  retrievalTextVersion: number;
  ftsKind: MemoryDocumentKind;
};

export async function buildLearnerMemoryRetrievalDocuments(
  prisma: ProjectionPrisma,
  args: { userId: string },
) {
  const [factRows, episodes, histories, slots, mistakeBooks] =
    await Promise.all([
      prisma.l2MemoryFact.findMany({
        where: { userId: args.userId, memoryOrigin: "learner" },
        include: { problem: true },
      }),
      prisma.memoryEpisode.findMany({
        where: { userId: args.userId, memoryOrigin: "learner" },
        include: { problem: true, activityCluster: true },
      }),
      prisma.problemHistory.findMany({
        where: { userId: args.userId, memoryOrigin: "learner" },
        include: { problem: true },
      }),
      listActiveSlots(prisma, { userId: args.userId, take: 1_000 }),
      prisma.mistakeBookEntry.findMany({
        where: { userId: args.userId, memoryOrigin: "learner" },
        include: { problem: true },
      }),
    ]);
  const facts = factRows.filter(isTrustedL2FactForConsumption);
  const factById = new Map(facts.map((fact) => [fact.id, fact]));

  return [
    ...facts.flatMap((fact) => projectFact(fact)),
    ...factRows.flatMap((fact) => projectClaimCluster(fact)),
    ...episodes.flatMap((episode) =>
      isSafeEpisodeForIndexing(episode)
        ? projectEpisode(episode, episode.problem)
        : [],
    ),
    ...histories.flatMap((history) => projectProblemHistory(history)),
    ...slots.flatMap((slot) => {
      const cited = parseStrings(slot.evidenceFactIds).flatMap((id) => {
        const fact = factById.get(id);
        return fact ? [fact] : [];
      });
      return evaluateSynthesisEvidenceFacts(cited).eligible
        ? projectSynthesis(slot, cited)
        : [];
    }),
    ...mistakeBooks.flatMap((entry) => projectMistakeBookEntry(entry)),
  ];
}

export async function reconcileLearnerMemoryRetrievalDocuments(
  prisma: ProjectionPrisma,
  args: { userId: string; ftsStore: FtsStore },
) {
  const documents = await buildLearnerMemoryRetrievalDocuments(prisma, args);
  const projectionKinds: MemoryDocumentKind[] = [
    "fact",
    "claim_cluster",
    "episode",
    "synthesis",
    "problem_history",
    "mistake_book",
  ];
  const results = projectionKinds.map((kind) =>
    args.ftsStore.reconcileMemoryDocuments({
      kind,
      learnerId: args.userId,
      documents: documents
        .filter((document) => document.ftsKind === kind)
        .map((document) => ({
          refId: memoryRetrievalIndexRefId(document),
          content: retrievalDocumentFtsContent(document),
        })),
    }),
  );
  const manifestHash = hash(
    JSON.stringify(
      documents
        .map((document) => ({
          documentId: document.documentId,
          contentHash: document.contentHash,
        }))
        .sort((left, right) => left.documentId.localeCompare(right.documentId)),
    ),
  );
  return {
    documentCount: documents.length,
    byKind: Object.fromEntries(
      projectionKinds.map((kind) => [
        kind,
        documents.filter((document) => document.ftsKind === kind).length,
      ]),
    ),
    indexed: results.reduce((sum, result) => sum + result.indexed, 0),
    removed: results.reduce((sum, result) => sum + result.removed, 0),
    manifestHash,
  };
}

/** Repairs one Mistake Book lexical projection without rewriting unrelated FTS rows. */
export async function reconcileMistakeBookRetrievalDocument(
  prisma: ProjectionPrisma,
  args: { userId: string; entryId: string; ftsStore: FtsStore },
) {
  const entry = await prisma.mistakeBookEntry.findFirst({
    where: { id: args.entryId, userId: args.userId, memoryOrigin: "learner" },
    include: { problem: true },
  });
  if (!entry) return { repaired: false as const, reason: "entry_not_eligible" };
  const document = projectMistakeBookEntry(entry)[0];
  if (!document)
    return { repaired: false as const, reason: "projection_unavailable" };
  args.ftsStore.indexMemoryDocument({
    kind: document.ftsKind,
    refId: memoryRetrievalIndexRefId(document),
    content: retrievalDocumentFtsContent(document),
    learnerId: document.learnerId,
  });
  return { repaired: true as const };
}

function projectClaimCluster(fact: FactRow): MemoryRetrievalDocument[] {
  const claimText = fact.claimText?.trim();
  if (
    fact.memoryOrigin !== "learner" ||
    fact.integrityVersion !== 2 ||
    !claimText ||
    !["candidate", "active", "improving"].includes(fact.status)
  ) {
    return [];
  }

  const scope = parseRecord(fact.scopeJson);
  const optionalMechanisms = parseStrings(fact.mechanismKeysJson);
  const topicHints = readStringArray(scope.topicHints);
  const problemIds = [
    ...new Set([
      ...(fact.problemId ? [fact.problemId] : []),
      ...readStringArray(scope.problemIds),
    ]),
  ];
  const context = typeof scope.context === "string" ? scope.context : undefined;
  const description = [
    claimText,
    `Claim type: ${fact.factType}`,
    fact.polarity ? `Polarity: ${fact.polarity}` : undefined,
    ...topicHints,
    context,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  return [
    document({
      sourceRefId: fact.id,
      sourceKind: "claim_cluster",
      ftsKind: "claim_cluster",
      learnerId: fact.userId,
      title: claimText,
      description,
      aliases: topicHints,
      origin: fact.memoryOrigin,
      truthClass: "relation_candidate",
      status: fact.status,
      role: "claim_cluster",
      mechanisms: optionalMechanisms,
      problemIds,
      clusterIds: [],
      updatedAt: fact.lastSeenAt,
    }),
  ];
}

function projectFact(fact: FactRow): MemoryRetrievalDocument[] {
  const integrity = readDurableFactIntegrity(fact.validationJson);
  // New recall consumes only source-owned retrievalText. The old assembly
  // still receives a compatible fallback while the backfill is in progress.
  const description = fact.retrievalText ?? factFtsContent(fact, fact.problem);
  if (!integrity || !description) return [];
  const problemIds = [
    ...new Set(
      integrity.evidenceClusters.flatMap((cluster) =>
        cluster.problemId ? [cluster.problemId] : [],
      ),
    ),
  ];
  const role = factRole(fact.factType);
  const v2Semantics =
    fact.integrityVersion === 2 ? synthesisFactSearchMetadata(fact) : null;
  return [
    document({
      sourceRefId: fact.id,
      sourceKind: "l2_fact",
      ftsKind: "fact",
      learnerId: fact.userId,
      title: fact.label ?? "Learner pattern",
      description,
      aliases: v2Semantics?.aliases ?? [
        integrity.mechanism.replaceAll("_", " "),
      ],
      origin: fact.memoryOrigin,
      truthClass: "trusted",
      status: fact.status,
      role,
      mechanisms: v2Semantics?.canonicalMechanisms ?? [integrity.mechanism],
      problemIds,
      clusterIds: integrity.evidenceClusters.flatMap((cluster) => [
        cluster.key,
        ...(cluster.reviewAttemptId
          ? [`review:${cluster.reviewAttemptId}`]
          : []),
      ]),
      updatedAt: fact.lastSeenAt,
      retrievalTextVersion: fact.retrievalTextVersion,
    }),
  ];
}

function projectEpisode(
  episode: Prisma.MemoryEpisodeGetPayload<{
    include: { problem: true; activityCluster: true };
  }>,
  problem: Prisma.MemoryEpisodeGetPayload<{
    include: { problem: true; activityCluster: true };
  }>["problem"],
): MemoryRetrievalDocument[] {
  const description =
    episode.retrievalText ?? episodeFtsContent(episode, problem);
  const storedTags = parseStrings(episode.tags);
  const mechanisms =
    episode.kind === "assisted_repair"
      ? storedTags.flatMap((tag) => {
          const resolution = resolveCanonicalMechanismSignal({
            rawTag: tag,
            problemTags: parseStrings(problem?.tags ?? "[]"),
          });
          return resolution.decision === "canonical" ? [resolution] : [];
        })
      : [];
  return [
    document({
      sourceRefId: episode.id,
      sourceKind: "review_episode",
      ftsKind: "episode",
      learnerId: episode.userId,
      title: episode.title,
      description,
      aliases: [
        ...storedTags,
        ...mechanisms.flatMap((mechanism) => mechanism.aliases),
      ],
      origin: episode.memoryOrigin,
      truthClass: "historical",
      status: episode.outcome,
      role: "episode",
      mechanisms: mechanisms.map((mechanism) => mechanism.key),
      problemIds: episode.problemId ? [episode.problemId] : [],
      clusterIds: [
        ...(episode.activityClusterId ? [episode.activityClusterId] : []),
        ...(episode.activityCluster?.rootReviewAttemptId
          ? [`review:${episode.activityCluster.rootReviewAttemptId}`]
          : []),
      ],
      updatedAt: episode.createdAt,
      retrievalTextVersion: episode.retrievalTextVersion,
    }),
  ];
}

function projectProblemHistory(
  history: Prisma.ProblemHistoryGetPayload<{ include: { problem: true } }>,
): MemoryRetrievalDocument[] {
  const description = problemHistoryFtsContent(history, history.problem);
  if (!description) return [];
  return [
    document({
      sourceRefId: history.id,
      sourceKind: "problem_history",
      ftsKind: "problem_history",
      learnerId: history.userId,
      title: history.problem.title,
      description,
      aliases: parseStrings(history.problemTags),
      origin: history.memoryOrigin,
      truthClass: "historical",
      status: history.runStatus,
      role: "episode",
      mechanisms: [],
      problemIds: [history.problemId],
      clusterIds: [],
      updatedAt: history.createdAt,
    }),
  ];
}

function projectSynthesis(
  slot: Prisma.SynthesisSlotGetPayload<object>,
  cited: FactRow[],
): MemoryRetrievalDocument[] {
  const description = slot.retrievalText ?? synthesisFtsContent(slot, cited);
  if (!description) return [];
  const integrities = cited.flatMap((fact) => {
    const integrity = readDurableFactIntegrity(fact.validationJson);
    return integrity ? [integrity] : [];
  });
  const clusters = integrities.flatMap(
    (integrity) => integrity.evidenceClusters,
  );
  const searchMetadata = cited.map(synthesisFactSearchMetadata);
  const mechanisms = [
    ...new Set(
      searchMetadata.flatMap((metadata) => metadata.canonicalMechanisms),
    ),
  ];
  const aliases = [
    ...new Set(searchMetadata.flatMap((metadata) => metadata.aliases)),
  ];
  const problemIds = [
    ...new Set(
      clusters.flatMap((cluster) =>
        cluster.problemId ? [cluster.problemId] : [],
      ),
    ),
  ];
  return [
    document({
      sourceRefId: slot.id,
      sourceKind: "l3_synthesis",
      ftsKind: "synthesis",
      learnerId: slot.userId,
      title: "Cross-problem learner synthesis",
      description,
      aliases,
      origin: slot.memoryOrigin,
      truthClass: "trusted",
      status: slot.status,
      role: "synthesis",
      mechanisms,
      problemIds,
      clusterIds: clusters.flatMap((cluster) => [
        cluster.key,
        ...(cluster.reviewAttemptId
          ? [`review:${cluster.reviewAttemptId}`]
          : []),
      ]),
      updatedAt: slot.updatedAt,
      retrievalTextVersion: slot.retrievalTextVersion,
    }),
  ];
}

export function projectMistakeBookEntry(
  entry: Prisma.MistakeBookEntryGetPayload<{ include: { problem: true } }>,
): MemoryRetrievalDocument[] {
  if (entry.memoryOrigin !== "learner") return [];
  const tags = parseStrings(entry.tags);
  const description = [
    entry.title,
    entry.guideMarkdown,
    entry.selfCheckQuestion ?? undefined,
    ...tags,
    entry.problem.title,
    entry.problem.slug,
    "memory_facet_past_mistake",
    "memory_facet_past_problem",
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  return [
    document({
      sourceRefId: entry.id,
      sourceKind: "mistake_book",
      ftsKind: "mistake_book",
      learnerId: entry.userId,
      title: entry.title,
      description,
      aliases: tags,
      origin: entry.memoryOrigin,
      truthClass: "historical",
      status: "saved",
      role: "mistake_guide",
      mechanisms: tags,
      problemIds: [entry.problemId],
      clusterIds: [],
      updatedAt: entry.lastSavedAt,
    }),
  ];
}

function document(args: {
  sourceRefId: string;
  sourceKind: MemoryRetrievalDocument["sourceKind"];
  ftsKind: MemoryDocumentKind;
  learnerId: string;
  title: string;
  description: string;
  aliases: string[];
  origin: string;
  truthClass: MemoryRetrievalDocument["truthClass"];
  status: string;
  role: MemoryRetrievalDocument["role"];
  mechanisms: string[];
  problemIds: string[];
  clusterIds: string[];
  updatedAt: Date;
  retrievalTextVersion?: number;
}): MemoryRetrievalDocument {
  const searchableAliases = [...new Set(args.aliases)];
  const canonicalMechanisms = [...new Set(args.mechanisms)];
  const projected: MemoryRetrievalDocument = {
    documentId: `${args.sourceKind}:${args.sourceRefId}`,
    rootMemoryId: args.sourceRefId,
    sourceKind: args.sourceKind,
    sourceRefId: args.sourceRefId,
    title: args.title,
    description: args.description,
    searchableAliases,
    learnerId: args.learnerId,
    origin: args.origin,
    truthClass: args.truthClass,
    status: args.status,
    role: args.role,
    canonicalMechanisms,
    problemIds: args.problemIds,
    evidenceClusterIds: [...new Set(args.clusterIds)],
    evidenceClusterCount: new Set(
      args.clusterIds.filter((clusterId) => !clusterId.startsWith("review:")),
    ).size,
    distinctProblemCount: new Set(args.problemIds).size,
    updatedAt: args.updatedAt.toISOString(),
    contentVersion: 1,
    contentHash: "",
    retrievalTextVersion: args.retrievalTextVersion ?? 0,
    ftsKind: args.ftsKind,
  };
  projected.contentHash = hash(retrievalDocumentFtsContent(projected));
  return projected;
}

function factRole(factType: string): MemoryRetrievalDocument["role"] {
  if (factType === "strength" || factType === "skill") return "strength";
  if (factType === "preference" || factType === "strategy") {
    return "preference";
  }
  return "weakness";
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
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function memoryRetrievalIndexRefId(
  document: Pick<MemoryRetrievalDocument, "ftsKind" | "sourceRefId">,
) {
  return document.ftsKind === "claim_cluster"
    ? `claim_cluster:${document.sourceRefId}`
    : document.sourceRefId;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function retrievalDocumentFtsContent(document: MemoryRetrievalDocument) {
  return [
    document.title,
    ...document.canonicalMechanisms,
    ...document.searchableAliases,
    document.description,
  ]
    .filter(Boolean)
    .join("\n");
}
