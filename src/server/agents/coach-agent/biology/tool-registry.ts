/**
 * Biology coach tools (spec §8). All read-only. Outputs never carry levels,
 * stability or record ids; only get_attempt_review (review phase) carries the key.
 */
import { z } from "zod";
import { CONCEPTS, getConcept } from "@/features/adaptivepath/concepts";
import type { CoachPhase } from "@/features/adaptivepath/coach/intents";
import type { Draft } from "@/features/adaptivepath/coach/draft";
import type { MemorySignals } from "@/features/adaptivepath/coach/memory-signals";
import type { DraftState, ToolName } from "@/features/adaptivepath/coach/teaching-policy";
import { getPassages, searchTextbook } from "@/features/adaptivepath/coach/textbook";
import { describeLevel } from "@/features/adaptivepath/coach/wording";
import { buildTutorMemoryContext, type TutorEvidence } from "@/features/adaptivepath/memory/tutor-context";
import type { BankQuestion } from "@/features/adaptivepath/question-bank";
import type { LearnerMemory } from "@/server/adaptivepath/memory-store";
import { appendTraceEventBestEffort, type TraceContext } from "@/server/llm/trace-context";
import type { Diagnosis } from "./diagnoser";

export const DEFAULT_TOOL_CALLS_PER_TURN = 2;
const SINGLE_CALL = 1;
const CONCEPT_IDS = CONCEPTS.map((c) => c.id) as [string, ...string[]];

export type ToolContext = Readonly<{
  phase: CoachPhase;
  question: BankQuestion;
  draft: Draft | null;
  attempt: TutorEvidence | null;
  signals: MemorySignals;
  memory: LearnerMemory;
  /** Fresh or cached; only the coach-safe part of a diagnosis ever reaches a tool result. */
  diagnose: () => Promise<Diagnosis["forCoach"]>;
  trace: TraceContext;
}>;
export type ToolResult = Readonly<{ content: unknown; chunkIds: readonly string[] }>;
export type ToolSpec = Readonly<{
  name: ToolName;
  description: string;
  riskClass: "internal_read" | "personal_read";
  costUnits: number;
  maxCallsPerTurn: number;
  inputSchema: z.ZodType;
  run(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}>;

const emptyArgs = z.object({}).strict();
const nameOf = (id: string) => getConcept(id).name;

async function traceRetrieval(ctx: ToolContext, stage: string, metadata: Record<string, unknown>) {
  await appendTraceEventBestEffort(ctx.trace, { stage, kind: "retrieval", title: `Biology ${stage}`, status: "succeeded", details: { metadata } });
}

const searchArgs = z.object({ query: z.string().trim().min(1), conceptIds: z.array(z.enum(CONCEPT_IDS)).min(1).optional() }).strict();

async function searchTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = searchArgs.parse(args);
  const conceptIds = input.conceptIds ?? ctx.question.conceptIds;
  const hits = searchTextbook({ query: input.query, conceptIds });
  await traceRetrieval(ctx, "biology_textbook_search", { tool: "search_textbook", query: input.query, conceptIds, hits: hits.map((h) => ({ chunkId: h.chunkId, score: h.score })) });
  return { content: getPassages(hits.map((h) => h.chunkId)), chunkIds: hits.map((h) => h.chunkId) };
}

async function evidenceTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  emptyArgs.parse(args);
  const passages = getPassages(ctx.question.chunkIds);
  await traceRetrieval(ctx, "biology_textbook_search", { tool: "get_question_evidence", chunkIds: ctx.question.chunkIds });
  return { content: passages, chunkIds: passages.map((p) => p.chunkId) };
}

async function conceptCardTool(args: unknown): Promise<ToolResult> {
  const { conceptId } = z.object({ conceptId: z.enum(CONCEPT_IDS) }).strict().parse(args);
  const concept = getConcept(conceptId);
  return {
    content: { name: concept.name, nameZh: concept.nameZh, learningObjective: concept.learningObjective, prerequisites: concept.prerequisiteIds.map(nameOf) },
    chunkIds: [],
  };
}

