import type { PrismaClient } from "@prisma/client";
import { HISTORICAL_REPLAY_RULE_VERSION } from "./historical-review-replay";

type ReplacementPrisma = Pick<
  PrismaClient,
  "l1MemoryEvent" | "l2MemoryFact" | "memoryEpisode" | "synthesisSlot" | "$transaction"
>;

export type PriorReplayReplacementPlan = {
  currentReplayFactsRetained: number;
  currentReplayEpisodesRetained: number;
  priorReplayFactsRemoved: number;
  priorReplayEpisodesRemoved: number;
  dependentSynthesisSlotsStaled: number;
};

export async function replacePriorHistoricalReplayMemory(
  prisma: ReplacementPrisma,
  args: {
    userId: string;
    provenanceDecisionFingerprint: string;
    apply: boolean;
  },
): Promise<PriorReplayReplacementPlan> {
  const [facts, episodes, slots] = await Promise.all([
    prisma.l2MemoryFact.findMany({
      where: {
        userId: args.userId,
        memoryOrigin: "learner",
        source: "historical_replay",
      },
      select: { id: true, evidenceTraceIds: true },
    }),
    prisma.memoryEpisode.findMany({
      where: {
        userId: args.userId,
        memoryOrigin: "learner",
        OR: [
          { id: { startsWith: "historical-replay-" } },
          { id: { startsWith: "manual-replay-" } },
        ],
      },
      select: { id: true, sourceTraceIds: true },
    }),
    prisma.synthesisSlot.findMany({
      where: { userId: args.userId, memoryOrigin: "learner" },
      select: { id: true, evidenceFactIds: true },
    }),
  ]);
  const traceIds = [
    ...facts.flatMap((fact) => parseStringArray(fact.evidenceTraceIds)),
    ...episodes.flatMap((episode) => parseStringArray(episode.sourceTraceIds)),
  ];
  const traceRows = traceIds.length
    ? await prisma.l1MemoryEvent.findMany({
        where: { id: { in: [...new Set(traceIds)] }, userId: args.userId },
        select: { id: true, eventJson: true },
      })
    : [];
  const currentTraceIds = new Set(
    traceRows.flatMap((trace) => {
      const payload = parseRecord(trace.eventJson);
      return payload.replayRuleVersion === HISTORICAL_REPLAY_RULE_VERSION &&
        payload.provenanceDecisionFingerprint ===
          args.provenanceDecisionFingerprint
        ? [trace.id]
        : [];
    }),
  );
  const priorFactIds = facts
    .filter(
      (fact) =>
        !isEntirelyCurrentReplay(
          parseStringArray(fact.evidenceTraceIds),
          currentTraceIds,
        ),
    )
    .map((fact) => fact.id);
  const priorEpisodeIds = episodes
    .filter(
      (episode) =>
        !isEntirelyCurrentReplay(
          parseStringArray(episode.sourceTraceIds),
          currentTraceIds,
        ),
    )
    .map((episode) => episode.id);
  const priorFactIdSet = new Set(priorFactIds);
  const dependentSlotIds = slots
    .filter((slot) =>
      parseStringArray(slot.evidenceFactIds).some((id) =>
        priorFactIdSet.has(id),
      ),
    )
    .map((slot) => slot.id);

  const plan = {
    currentReplayFactsRetained: facts.length - priorFactIds.length,
    currentReplayEpisodesRetained: episodes.length - priorEpisodeIds.length,
    priorReplayFactsRemoved: priorFactIds.length,
    priorReplayEpisodesRemoved: priorEpisodeIds.length,
    dependentSynthesisSlotsStaled: dependentSlotIds.length,
  };
  if (!args.apply) return plan;

  await prisma.$transaction(async (tx) => {
    if (dependentSlotIds.length > 0) {
      await tx.synthesisSlot.updateMany({
        where: { id: { in: dependentSlotIds } },
        data: { status: "stale" },
      });
    }
    if (priorEpisodeIds.length > 0) {
      await tx.memoryEpisode.deleteMany({
        where: { id: { in: priorEpisodeIds } },
      });
    }
    if (priorFactIds.length > 0) {
      await tx.l2MemoryFact.deleteMany({
        where: { id: { in: priorFactIds } },
      });
    }
  });
  return plan;
}

function isEntirelyCurrentReplay(
  traceIds: string[],
  currentTraceIds: ReadonlySet<string>,
) {
  return (
    traceIds.length > 0 && traceIds.every((traceId) => currentTraceIds.has(traceId))
  );
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

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
