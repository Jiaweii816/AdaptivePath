import type { PrismaClient } from "@prisma/client";
import {
  SALIENCE_HINT_LEVEL,
  normalizeMemoryTag,
  type StrategyValidation,
} from "@/server/memory/memory.types";
import { applyStrategyObservationUpdates } from "@/server/memory/store/fact-store";

export { decideStrategyTransition } from "@/server/memory/memory.types";

export type StrategyObservationInput = {
  appliedEvents: Array<{
    strategyTag: string;
    appliedAssistantMessageId: string;
    chatSessionId: string;
    anchorSequence: number;
  }>;
  episodesAfter: Array<{
    tags: string[];
    outcome: string;
    chatSessionId: string | null;
    startSequence: number | null;
  }>;
  repeatMistakeEvidence?: Array<{
    tag: string;
    chatSessionId: string | null;
    sequence: number | null;
  }>;
  hintEvents?: Array<{
    chatSessionId: string | null;
    sequence: number | null;
    level: number;
  }>;
  signals: Array<{
    tag: string;
    polarity: "positive" | "negative";
    userSelfCorrected?: boolean;
  }>;
};

export function computeStrategyObservations(
  input: StrategyObservationInput,
): Map<string, StrategyValidation> {
  const observations = new Map<string, StrategyValidation>();
  const get = (tag: string) => {
    const key = normalizeMemoryTag(tag);
    const existing = observations.get(key);
    if (existing) {
      return existing;
    }

    const created: StrategyValidation = {
      applied: 0,
      positive: 0,
      negative: 0,
      deterministicPositive: 0,
    };
    observations.set(key, created);
    return created;
  };

  for (const applied of input.appliedEvents) {
    const counts = get(applied.strategyTag);
    counts.applied += 1;
    const tag = normalizeMemoryTag(applied.strategyTag);
    const learnerEpisodesAfter = input.episodesAfter.filter((episode) =>
      isAfterApplied(applied, episode),
    );

    for (const episode of learnerEpisodesAfter) {
      if (episode.outcome === "passed" || episode.outcome === "resolved") {
        counts.positive += 1;
        counts.deterministicPositive += 1;
      } else if (
        episode.outcome === "failed" ||
        episode.outcome === "unresolved"
      ) {
        counts.negative += 1;
      }
    }

    const repeatedMistakesAfter = (input.repeatMistakeEvidence ?? []).filter(
      (evidence) =>
        isAfterApplied(applied, evidence) &&
        normalizeMemoryTag(evidence.tag) === tag,
    );
    const repeatedMistakesBefore = (input.repeatMistakeEvidence ?? []).filter(
      (evidence) =>
        isAtOrBeforeApplied(applied, evidence) &&
        normalizeMemoryTag(evidence.tag) === tag,
    );
    if (repeatedMistakesAfter.length > 0) {
      counts.negative += repeatedMistakesAfter.length;
    } else if (
      repeatedMistakesBefore.length > 0 &&
      hasPostApplyActivity(applied, input)
    ) {
      counts.positive += 1;
      counts.deterministicPositive += 1;
    }

    const hintEvents = (input.hintEvents ?? []).filter(
      (event) => event.chatSessionId === applied.chatSessionId,
    );
    const hintEventsBefore = hintEvents.filter((event) =>
      isAtOrBeforeApplied(applied, event),
    );
    const hintEventsAfter = hintEvents.filter((event) =>
      isAfterApplied(applied, event),
    );
    const maxHintLevelBefore = maxLevel(hintEventsBefore);
    const maxHintLevelAfter = maxLevel(hintEventsAfter);
    if (maxHintLevelAfter !== undefined) {
      if (isLowerHintEscalation(maxHintLevelBefore, maxHintLevelAfter)) {
        counts.positive += 1;
        counts.deterministicPositive += 1;
      } else {
        counts.negative += 1;
      }
    } else if (
      maxHintLevelBefore !== undefined &&
      maxHintLevelBefore >= SALIENCE_HINT_LEVEL &&
      hasPostApplyActivity(applied, input)
    ) {
      counts.positive += 1;
      counts.deterministicPositive += 1;
    }
  }

  for (const signal of input.signals) {
    const counts = get(signal.tag);
    if (signal.polarity === "positive") {
      counts.positive += 1;
    } else {
      counts.negative += 1;
    }
  }

  return observations;
}

function isAfterApplied(
  applied: {
    chatSessionId: string;
    anchorSequence: number;
  },
  observed: {
    chatSessionId: string | null;
    sequence?: number | null;
    startSequence?: number | null;
  },
) {
  const observedSequence = observed.sequence ?? observed.startSequence;
  return (
    observed.chatSessionId === applied.chatSessionId &&
    observedSequence !== undefined &&
    observedSequence !== null &&
    observedSequence > applied.anchorSequence
  );
}

function isAtOrBeforeApplied(
  applied: {
    chatSessionId: string;
    anchorSequence: number;
  },
  observed: {
    chatSessionId: string | null;
    sequence?: number | null;
    startSequence?: number | null;
  },
) {
  const observedSequence = observed.sequence ?? observed.startSequence;
  return (
    observed.chatSessionId === applied.chatSessionId &&
    observedSequence !== undefined &&
    observedSequence !== null &&
    observedSequence <= applied.anchorSequence
  );
}

function hasPostApplyActivity(
  applied: StrategyObservationInput["appliedEvents"][number],
  input: StrategyObservationInput,
) {
  return (
    input.episodesAfter.some((episode) => isAfterApplied(applied, episode)) ||
    (input.repeatMistakeEvidence ?? []).some((evidence) =>
      isAfterApplied(applied, evidence),
    ) ||
    (input.hintEvents ?? []).some((event) => isAfterApplied(applied, event))
  );
}

function maxLevel(events: Array<{ level: number }>) {
  return events.length > 0
    ? Math.max(...events.map((event) => event.level))
    : undefined;
}

function isLowerHintEscalation(
  maxHintLevelBefore: number | undefined,
  maxHintLevelAfter: number,
) {
  if (maxHintLevelBefore !== undefined) {
    return maxHintLevelAfter < maxHintLevelBefore || maxHintLevelAfter <= 1;
  }

  return maxHintLevelAfter <= 1;
}

type ObserverPrisma = Pick<
  PrismaClient,
  | "l2MemoryFact"
  | "l1MemoryEvent"
  | "runEvidence"
  | "mockInterviewRunEvidence"
  | "practiceRunLog"
  | "chatMessage"
  | "problem"
>;

export async function applyStrategyObservations(
  prisma: ObserverPrisma,
  args: {
    userId: string;
    observations: Map<string, StrategyValidation>;
    evidenceTraceIdsByTag?: ReadonlyMap<string, string[]>;
    now?: Date;
  },
) {
  return applyStrategyObservationUpdates(prisma, args);
}
