import type { PrismaClient } from "@prisma/client";
import type {
  SlotUpsert,
  SynthesisSlotName,
} from "@/server/memory/memory.types";
import {
  isBlockedDurableFactTag,
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import { containsBlockedEpisodeNoise } from "@/server/memory/store/episode-store";
import {
  resolveMemoryWritePolicy,
  type MemoryOrigin,
} from "@/server/memory/memory-origin";

type SynthesisPrisma = Pick<PrismaClient, "synthesisSlot" | "l2MemoryFact">;

type SynthesisEvidenceFact = {
  id: string;
  factType: string;
  tag: string;
  status: string;
  memoryOrigin: string;
  validationJson: string | null;
  polarity?: string | null;
};

export type SynthesisEvidenceDecision =
  | {
      eligible: true;
      polarity: "positive" | "negative" | "neutral" | "mixed";
      evidenceClusterIds: string[];
      distinctProblemIds: string[];
    }
  | {
      eligible: false;
      reason: string;
      evidenceClusterCount: number;
      distinctProblemCount: number;
    };

export function evaluateSynthesisEvidenceFacts(
  facts: SynthesisEvidenceFact[],
): SynthesisEvidenceDecision {
  if (facts.length === 0 || !facts.every(isTrustedL2FactForConsumption)) {
    return rejectedSynthesisEvidence("untrusted_or_missing_fact", 0, 0);
  }

  const polarities = new Set(facts.map(synthesisPolarity));

  const clusters = facts.flatMap(
    (fact) => readDurableFactIntegrity(fact.validationJson)?.evidenceClusters ?? [],
  );
  const uniqueClusters = [
    ...new Map(clusters.map((cluster) => [cluster.key, cluster])).values(),
  ];
  const distinctProblemIds = [
    ...new Set(
      uniqueClusters.flatMap((cluster) =>
        cluster.problemId ? [cluster.problemId] : [],
      ),
    ),
  ];
  if (uniqueClusters.length < 2 || distinctProblemIds.length < 2) {
    return rejectedSynthesisEvidence(
      "insufficient_independent_cross_problem_clusters",
      uniqueClusters.length,
      distinctProblemIds.length,
    );
  }

  return {
    eligible: true,
    polarity:
      polarities.size === 1
        ? ([...polarities][0] as "positive" | "negative" | "neutral")
        : "mixed",
    evidenceClusterIds: uniqueClusters.map((cluster) => cluster.key),
    distinctProblemIds,
  };
}

export function evaluateSynthesisSlotEvidence(
  slot: string,
  facts: SynthesisEvidenceFact[],
): SynthesisEvidenceDecision {
  const decision = evaluateSynthesisEvidenceFacts(facts);
  if (!decision.eligible) return decision;
  const requiredPolarity =
    slot === "weakness_patterns"
      ? "negative"
      : slot === "strengths"
        ? "positive"
        : undefined;
  if (requiredPolarity && decision.polarity !== requiredPolarity) {
    return rejectedSynthesisEvidence(
      `slot_${slot}_requires_${requiredPolarity}_evidence`,
      decision.evidenceClusterIds.length,
      decision.distinctProblemIds.length,
    );
  }
  return decision;
}

export async function upsertSynthesisSlots(
  prisma: SynthesisPrisma,
  args: { userId: string; upserts: SlotUpsert[] },
) {
  const writePolicy = resolveMemoryWritePolicy();
  if (!writePolicy.durableWrites) {
    throw new Error(
      `Synthesis writes require learner process origin; got ${writePolicy.origin}.`,
    );
  }
  const results = [];

  for (const upsert of args.upserts) {
    if (
      isBlockedDurableFactTag(upsert.synthesisKey) ||
      containsBlockedEpisodeNoise(upsert.text) ||
      /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/i.test(upsert.text)
    ) {
      throw new Error(
        `Synthesis slot ${upsert.slot}/${upsert.synthesisKey} contains an internal or blocked memory label.`,
      );
    }
    const citedFacts = await prisma.l2MemoryFact.findMany({
      where: {
        id: { in: upsert.evidenceFactIds },
        userId: args.userId,
      },
    });
    const slotEvidence = evaluateSynthesisSlotEvidence(upsert.slot, citedFacts);
    if (
      citedFacts.length !== upsert.evidenceFactIds.length ||
      !slotEvidence.eligible
    ) {
      if (
        !slotEvidence.eligible &&
        slotEvidence.reason.startsWith("slot_")
      ) {
        const required = upsert.slot === "strengths" ? "strength" : "weakness";
        throw new Error(
          `Synthesis slot ${upsert.slot}/${upsert.synthesisKey} requires ${required} evidence.`,
        );
      }
      throw new Error(
        `Synthesis slot ${upsert.slot}/${upsert.synthesisKey} requires two independent trusted cross-problem evidence clusters.`,
      );
    }
    results.push(
      await prisma.synthesisSlot.upsert({
        where: {
          userId_slot_synthesisKey_memoryOrigin: {
            userId: args.userId,
            slot: upsert.slot,
            synthesisKey: upsert.synthesisKey,
            memoryOrigin: "learner",
          },
        },
        create: {
          userId: args.userId,
          slot: upsert.slot,
          synthesisKey: upsert.synthesisKey,
          text: upsert.text,
          evidenceFactIds: JSON.stringify(upsert.evidenceFactIds),
          confidence: upsert.confidence,
          status: upsert.status,
          memoryOrigin: "learner",
        },
        update: {
          text: upsert.text,
          evidenceFactIds: JSON.stringify(upsert.evidenceFactIds),
          confidence: upsert.confidence,
          status: upsert.status,
          memoryOrigin: "learner",
        },
      }),
    );
  }

  return results;
}

function synthesisPolarity(fact: SynthesisEvidenceFact) {
  if (
    fact.polarity === "positive" ||
    fact.polarity === "negative" ||
    fact.polarity === "neutral"
  ) {
    return fact.polarity;
  }
  if (fact.factType === "strength" || fact.factType === "skill") return "positive";
  if (
    fact.factType === "weakness" ||
    fact.factType === "mistake" ||
    fact.factType === "unresolved_confusion"
  ) {
    return "negative";
  }
  return "neutral";
}

function rejectedSynthesisEvidence(
  reason: string,
  evidenceClusterCount: number,
  distinctProblemCount: number,
): SynthesisEvidenceDecision {
  return {
    eligible: false,
    reason,
    evidenceClusterCount,
    distinctProblemCount,
  };
}

export async function listActiveSlots(
  prisma: SynthesisPrisma,
  args: { userId: string; slots?: SynthesisSlotName[]; take: number },
) {
  const rows = await prisma.synthesisSlot.findMany({
    where: {
      userId: args.userId,
      status: "active",
      memoryOrigin: "learner",
      ...(args.slots ? { slot: { in: args.slots } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(args.take * 4, args.take),
  });
  return filterSlotsByTrustedEvidence(prisma, args.userId, rows, "learner").then((safe) =>
    safe.slice(0, args.take),
  );
}

export async function findActiveSlotsByIds(
  prisma: SynthesisPrisma,
  args: { userId: string; ids: string[]; memoryOrigin?: MemoryOrigin },
) {
  if (args.ids.length === 0) return [];
  const rows = await prisma.synthesisSlot.findMany({
    where: {
      id: { in: args.ids },
      userId: args.userId,
      status: "active",
      memoryOrigin: args.memoryOrigin ?? "learner",
    },
  });
  return filterSlotsByTrustedEvidence(
    prisma,
    args.userId,
    rows,
    args.memoryOrigin ?? "learner",
  );
}

async function filterSlotsByTrustedEvidence<
  T extends { slot: string; synthesisKey: string; evidenceFactIds: string },
>(
  prisma: SynthesisPrisma,
  userId: string,
  rows: T[],
  memoryOrigin: MemoryOrigin,
) {
  const evidenceIds = [
    ...new Set(rows.flatMap((slot) => parseStringArray(slot.evidenceFactIds))),
  ];
  const trustedFacts = await prisma.l2MemoryFact.findMany({
    where: { id: { in: evidenceIds }, userId, memoryOrigin },
  });
  const factsById = new Map(trustedFacts.map((fact) => [fact.id, fact]));

  return rows.filter((slot) => {
      if (isBlockedDurableFactTag(slot.synthesisKey)) return false;
      const citedIds = parseStringArray(slot.evidenceFactIds);
      const cited = citedIds.flatMap((id) => {
        const fact = factsById.get(id);
        return fact ? [fact] : [];
      });
      return (
        cited.length === citedIds.length &&
        evaluateSynthesisSlotEvidence(slot.slot, cited).eligible
      );
    });
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
