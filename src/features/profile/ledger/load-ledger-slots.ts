import type { PrismaClient } from "@prisma/client";
import { isTrustedL2FactForConsumption } from "@/server/memory/integrity/memory-integrity-policy";
import { safeStoredMemoryTeachingText } from "@/server/memory/store/episode-store";
import { evaluateSynthesisEvidenceFacts } from "@/server/memory/store/synthesis-store";
import { toLedgerFact } from "./load-ledger-facts";
import type { LedgerFact, LedgerSynthesisSlot } from "./ledger-types";

type SlotPrisma = Pick<
  PrismaClient,
  "synthesisSlot" | "l2MemoryFact" | "memoryEvidenceContribution"
>;

const MAX_SLOTS = 40;

function parseFactIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Active synthesis slots with the values the acceptance gate actually checks:
 * the count of unique evidence clusters and distinct problems across the union
 * of every cited fact. The gate is re-evaluated here through the same function
 * the writer uses, so a slot that lost its evidence disappears from the page
 * instead of lingering as an unsupported claim.
 *
 * The stored confidence is carried through as a model proposal. Nothing
 * recomputes it, so callers must not present it as a measured score.
 */
export async function loadSynthesisSlots(
  prisma: SlotPrisma,
  args: { userId: string; facts: LedgerFact[] },
): Promise<LedgerSynthesisSlot[]> {
  const rows = await prisma.synthesisSlot.findMany({
    where: { userId: args.userId, status: "active", memoryOrigin: "learner" },
    orderBy: { updatedAt: "desc" },
    take: MAX_SLOTS,
  });

  const factsById = new Map(args.facts.map((fact) => [fact.id, fact]));
  const slots: LedgerSynthesisSlot[] = [];

  for (const row of rows) {
    const text = safeStoredMemoryTeachingText(row.text);
    if (!text) continue;

    const citedIds = parseFactIds(row.evidenceFactIds);
    const citedRows = await prisma.l2MemoryFact.findMany({
      where: { id: { in: citedIds }, userId: args.userId },
    });
    const trusted = citedRows.filter(isTrustedL2FactForConsumption);
    if (trusted.length !== citedIds.length) continue;

    const decision = evaluateSynthesisEvidenceFacts(trusted);
    if (!decision.eligible) continue;

    slots.push({
      id: row.id,
      slot: row.slot,
      polarity: decision.polarity,
      text,
      proposedConfidence: row.confidence,
      clusterCount: decision.evidenceClusterIds.length,
      problemCount: decision.distinctProblemIds.length,
      updatedAt: row.updatedAt,
      facts: await resolveCitedFacts(prisma, {
        userId: args.userId,
        citedRows: trusted,
        factsById,
      }),
    });
  }

  return slots;
}

/**
 * Reuses the already-loaded established facts when possible so the drill-down
 * shows the same row the L2 tier shows. A cited fact outside that window (for
 * example a demoted status) is hydrated on demand rather than dropped.
 */
async function resolveCitedFacts(
  prisma: Pick<SlotPrisma, "memoryEvidenceContribution">,
  args: {
    userId: string;
    citedRows: Array<Parameters<typeof toLedgerFact>[0]>;
    factsById: Map<string, LedgerFact>;
  },
): Promise<LedgerFact[]> {
  const missing = args.citedRows.filter((row) => !args.factsById.has(row.id));
  const evidenceByFactId = new Map<string, Awaited<ReturnType<typeof loadRows>>>();

  async function loadRows(factId: string) {
    const rows = await prisma.memoryEvidenceContribution.findMany({
      where: { targetClusterFactId: factId },
      include: { problem: { select: { title: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      role: row.evidenceRole,
      authority: row.authority,
      problemTitle: row.problem?.title ?? null,
      reviewAttemptId: row.reviewAttemptId,
      observedAt: row.createdAt,
    }));
  }

  for (const row of missing) {
    evidenceByFactId.set(row.id, await loadRows(row.id));
  }

  return args.citedRows.map(
    (row) =>
      args.factsById.get(row.id) ??
      toLedgerFact(row, evidenceByFactId.get(row.id) ?? []),
  );
}
