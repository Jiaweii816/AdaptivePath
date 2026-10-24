import prisma from "@/server/db/prisma";
import {
  irisDefaultProfile,
  irisHandle,
} from "@/features/onboarding/profile-defaults";
import { isSafeEpisodeForConsumption } from "@/server/memory/store/episode-store";
import {
  loadCandidateFacts,
  loadEstablishedFacts,
} from "./load-ledger-facts";
import { loadSynthesisSlots } from "./load-ledger-slots";
import { auditSelfReportedPatterns } from "./self-reported-audit";
import type {
  EvidenceLedgerData,
  LedgerEpisode,
  LedgerTotals,
} from "./ledger-types";

const MAX_EPISODES = 30;
const LEARNER_ORIGIN = "learner";
const VERIFIED_AUTHORITY = "verified";

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function loadEpisodes(userId: string): Promise<LedgerEpisode[]> {
  const rows = await prisma.memoryEpisode.findMany({
    where: { userId, memoryOrigin: LEARNER_ORIGIN },
    orderBy: { createdAt: "desc" },
    take: MAX_EPISODES,
  });

  return rows.filter(isSafeEpisodeForConsumption).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    outcome: row.outcome,
    tags: parseStringArray(row.tags),
    createdAt: row.createdAt,
  }));
}

async function loadTotals(userId: string): Promise<LedgerTotals> {
  const where = { userId, memoryOrigin: LEARNER_ORIGIN } as const;
  // Contribution rows carry no userId; they are scoped through the fact they
  // support so the counts stay inside this learner's ledger.
  const evidenceWhere = { targetClusterFact: where } as const;
  const [
    activeSlots,
    activeFacts,
    candidateFacts,
    evidenceRows,
    verifiedEvidenceRows,
    reviewEpisodes,
    chatEpisodes,
    episodes,
    traceEvents,
    citedProblems,
  ] = await Promise.all([
    prisma.synthesisSlot.count({ where: { ...where, status: "active" } }),
    prisma.l2MemoryFact.count({
      where: { ...where, status: { in: ["active", "improving", "validated"] } },
    }),
    prisma.l2MemoryFact.count({ where: { ...where, status: "candidate" } }),
    prisma.memoryEvidenceContribution.count({ where: evidenceWhere }),
    prisma.memoryEvidenceContribution.count({
      where: { ...evidenceWhere, authority: VERIFIED_AUTHORITY },
    }),
    prisma.memoryEpisode.count({ where: { ...where, kind: "review" } }),
    prisma.memoryEpisode.count({ where: { ...where, kind: "chat_segment" } }),
    prisma.memoryEpisode.count({ where }),
    prisma.l1MemoryEvent.count({ where }),
    prisma.memoryEvidenceContribution
      .findMany({
        where: { ...evidenceWhere, problemId: { not: null } },
        distinct: ["problemId"],
        select: { problemId: true },
      })
      .then((rows) => rows.length),
  ]);

  return {
    activeSlots,
    activeFacts,
    candidateFacts,
    evidenceRows,
    verifiedEvidenceRows,
    episodes,
    reviewEpisodes,
    chatEpisodes,
    citedProblems,
    traceEvents,
  };
}

async function loadObservationWindow(userId: string) {
  const [first, last] = await Promise.all([
    prisma.problemHistory.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.problemHistory.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    firstObservedAt: first?.createdAt ?? null,
    lastObservedAt: last?.createdAt ?? null,
  };
}

/**
 * Assembles the Evidence Ledger page. Read-only: every tier is projected from
 * stored rows, and the acceptance gate is re-evaluated rather than trusted, so
 * the page cannot show a claim the memory system would now reject.
 */
export async function getEvidenceLedgerData(): Promise<EvidenceLedgerData> {
  const user = await prisma.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });

  const [storedProfile, facts, candidates, episodes, totals, window] =
    await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: user.id } }),
      loadEstablishedFacts(prisma, user.id),
      loadCandidateFacts(prisma, user.id),
      loadEpisodes(user.id),
      loadTotals(user.id),
      loadObservationWindow(user.id),
    ]);

  const strongPatterns = storedProfile
    ? parseStringArray(storedProfile.strongPatterns)
    : [...irisDefaultProfile.strongPatterns];
  const weakPatterns = storedProfile
    ? parseStringArray(storedProfile.weakPatterns)
    : [...irisDefaultProfile.weakPatterns];
  const outputPreferences = storedProfile
    ? parseStringArray(storedProfile.outputPreferences)
    : [...irisDefaultProfile.outputPreferences];
  const preferredLanguages = storedProfile
    ? parseStringArray(storedProfile.preferredLanguages)
    : [...irisDefaultProfile.preferredLanguages];

  return {
    displayName: storedProfile?.displayName ?? irisDefaultProfile.displayName,
    interviewGoal: storedProfile?.interviewGoal ?? null,
    selections: { strongPatterns, weakPatterns, outputPreferences },
    totals,
    ...window,
    slots: await loadSynthesisSlots(prisma, { userId: user.id, facts }),
    facts,
    candidates,
    episodes,
    selfReported: auditSelfReportedPatterns({
      strongPatterns,
      weakPatterns,
      facts,
    }),
    preferences: [...preferredLanguages, ...outputPreferences],
  };
}
