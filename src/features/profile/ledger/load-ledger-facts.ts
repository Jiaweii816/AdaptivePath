import type { PrismaClient } from "@prisma/client";
import { readLearnerClaimSemantics } from "@/server/memory/claims/learner-claim-semantics";
import {
  isBlockedDurableFactTag,
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import {
  factDisplayGroup,
  factMechanismKey,
  readLadder,
} from "./fact-display";
import type {
  LedgerCandidate,
  LedgerEvidenceRow,
  LedgerFact,
} from "./ledger-types";

type FactPrisma = Pick<
  PrismaClient,
  "l2MemoryFact" | "memoryEvidenceContribution"
>;

/** Statuses that represent an established fact rather than a single sighting. */
const ESTABLISHED_STATUSES = ["active", "improving", "validated"];
const VERIFIED_AUTHORITY = "verified";
const MAX_ESTABLISHED_FACTS = 200;
const MAX_CANDIDATES = 40;

type FactRow = Awaited<
  ReturnType<FactPrisma["l2MemoryFact"]["findMany"]>
>[number] & { problem?: { title: string } | null };

async function loadEvidenceByFactId(
  prisma: FactPrisma,
  factIds: string[],
): Promise<Map<string, LedgerEvidenceRow[]>> {
  const byFactId = new Map<string, LedgerEvidenceRow[]>();
  if (factIds.length === 0) return byFactId;

  const rows = await prisma.memoryEvidenceContribution.findMany({
    where: { targetClusterFactId: { in: factIds } },
    include: { problem: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });

  for (const row of rows) {
    const bucket = byFactId.get(row.targetClusterFactId) ?? [];
    bucket.push({
      role: row.evidenceRole,
      authority: row.authority,
      problemTitle: row.problem?.title ?? null,
      reviewAttemptId: row.reviewAttemptId,
      observedAt: row.createdAt,
    });
    byFactId.set(row.targetClusterFactId, bucket);
  }

  return byFactId;
}

export function toLedgerFact(
  row: FactRow,
  evidence: LedgerEvidenceRow[],
): LedgerFact {
  const semantics = readLearnerClaimSemantics(row);
  const distinctProblems = new Set(
    evidence.flatMap((item) => (item.problemTitle ? [item.problemTitle] : [])),
  );

  return {
    id: row.id,
    factType: row.factType,
    mechanismKey: factMechanismKey(row),
    statement: semantics.statement,
    polarity: semantics.polarity,
    group: factDisplayGroup(row),
    confidence: row.confidence,
    evidenceCount: row.evidenceCount,
    lastSeenAt: row.lastSeenAt,
    ladder: readLadder(row.evidenceCount),
    evidence,
    verifiedCount: evidence.filter(
      (item) => item.authority === VERIFIED_AUTHORITY,
    ).length,
    distinctProblemCount: distinctProblems.size,
    untraceableCount: Math.max(row.evidenceCount - evidence.length, 0),
  };
}

/**
 * Established learner facts, newest first, each carrying the contribution rows
 * that can actually be traced. Facts whose stored `evidenceCount` exceeds the
 * traceable rows keep both numbers so the gap stays visible.
 */
export async function loadEstablishedFacts(
  prisma: FactPrisma,
  userId: string,
): Promise<LedgerFact[]> {
  const rows = await prisma.l2MemoryFact.findMany({
    where: {
      userId,
      memoryOrigin: "learner",
      status: { in: ESTABLISHED_STATUSES },
    },
    include: { problem: { select: { title: true } } },
    orderBy: [{ lastSeenAt: "desc" }, { evidenceCount: "desc" }],
    take: MAX_ESTABLISHED_FACTS,
  });

  const trusted = rows.filter(isTrustedL2FactForConsumption);
  const evidenceByFactId = await loadEvidenceByFactId(
    prisma,
    trusted.map((row) => row.id),
  );

  return trusted.map((row) =>
    toLedgerFact(row, evidenceByFactId.get(row.id) ?? []),
  );
}

/**
 * Display gate for a pending candidate.
 *
 * `isTrustedL2FactForConsumption` deliberately rejects candidates: it certifies
 * a fact as established truth, which requires `promotionStatus: "trusted"`.
 * A candidate is `pending` by definition, so reusing that gate would empty the
 * band entirely. Candidates still must be learner-origin, carry a readable
 * integrity envelope, and avoid blocked internal tags — they are simply shown
 * as not-yet-established rather than as facts.
 */
export function isDisplayableCandidateFact(fact: {
  tag: string;
  status: string;
  memoryOrigin?: string | null;
  validationJson?: string | null;
}) {
  if (isBlockedDurableFactTag(fact.tag)) return false;
  if (fact.memoryOrigin !== "learner") return false;
  if (fact.status !== "candidate") return false;
  return readDurableFactIntegrity(fact.validationJson)?.promotionStatus === "pending";
}

/**
 * Candidate facts: seen once, awaiting a second independent sighting to promote.
 * They carry no evidence table because a single contribution is the whole story.
 */
export async function loadCandidateFacts(
  prisma: FactPrisma,
  userId: string,
): Promise<LedgerCandidate[]> {
  const rows = await prisma.l2MemoryFact.findMany({
    where: { userId, memoryOrigin: "learner", status: "candidate" },
    include: { problem: { select: { title: true } } },
    orderBy: { lastSeenAt: "desc" },
    take: MAX_CANDIDATES,
  });

  return rows.filter(isDisplayableCandidateFact).map((row) => ({
    id: row.id,
    factType: row.factType,
    statement: readLearnerClaimSemantics(row).statement,
    problemTitle: row.problem?.title ?? null,
    lastSeenAt: row.lastSeenAt,
  }));
}
