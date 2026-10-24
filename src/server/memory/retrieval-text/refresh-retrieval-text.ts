import type OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";

import { createMemoryClient } from "@/server/llm/client";
import { withMemoryNonStreamingCompatibility } from "@/server/llm/memory-provider-compat";
import { getMemoryModel } from "@/server/llm/models";
import {
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import {
  RETRIEVAL_TEXT_VERSION,
  buildRetrievalTextPrompt,
  deterministicRetrievalText,
  retrievalTextInputHash,
  validateRetrievalText,
  type RetrievalTextSource,
} from "./retrieval-text";

export type RetrievalTextRefreshProvider = {
  name: string;
  rewrite(
    sources: readonly RetrievalTextSource[],
  ): Promise<Map<string, string>>;
};

export type RetrievalTextRefreshResult = {
  refreshedIds: string[];
  skippedIds: string[];
  failed: Array<{ sourceId: string; reason: string }>;
};

/**
 * Refreshes source-owned retrieval prose in dependency order. Deterministic
 * code only binds evidence, detects stale hashes, and validates the model's
 * output; it never invents the semantic card.
 */
export async function refreshLearnerRetrievalText(
  prisma: PrismaClient,
  args: {
    userId: string;
    episodeIds?: readonly string[];
    factIds?: readonly string[];
    slotIds?: readonly string[];
    provider?: RetrievalTextRefreshProvider;
  },
): Promise<RetrievalTextRefreshResult> {
  let provider = args.provider;
  const requireProvider = () =>
    (provider ??= createRetrievalTextRefreshProvider());
  const result: RetrievalTextRefreshResult = {
    refreshedIds: [],
    skippedIds: [],
    failed: [],
  };

  const episodeSources = await loadEpisodeSources(
    prisma,
    args.userId,
    args.episodeIds ?? [],
  );
  if (episodeSources.length > 0) {
    await refreshSources(prisma, episodeSources, requireProvider(), result);
  }
  const factSources = await loadFactSources(
    prisma,
    args.userId,
    args.factIds ?? [],
  );
  if (factSources.length > 0) {
    await refreshSources(prisma, factSources, requireProvider(), result);
  }

  const dependentSlotIds = await loadDependentSlotIds(
    prisma,
    args.userId,
    args.factIds ?? [],
  );
  const slotSources = await loadSlotSources(prisma, args.userId, [
    ...new Set([...(args.slotIds ?? []), ...dependentSlotIds]),
  ]);
  if (slotSources.length > 0) {
    await refreshSources(prisma, slotSources, requireProvider(), result);
  }
  return result;
}

export function createRetrievalTextRefreshProvider(
  options: {
    client?: OpenAI;
    model?: string;
  } = {},
): RetrievalTextRefreshProvider {
  const client = options.client ?? createMemoryClient();
  const model = options.model ?? getMemoryModel();
  return {
    name: `memory-retrieval-text:${model}`,
    async rewrite(sources) {
      if (sources.length === 0) return new Map();
      const completion = await client.chat.completions.create(
        withMemoryNonStreamingCompatibility({
          model,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content:
                "You are PatternCoach AI MemoryAgent. Rewrite each evidence-bound source into retrieval prose. Return strict JSON only.",
            },
            {
              role: "user",
              content: [
                'Return {"cards":[{"sourceId":"...","retrievalText":"..."}]}. Return exactly one card for every sourceId and no extra ids.',
                ...sources.map(
                  (source) =>
                    `\n=== SOURCE ${source.sourceId} ===\n${buildRetrievalTextPrompt(source)}`,
                ),
              ].join("\n"),
            },
          ],
        }),
      );
      const content = completion.choices[0]?.message.content;
      if (!content) throw new Error("retrieval_text_empty_response");
      const parsed = JSON.parse(stripJsonFence(content)) as {
        cards?: Array<{ sourceId?: unknown; retrievalText?: unknown }>;
      };
      const expected = new Set(sources.map((source) => source.sourceId));
      const cards = new Map<string, string>();
      for (const card of parsed.cards ?? []) {
        if (typeof card.sourceId !== "string" || !expected.has(card.sourceId)) {
          throw new Error("retrieval_text_unexpected_source_id");
        }
        const text = validateRetrievalText(card.retrievalText);
        if (!text || cards.has(card.sourceId)) {
          throw new Error("retrieval_text_invalid_card");
        }
        cards.set(card.sourceId, text);
      }
      if (cards.size !== expected.size) {
        throw new Error("retrieval_text_incomplete_batch");
      }
      return cards;
    },
  };
}

