import type { PrismaClient } from "@prisma/client";
import { recallCoachHistoryContext } from "@/server/memory/recall-coach-history-context";
import type { FtsStore } from "@/server/memory/store/fts-store";
import type { RetrievedCoachMemory } from "@/server/memory/retrieval/retrieve-coach-memory";
import type { HistoricalRecallItem } from "@/server/memory/retrieval/select-history-recall";
import { listActiveSlots } from "@/server/memory/store/synthesis-store";
import type { SynthesisSlotName } from "@/server/memory/memory.types";
import {
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import { readLearnerClaimSemantics } from "@/server/memory/claims/learner-claim-semantics";
import {
  isSafeEpisodeForConsumption,
  safeStoredMemoryTeachingText,
} from "@/server/memory/store/episode-store";
import { extractKnownConcepts } from "@/server/memory/retrieval/concepts";
import { readableFactTeachingText } from "@/server/memory/store/memory-document-content";

export type WeaknessSlotView = {
  slotKey: string;
  title: string;
  summary: string;
  evidenceCount: number;
  leetcodeNumber?: number;
  focusTags?: string[];
};

export type WeaknessSignalSource =
  | "l3_synthesis"
  | "l2_fact"
  | "memory_episode"
  | "none";

export type LearnerWeaknessSignals = {
  source: WeaknessSignalSource;
  items: WeaknessSlotView[];
};

export type MistakeView = {
  title: string;
  summary: string;
  sourceProblem?: { slug: string; title: string };
  outcome?: string;
  relationToCurrent:
    | "same_problem_history"
    | "cross_problem_history"
    | "profile_only";
};

export type ProblemView = MistakeView;

export type RecallResult<T> = {
  items: T[];
  retrievalStatus: RetrievedCoachMemory["retrievalStatus"];
};

export type RetrievalProblemContext = {
  id: string;
  slug: string;
  title: string;
  leetcodeNumber?: number;
  tags: string[];
};

export type RecallMemoryInput = {
  /** Internal User.id. Resolve an external handle before calling this service. */
  userId: string;
  query: string;
  activeProblem: RetrievalProblemContext;
  searchHints?: string[];
  limit?: number;
};

type ActiveSlotRecord = {
  slot: string;
  synthesisKey: string;
  text: string;
  evidenceFactIds: string;
  memoryOrigin: string;
};

type WeaknessFactRecord = {
  factType: string;
  tag: string;
  label: string | null;
  value: string | null;
  claimText: string | null;
  polarity: string | null;
  scopeJson: string;
  mechanismKeysJson: string;
  integrityVersion: number;
  status: string;
  memoryOrigin: string;
  validationJson: string;
  problem?: { title: string; tags: string; leetcodeNumber: number | null } | null;
};

type WeaknessEpisodeRecord = {
  title: string;
  summary: string;
  outcome: string;
  sourceTraceIds: string;
  memoryOrigin: string;
  tags: string;
  problem: { title: string; tags: string; leetcodeNumber?: number | null } | null;
  claimObservations: Array<{
    claimText: string;
    claimType: string;
    polarity: string;
    status: string;
    memoryOrigin: string;
    scopeJson: string;
    mechanismKeysJson: string;
  }>;
};

export type MemoryReadDependencies = {
  listActiveSlots(args: {
    userId: string;
    slots: SynthesisSlotName[];
    take: number;
  }): Promise<ActiveSlotRecord[]>;
  listTrustedWeaknessFacts(args: {
    userId: string;
    take: number;
  }): Promise<WeaknessFactRecord[]>;
  listNegativeEpisodes(args: {
    userId: string;
    take: number;
  }): Promise<WeaknessEpisodeRecord[]>;
  recallHistoryContext: (args: {
    userId: string;
    mode: "past_mistake_recall" | "past_problem_recall";
    userText: string;
    modelQuery: string;
    searchHints?: string[];
    activeProblem: RetrievalProblemContext;
  }) => Promise<{
    items: HistoricalRecallItem[];
    retrievalStatus: RetrievedCoachMemory["retrievalStatus"];
  }>;
};

export type MemoryReadService = {
  getLearnerWeaknessSlots(userId: string): Promise<WeaknessSlotView[]>;
  getLearnerWeaknessSignals(userId: string): Promise<LearnerWeaknessSignals>;
  recallPastMistakes(input: RecallMemoryInput): Promise<RecallResult<MistakeView>>;
  recallPastProblems(input: RecallMemoryInput): Promise<RecallResult<ProblemView>>;
};

type MemoryReadPrisma = PrismaClient;

const DEFAULT_SLOT_LIMIT = 8;
const DEFAULT_RECALL_LIMIT = 8;
const DEFAULT_WEAKNESS_SIGNAL_LIMIT = 8;
const TRUST_FILTER_OVERFETCH_FACTOR = 4;

/**
 * Binds the existing trusted memory stores into the deliberately read-only
 * dependency contract used by MCP and proactive workflows.
 */
export function createPrismaMemoryReadDependencies(
  prisma: MemoryReadPrisma,
  options: { ftsStore?: FtsStore } = {},
): MemoryReadDependencies {
  return {
    listActiveSlots: (args) => listActiveSlots(prisma, args),
    recallHistoryContext: (args) =>
      recallCoachHistoryContext({
        prisma: prisma as PrismaClient,
        userId: args.userId,
        memoryOrigin: "learner",
        mode: args.mode,
        userText: args.userText,
        modelQuery: args.modelQuery,
        searchHints: args.searchHints,
        activeProblem: args.activeProblem,
        ftsStore: options.ftsStore,
        vectorMode: "disabled",
      }),
    async listTrustedWeaknessFacts({ userId, take }) {
      const rows = await prisma.l2MemoryFact.findMany({
        where: {
          userId,
          memoryOrigin: "learner",
          status: { in: ["active", "improving", "validated"] },
          factType: { in: ["weakness", "mistake", "unresolved_confusion"] },
        },
        orderBy: { lastSeenAt: "desc" },
        take: take * TRUST_FILTER_OVERFETCH_FACTOR,
        select: {
          factType: true,
          tag: true,
          label: true,
          value: true,
          claimText: true,
          polarity: true,
          scopeJson: true,
          mechanismKeysJson: true,
          integrityVersion: true,
          status: true,
          memoryOrigin: true,
          validationJson: true,
          problem: {
            select: { title: true, tags: true, leetcodeNumber: true },
          },
        },
      });
      return rows.filter(isTrustedL2FactForConsumption).slice(0, take);
    },
    async listNegativeEpisodes({ userId, take }) {
      const rows = await prisma.memoryEpisode.findMany({
        where: {
          userId,
          memoryOrigin: "learner",
          OR: [
            { outcome: { in: ["failed", "unresolved"] } },
            {
              claimObservations: {
                some: {
                  memoryOrigin: "learner",
                  status: "accepted",
                  polarity: "negative",
                  claimType: {
                    in: ["weakness", "mistake", "unresolved_confusion"],
                  },
                },
              },
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: take * TRUST_FILTER_OVERFETCH_FACTOR,
        select: {
          title: true,
          summary: true,
          outcome: true,
          sourceTraceIds: true,
          memoryOrigin: true,
          tags: true,
          problem: {
            select: { title: true, tags: true, leetcodeNumber: true },
          },
          claimObservations: {
            where: {
              memoryOrigin: "learner",
              status: "accepted",
              polarity: "negative",
              claimType: {
                in: ["weakness", "mistake", "unresolved_confusion"],
              },
            },
            select: {
              claimText: true,
              claimType: true,
              polarity: true,
              status: true,
              memoryOrigin: true,
              scopeJson: true,
              mechanismKeysJson: true,
            },
          },
        },
      });
      return rows
        .filter(
          (episode) =>
            isSafeEpisodeForConsumption(episode) &&
            new Set(parseStringArray(episode.sourceTraceIds)).size > 0,
        )
        .slice(0, take);
    },
  };
}

export function createPrismaMemoryReadService(
  prisma: PrismaClient,
  options: { ftsStore?: FtsStore } = {},
): MemoryReadService {
  return createMemoryReadService(
    createPrismaMemoryReadDependencies(prisma, options),
  );
}

export function createMemoryReadService(
  dependencies: MemoryReadDependencies,
): MemoryReadService {
  return {
    getLearnerWeaknessSlots: (userId) =>
      getLearnerWeaknessSlots(dependencies, userId),
    getLearnerWeaknessSignals: (userId) =>
      getLearnerWeaknessSignals(dependencies, userId),
    recallPastMistakes: (input) => recallPastMistakes(dependencies, input),
    recallPastProblems: (input) => recallPastProblems(dependencies, input),
  };
}

export async function getLearnerWeaknessSignals(
  dependencies: MemoryReadDependencies,
  userId: string,
): Promise<LearnerWeaknessSignals> {
  requireNonBlank(userId, "userId");
  const synthesis = dedupeWeaknessSignals(
    (await getLearnerWeaknessSlots(dependencies, userId)).filter(
      (slot) => slot.evidenceCount > 0,
    ),
  );
  if (synthesis.length > 0) {
    return { source: "l3_synthesis", items: synthesis };
  }

  const factItems = dedupeWeaknessSignals(
    (
      await dependencies.listTrustedWeaknessFacts({
        userId,
        take: DEFAULT_WEAKNESS_SIGNAL_LIMIT,
      })
    ).flatMap(toTrustedFactWeaknessView),
  );
  if (factItems.length > 0) {
    return { source: "l2_fact", items: factItems };
  }

  const episodeItems = dedupeWeaknessSignals(
    (
      await dependencies.listNegativeEpisodes({
        userId,
        take: DEFAULT_WEAKNESS_SIGNAL_LIMIT,
      })
    ).flatMap(toNegativeEpisodeWeaknessView),
  );
  return {
    source: episodeItems.length > 0 ? "memory_episode" : "none",
    items: episodeItems,
  };
}

export function toWeaknessSlotView(slot: ActiveSlotRecord): WeaknessSlotView {
  return {
    slotKey: cleanText(slot.slot, 80),
    title: titleFromSynthesisKey(slot.synthesisKey),
    summary: cleanText(slot.text, 400),
    evidenceCount: new Set(parseStringArray(slot.evidenceFactIds)).size,
  };
}

export async function getLearnerWeaknessSlots(
  dependencies: MemoryReadDependencies,
  userId: string,
): Promise<WeaknessSlotView[]> {
  requireNonBlank(userId, "userId");
  const slots = await dependencies.listActiveSlots({
    userId,
    slots: ["weakness_patterns"],
    take: DEFAULT_SLOT_LIMIT,
  });

  // The store already enforces this boundary. Keep a defensive check here so
  // alternate adapters cannot leak development/evaluation memory through MCP.
  return slots
    .filter(
      (slot) =>
        slot.memoryOrigin === "learner" && slot.slot === "weakness_patterns",
    )
    .map(toWeaknessSlotView);
}

export async function recallPastMistakes(
  dependencies: MemoryReadDependencies,
  input: RecallMemoryInput,
): Promise<RecallResult<MistakeView>> {
  return recallHistory(dependencies, input, "past_mistake_recall");
}

export async function recallPastProblems(
  dependencies: MemoryReadDependencies,
  input: RecallMemoryInput,
): Promise<RecallResult<ProblemView>> {
  return recallHistory(dependencies, input, "past_problem_recall");
}

async function recallHistory(
  dependencies: MemoryReadDependencies,
  input: RecallMemoryInput,
  mode: "past_mistake_recall" | "past_problem_recall",
): Promise<RecallResult<MistakeView>> {
  requireNonBlank(input.userId, "userId");
  requireNonBlank(input.query, "query");
  const recalled = await dependencies.recallHistoryContext({
    userId: input.userId,
    mode,
    userText: input.query,
    modelQuery: input.query,
    searchHints: input.searchHints,
    activeProblem: input.activeProblem,
  });
  if (recalled.retrievalStatus === "failed") {
    throw new Error("Learner memory retrieval failed.");
  }
  return {
    items: recalled.items.slice(0, clampRecallLimit(input.limit)).map(toHistoryView),
    retrievalStatus: recalled.retrievalStatus,
  };
}

function toHistoryView(item: HistoricalRecallItem): MistakeView {
  return {
    title: item.title,
    summary: item.summary,
    sourceProblem: item.sourceProblem,
    outcome: item.outcome,
    relationToCurrent: item.relationToCurrent,
  };
}

function toTrustedFactWeaknessView(
  fact: WeaknessFactRecord,
): WeaknessSlotView[] {
  if (!isTrustedL2FactForConsumption(fact)) return [];
  const semantics = readLearnerClaimSemantics(fact);
  if (semantics.polarity !== "negative") return [];
  const summary = safeStoredMemoryTeachingText(
    readableFactTeachingText(fact) ?? semantics.statement,
  );
  const title = safeStoredMemoryTeachingText(
    fact.problem?.title ?? semantics.displayTopics[0],
  );
  const integrity = readDurableFactIntegrity(fact.validationJson);
  if (!summary || !title || !integrity || integrity.evidenceClusters.length === 0) {
    return [];
  }
  return [
    {
      slotKey: "l2_weakness",
      title: cleanText(title, 100),
      summary: cleanText(summary, 400),
      evidenceCount: new Set(
        integrity.evidenceClusters.map((cluster) => cluster.key),
      ).size,
      ...(fact.problem?.leetcodeNumber
        ? { leetcodeNumber: fact.problem.leetcodeNumber }
        : {}),
      focusTags: trustedFocusTags([
        integrity.mechanism,
        ...semantics.mechanismKeys,
        ...semantics.topicHints,
        ...parseStringArray(fact.problem?.tags ?? "[]"),
        summary,
      ]),
    },
  ];
}

function toNegativeEpisodeWeaknessView(
  episode: WeaknessEpisodeRecord,
): WeaknessSlotView[] {
  if (
    episode.memoryOrigin !== "learner" ||
    !isSafeEpisodeForConsumption(episode)
  ) {
    return [];
  }
  const evidenceCount = new Set(parseStringArray(episode.sourceTraceIds)).size;
  if (evidenceCount === 0) return [];
  const acceptedNegative = episode.claimObservations.find(
    (observation) =>
      observation.memoryOrigin === "learner" &&
      observation.status === "accepted" &&
      observation.polarity === "negative" &&
      ["weakness", "mistake", "unresolved_confusion"].includes(
        observation.claimType,
      ),
  );
  const hasNegativeOutcome = ["failed", "unresolved"].includes(
    episode.outcome.toLowerCase(),
  );
  if (!acceptedNegative && !hasNegativeOutcome) return [];
  const summary = safeStoredMemoryTeachingText(
    acceptedNegative?.claimText ?? episode.summary,
  );
  const title = safeStoredMemoryTeachingText(
    episode.problem?.title ?? episode.title,
  );
  if (!summary || !title) return [];
  const observationSemantics = acceptedNegative
    ? readLearnerClaimSemantics({
        factType: acceptedNegative.claimType,
        tag: acceptedNegative.claimType,
        claimText: acceptedNegative.claimText,
        polarity: acceptedNegative.polarity,
        scopeJson: acceptedNegative.scopeJson,
        mechanismKeysJson: acceptedNegative.mechanismKeysJson,
        integrityVersion: 2,
      })
    : undefined;
  const focusTags = trustedFocusTags([
    ...(observationSemantics?.mechanismKeys ?? []),
    ...(observationSemantics?.topicHints ?? []),
    ...parseStringArray(episode.tags),
    ...parseStringArray(episode.problem?.tags ?? "[]"),
    summary,
  ]);
  return [
    {
      slotKey: "episode_weakness",
      title: cleanText(title, 100),
      summary: cleanText(summary, 400),
      evidenceCount,
      ...(episode.problem?.leetcodeNumber
        ? { leetcodeNumber: episode.problem.leetcodeNumber }
        : {}),
      ...(focusTags.length > 0 ? { focusTags } : {}),
    },
  ];
}

function trustedFocusTags(values: string[]) {
  return [...new Set(extractKnownConcepts(values.join(" ")))];
}

function dedupeWeaknessSignals(
  items: readonly WeaknessSlotView[],
): WeaknessSlotView[] {
  const bySummary = new Map<string, WeaknessSlotView>();
  for (const item of items) {
    const key = item.summary.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
    const existing = bySummary.get(key);
    if (!existing) {
      bySummary.set(key, item);
      continue;
    }
    const focusTags = [
      ...new Set([...(existing.focusTags ?? []), ...(item.focusTags ?? [])]),
    ];
    bySummary.set(key, {
      ...existing,
      // Compact views intentionally do not expose evidence identities. Taking
      // the maximum avoids inflating confidence when two rows cite the same
      // underlying trace or cluster.
      evidenceCount: Math.max(existing.evidenceCount, item.evidenceCount),
      ...(focusTags.length > 0 ? { focusTags } : {}),
    });
  }
  return [...bySummary.values()];
}

function titleFromSynthesisKey(value: string) {
  const normalized = cleanText(value.replaceAll("_", " ").replaceAll("-", " "), 100);
  return normalized
    ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    : "Weakness pattern";
}

function cleanText(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function parseStringArray(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function clampRecallLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_RECALL_LIMIT;
  }
  return Math.min(DEFAULT_RECALL_LIMIT, Math.max(1, Math.floor(limit)));
}

function requireNonBlank(value: string, field: string) {
  if (!value.trim()) {
    throw new Error(`${field} must not be blank.`);
  }
}
