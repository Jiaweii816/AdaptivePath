/**
 * Biology tutor turn at the Coach Agent boundary. It never enters the
 * LeetCode chat loop (no code runner or repair tools): the help level is
 * chosen from L2 by `selectCoachTool`, and only Biology teaching tools exist.
 */
import locations from "@/features/adaptivepath/textbook-locations.json";
import { getConcept } from "@/features/adaptivepath/concepts";
import { toClientQuestion, type BankQuestion } from "@/features/adaptivepath/question-bank";
import { hintStep, selectCoachTool, type BiologyCoachTool } from "@/features/adaptivepath/memory/coach-policy";
import { offlineTutorReply } from "@/features/adaptivepath/memory/offline-hints";
import type { TutorMemoryContext } from "@/features/adaptivepath/memory/tutor-context";
import type { MasteryLevel } from "@/features/adaptivepath/memory/types";
import type { TraceContext } from "@/server/llm/trace-context";
import { LiveTutorError, type LiveTutor } from "@/server/adaptivepath/tutor-provider";

export type BiologyTurnInput = Readonly<{
  question: BankQuestion;
  message: string;
  history: readonly Readonly<{ role: "student" | "tutor"; content: string }>[];
  priorTutorTurns: number;
  memory: TutorMemoryContext;
  levels: readonly (MasteryLevel | null)[];
}>;
export type BiologyTurnResult = Readonly<{ reply: string; provider: "offline_rules" | "live_llm"; tool: BiologyCoachTool }>;

/** Subsection titles only; the textbook text itself is never sent to a model. */
export function subsectionsFor(chunkIds: readonly string[]): string[] {
  const titles = chunkIds.map((id) => {
    const chunk = locations.chunks.find((c) => c.id === id);
    if (!chunk) throw new Error(`Unknown textbook chunk ${id}`);
    return chunk.subsection;
  });
  return [...new Set(titles)];
}

export async function biologyCoachReply(
  input: BiologyTurnInput,
  deps: Readonly<{ live: LiveTutor | null; trace: TraceContext }>,
): Promise<BiologyTurnResult> {
  const tool = selectCoachTool(input.levels);
  const step = hintStep(input.priorTutorTurns);
  const subsections = subsectionsFor(input.question.chunkIds);
  if (!deps.live) {
    const reply = offlineTutorReply({ tool, conceptIds: input.question.conceptIds, hintStep: step, subsections });
    return { reply, provider: "offline_rules", tool };
  }
  const reply = await deps.live.reply({
    question: toClientQuestion(input.question),
    tool,
    hintStep: step,
    memory: input.memory,
    concepts: input.question.conceptIds.map((id) => {
      const concept = getConcept(id);
      return { name: concept.name, learningObjective: concept.learningObjective };
    }),
    subsections,
    history: input.history,
    message: input.message,
  }, deps.trace).catch((error: unknown) => {
    throw new LiveTutorError(error);
  });
  return { reply, provider: "live_llm", tool };
}
