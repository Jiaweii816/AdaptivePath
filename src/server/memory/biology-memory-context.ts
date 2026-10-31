/**
 * Biology read side of the learner-memory facade: recalls the bounded L2/L1
 * context for one tutor turn and records the recall as a retrieval trace.
 */
import type { PrismaClient } from "@prisma/client";
import { CONCEPTS } from "@/features/adaptivepath/concepts";
import type { BankQuestion } from "@/features/adaptivepath/question-bank";
import { buildTutorMemoryContext, type TutorMemoryContext } from "@/features/adaptivepath/memory/tutor-context";
import type { MasteryLevel } from "@/features/adaptivepath/memory/types";
import { loadLearnerMemory, type LearnerScope } from "@/server/adaptivepath/memory-store";
import { appendTraceEventBestEffort, type TraceContext } from "@/server/llm/trace-context";

export async function recallBiologyTutorMemory(
  db: PrismaClient,
  input: Readonly<{ scope: LearnerScope; question: BankQuestion; trace: TraceContext }>,
): Promise<{ memory: TutorMemoryContext; levels: readonly (MasteryLevel | null)[] }> {
  const startedAt = Date.now();
  const stored = await loadLearnerMemory(db, input.scope);
  const memory = buildTutorMemoryContext({
    questionConceptIds: input.question.conceptIds,
    states: stored.states,
    attempts: stored.attempts,
    concepts: CONCEPTS,
  });
  const levels = input.question.conceptIds.map((id) => stored.states.get(id)?.level ?? null);
  await appendTraceEventBestEffort(input.trace, {
    stage: "biology_l2_recall",
    kind: "retrieval",
    title: "Biology L2 recall",
    status: "succeeded",
    durationMs: Date.now() - startedAt,
    details: {
      metadata: {
        questionId: input.question.id,
        judgmentConceptIds: memory.judgments.map((j) => j.conceptId),
        evidenceQuestionIds: memory.evidence.map((e) => e.questionId),
      },
    },
  });
  return { memory, levels };
}