/** Explicit test seam; production callers never select this provider. */
export function createDeterministicRetrievalTextRefreshProvider(): RetrievalTextRefreshProvider {
  return {
    name: "deterministic-test-retrieval-text",
    rewrite: async (sources) =>
      new Map(
        sources.map((source) => [
          source.sourceId,
          deterministicRetrievalText(source),
        ]),
      ),
  };
}

type PendingSource = {
  source: RetrievalTextSource;
  existing: {
    retrievalText: string | null;
    retrievalTextVersion: number;
    retrievalInputHash: string | null;
  };
};

async function refreshSources(
  prisma: PrismaClient,
  candidates: PendingSource[],
  provider: RetrievalTextRefreshProvider,
  result: RetrievalTextRefreshResult,
) {
  const pending = candidates.filter(({ source, existing }) => {
    const current =
      Boolean(existing.retrievalText) &&
      existing.retrievalTextVersion === RETRIEVAL_TEXT_VERSION &&
      existing.retrievalInputHash === retrievalTextInputHash(source);
    if (current) result.skippedIds.push(source.sourceId);
    return !current;
  });
  for (let index = 0; index < pending.length; index += 8) {
    const batch = pending.slice(index, index + 8);
    // Fail closed before the model call: if rewriting fails, the Tool must not
    // keep serving prose whose source hash is already stale.
    await prisma.$transaction(
      batch.map(({ source }) => {
        const data = { retrievalTextVersion: 0, retrievalInputHash: null };
        return source.layer === "episode"
          ? prisma.memoryEpisode.update({
              where: { id: source.sourceId },
              data,
            })
          : source.layer === "l2_fact"
            ? prisma.l2MemoryFact.update({
                where: { id: source.sourceId },
                data,
              })
            : prisma.synthesisSlot.update({
                where: { id: source.sourceId },
                data,
              });
      }),
    );
    let rewritten: Map<string, string>;
    try {
      rewritten = await provider.rewrite(batch.map(({ source }) => source));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.failed.push(
        ...batch.map(({ source }) => ({ sourceId: source.sourceId, reason })),
      );
      continue;
    }
    await prisma.$transaction(
      batch.map(({ source }) => {
        const data = {
          retrievalText: rewritten.get(source.sourceId)!,
          retrievalTextVersion: RETRIEVAL_TEXT_VERSION,
          retrievalInputHash: retrievalTextInputHash(source),
        };
        return source.layer === "episode"
          ? prisma.memoryEpisode.update({
              where: { id: source.sourceId },
              data,
            })
          : source.layer === "l2_fact"
            ? prisma.l2MemoryFact.update({
                where: { id: source.sourceId },
                data,
              })
            : prisma.synthesisSlot.update({
                where: { id: source.sourceId },
                data,
              });
      }),
    );
    result.refreshedIds.push(...batch.map(({ source }) => source.sourceId));
  }
}

async function loadEpisodeSources(
  prisma: PrismaClient,
  userId: string,
  ids: readonly string[],
): Promise<PendingSource[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.memoryEpisode.findMany({
    where: { id: { in: [...ids] }, userId, memoryOrigin: "learner" },
    include: { problem: { select: { title: true, slug: true } } },
  });
  return rows.map((row) => ({
    source: {
      layer: "episode",
      sourceId: row.id,
      sourceText: compact([
        row.problem
          ? `Problem: ${row.problem.title} (${row.problem.slug}).`
          : "Problem was not retained.",
        `Episode title: ${row.title}`,
        `Summary: ${row.summary}`,
        `Outcome: ${row.outcome}`,
      ]),
    },
    existing: row,
  }));
}