async function learnerStatusTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  emptyArgs.parse(args);
  const recalled = buildTutorMemoryContext({ questionConceptIds: ctx.question.conceptIds, states: ctx.memory.states, attempts: ctx.memory.attempts, concepts: CONCEPTS });
  const card = ctx.memory.latestProfile?.card;
  await traceRetrieval(ctx, "biology_learner_status", { judgmentConceptIds: recalled.judgments.map((j) => j.conceptId), profileVersion: ctx.memory.latestProfile?.version ?? null });
  return {
    content: {
      relevant: recalled.judgments.map((j) => ({ concept: nameOf(j.conceptId), status: describeLevel(j.level) })),
      strengths: (card?.strengths ?? []).map(nameOf),
      needsPractice: (card?.gaps ?? []).map(nameOf),
      foundationsToRevisit: (card?.prerequisiteGaps ?? []).map((g) => ({ concept: nameOf(g.conceptId), foundation: nameOf(g.prerequisiteId) })),
    },
    chunkIds: [],
  };
}

async function diagnoseTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  emptyArgs.parse(args);
  return { content: await ctx.diagnose(), chunkIds: [] };
}

async function attemptReviewTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  emptyArgs.parse(args);
  if (ctx.phase !== "submitted_attempt" || !ctx.attempt) throw new Error("get_attempt_review is only available when reviewing a submitted attempt");
  const { question, attempt } = ctx;
  return {
    content: {
      submitted: { selectedOption: attempt.selectedOption, reasoning: attempt.explanation },
      correctOption: question.correctAnswer,
      explanation: question.explanation,
      optionExplanations: { selected: question.optionExplanations[attempt.selectedOption], correct: question.optionExplanations[question.correctAnswer] },
    },
    chunkIds: [],
  };
}

const spec = (s: Omit<ToolSpec, "costUnits" | "maxCallsPerTurn"> & Partial<Pick<ToolSpec, "costUnits" | "maxCallsPerTurn">>): ToolSpec =>
  ({ costUnits: 1, maxCallsPerTurn: DEFAULT_TOOL_CALLS_PER_TURN, ...s });

export const BIOLOGY_TOOL_REGISTRY: Readonly<Record<ToolName, ToolSpec>> = Object.freeze({
  search_textbook: spec({ name: "search_textbook", description: "Search the §12.2 textbook. Defaults to this question's concepts.", riskClass: "internal_read", inputSchema: searchArgs, run: searchTool }),
  get_question_evidence: spec({ name: "get_question_evidence", description: "Textbook passages this question is grounded in.", riskClass: "internal_read", inputSchema: emptyArgs, run: evidenceTool }),
  get_concept_card: spec({ name: "get_concept_card", description: "A concept's name, learning objective and prerequisites.", riskClass: "internal_read", inputSchema: z.object({ conceptId: z.enum(CONCEPT_IDS) }).strict(), run: conceptCardTool }),
  get_learner_status: spec({ name: "get_learner_status", description: "Qualitative view of what the student finds solid or shaky.", riskClass: "personal_read", inputSchema: emptyArgs, run: learnerStatusTool }),
  diagnose_reasoning: spec({ name: "diagnose_reasoning", description: "Which step of the student's current work to probe.", riskClass: "internal_read", costUnits: 2, maxCallsPerTurn: SINGLE_CALL, inputSchema: emptyArgs, run: diagnoseTool }),
  get_attempt_review: spec({ name: "get_attempt_review", description: "The submitted answer, its key and explanations (review only).", riskClass: "internal_read", maxCallsPerTurn: SINGLE_CALL, inputSchema: emptyArgs, run: attemptReviewTool }),
});

export function visibleTools(phase: CoachPhase, state: DraftState): ToolName[] {
  return (Object.keys(BIOLOGY_TOOL_REGISTRY) as ToolName[]).filter((name) => {
    if (name === "diagnose_reasoning") return phase === "current_question" && state !== "empty";
    if (name === "get_attempt_review") return phase === "submitted_attempt";
    return true;
  });
}
