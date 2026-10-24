import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { CoachMemoryAssembly } from "@/server/memory";
import {
  sessionPlanSchema,
  type SessionPlan,
} from "@/server/memory/memory.types";

type EnsurePlanPrisma = Pick<PrismaClient, "chatSession">;

export function buildSessionPlan(
  memoryAssembly: CoachMemoryAssembly,
  now: Date = new Date(),
): SessionPlan {
  const selectedIds = memoryAssembly.decisions
    .filter((decision) => decision.selected)
    .map((decision) => decision.candidateId);
  const candidateById = new Map(
    memoryAssembly.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const teachableSelectedIds = selectedIds.filter(
    (candidateId) => candidateById.get(candidateId)?.role !== "domain_reference",
  );
  const focusCues = memoryAssembly.brief.teachableMemories.map(
    (memory, index) => ({
      candidateRef: teachableSelectedIds[index] ?? `brief:${index}`,
      cue: memory.cue,
      sourceLabel: memory.sourceLabel,
      learnerSignalBasis: memory.learnerSignalBasis,
    }),
  );
  const strategy = memoryAssembly.brief.teachingStrategy;
  const strategyCandidate = strategy
    ? memoryAssembly.candidates.find(
        (candidate) =>
          candidate.role === "learning_preference" &&
          candidate.teachingText === strategy,
      )
    : undefined;
  const strategies = strategy
    ? [
        {
          tag: `strategy_${hashText(strategy)}`,
          text: strategy,
          status: "validated" as const,
          candidateRef: strategyCandidate?.id,
        },
      ]
    : [];
  const candidateRefs = focusCues.map((cue) => cue.candidateRef);
  const openingText = focusCues[0]
    ? `Start by connecting the current task to this selected learner cue: ${focusCues[0].cue}`
    : "Start from the current problem's input/output contract and ask the learner to state one invariant.";

  return sessionPlanSchema.parse({
    candidateFingerprint: memoryAssembly.candidateFingerprint,
    focusCues,
    strategies,
    openingMove: { text: openingText, candidateRefs },
    builtAt: now.toISOString(),
  });
}

export async function ensureSessionPlan(
  prisma: EnsurePlanPrisma,
  args: {
    chatSession: { id: string; sessionPlanJson: string | null };
    memoryAssembly: CoachMemoryAssembly;
  },
): Promise<SessionPlan> {
  const existing = parseSessionPlan(args.chatSession.sessionPlanJson);
  if (
    existing?.candidateFingerprint ===
    args.memoryAssembly.candidateFingerprint
  ) {
    return existing;
  }

  const plan = buildSessionPlan(args.memoryAssembly);
  await prisma.chatSession.update({
    where: { id: args.chatSession.id },
    data: { sessionPlanJson: JSON.stringify(plan) },
  });
  return plan;
}

function parseSessionPlan(value: string | null): SessionPlan | undefined {
  if (!value) return undefined;
  try {
    const parsed = sessionPlanSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