async function loadFactSources(
  prisma: PrismaClient,
  userId: string,
  ids: readonly string[],
): Promise<PendingSource[]> {
  if (ids.length === 0) return [];
  const [rows, episodes] = await Promise.all([
    prisma.l2MemoryFact.findMany({
      where: { id: { in: [...ids] }, userId, memoryOrigin: "learner" },
      include: { problem: { select: { title: true, slug: true } } },
    }),
    prisma.memoryEpisode.findMany({
      where: {
        userId,
        memoryOrigin: "learner",
        retrievalTextVersion: { gt: 0 },
      },
      select: {
        id: true,
        activityClusterId: true,
        activityCluster: { select: { rootReviewAttemptId: true } },
        retrievalText: true,
      },
    }),
  ]);
  return rows.filter(isTrustedL2FactForConsumption).map((row) => {
    const clusters =
      readDurableFactIntegrity(row.validationJson)?.evidenceClusters ?? [];
    const clusterIds = new Set(clusters.map((cluster) => cluster.key));
    const reviewIds = new Set(
      clusters.flatMap((cluster) =>
        cluster.reviewAttemptId ? [cluster.reviewAttemptId] : [],
      ),
    );
    const representative = episodes
      .filter(
        (episode) =>
          (episode.activityClusterId &&
            clusterIds.has(episode.activityClusterId)) ||
          (episode.activityCluster?.rootReviewAttemptId &&
            reviewIds.has(episode.activityCluster.rootReviewAttemptId)),
      )
      .slice(0, 3);
    return {
      source: {
        layer: "l2_fact" as const,
        sourceId: row.id,
        sourceText: compact([
          `Claim: ${row.claimText ?? row.label ?? row.value ?? "Learner memory fact."}`,
          row.polarity ? `Observed direction: ${row.polarity}.` : "",
          row.lastEvidenceSummary
            ? `Latest evidence summary: ${row.lastEvidenceSummary}`
            : "",
          row.problem
            ? `Associated problem: ${row.problem.title} (${row.problem.slug}).`
            : "",
        ]),
        representativeEvidence: representative.flatMap((episode) =>
          episode.retrievalText
            ? [`Related episode: ${episode.retrievalText}`]
            : [],
        ),
      },
      existing: row,
    };
  });
}

async function loadDependentSlotIds(
  prisma: PrismaClient,
  userId: string,
  factIds: readonly string[],
) {
  if (factIds.length === 0) return [];
  const wanted = new Set(factIds);
  const slots = await prisma.synthesisSlot.findMany({
    where: { userId, memoryOrigin: "learner", status: "active" },
    select: { id: true, evidenceFactIds: true },
  });
  return slots
    .filter((slot) =>
      parseStrings(slot.evidenceFactIds).some((id) => wanted.has(id)),
    )
    .map((slot) => slot.id);
}

async function loadSlotSources(
  prisma: PrismaClient,
  userId: string,
  ids: readonly string[],
): Promise<PendingSource[]> {
  if (ids.length === 0) return [];
  const [slots, facts] = await Promise.all([
    prisma.synthesisSlot.findMany({
      where: {
        id: { in: [...ids] },
        userId,
        memoryOrigin: "learner",
        status: "active",
      },
    }),
    prisma.l2MemoryFact.findMany({
      where: {
        userId,
        memoryOrigin: "learner",
        retrievalTextVersion: { gt: 0 },
      },
      select: { id: true, retrievalText: true },
    }),
  ]);
  const factById = new Map(facts.map((fact) => [fact.id, fact.retrievalText]));
  return slots.flatMap((slot) => {
    const cited = parseStrings(slot.evidenceFactIds).flatMap((id) => {
      const text = factById.get(id);
      return text ? [{ id, text }] : [];
    });
    if (cited.length === 0) return [];
    return [
      {
        source: {
          layer: "l3_synthesis" as const,
          sourceId: slot.id,
          sourceText: compact([
            `Synthesis slot: ${slot.slot}.`,
            `Existing synthesis: ${slot.text}`,
          ]),
          representativeEvidence: cited.map(
            ({ text }) => `Cited learner pattern: ${text}`,
          ),
        },
        existing: slot,
      },
    ];
  });
}

function compact(values: string[]) {
  return [
    ...new Set(
      values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean),
    ),
  ];
}

function parseStrings(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}
