/**
 * Biology read side of the learner-memory facade: loads L1/L2/L3 for one coach
 * turn, derives the background memory signals and records the recall as a retrieval trace.
 */
import type { PrismaClient } from "@prisma/client";
import { CONCEPTS } from "@/features/adaptivepath/concepts";
import { getBankQuestion, type BankQuestion } from "@/features/adaptivepath/question-bank";
import { deriveMemorySignals, type MemorySignals } from "@/features/adaptivepath/coach/memory-signals";
import { loadLearnerMemory, type LearnerMemory, type LearnerScope } from "@/server/adaptivepath/memory-store";
import { appendTraceEventBestEffort, type TraceContext } from "@/server/llm/trace-context";

export async function recallBiologyCoachMemory(
  db: PrismaClient,
  input: Readonly<{ scope: LearnerScope; question: BankQuestion; trace: TraceContext }>,
): Promise<{ memory: LearnerMemory; signals: MemorySignals }> {
  const startedAt = Date.now();
  const memory = await loadLearnerMemory(db, input.scope);
  const signals = deriveMemorySignals({
    question: input.question, states: memory.states, card: memory.latestProfile?.card ?? null,
    attempts: memory.attempts, concepts: CONCEPTS, lookupQuestion: getBankQuestion,
  });
  const judgmentConceptIds = [signals.focusConceptId, signals.prerequisiteGap, signals.anchor].filter((id): id is string => id !== null && memory.states.has(id));
  await appendTraceEventBestEffort(input.trace, {
    stage: "biology_l2_recall",
    kind: "retrieval",
    title: "Biology learner memory recall",
    status: "succeeded",
    durationMs: Date.now() - startedAt,
    details: {
      metadata: {
        questionId: input.question.id,
        judgmentConceptIds,
        pastMissEventIds: signals.pastMisses.map((m) => m.l1EventId),
        profileVersion: memory.latestProfile?.version ?? null,
      },
    },
  });
  return { memory, signals };
}
