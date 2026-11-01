/**
 * One memory-driven Biology coach turn (spec §5): classify → plan → required tools →
 * bounded tool loop → reply contract → guards → persist. Nothing is stored on failure.
 */
import type OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import { CONCEPTS, getConcept } from "@/features/adaptivepath/concepts";
import { findAnswerLeaks } from "@/features/adaptivepath/coach/answer-leak-guard";
import { diffDraft, draftHash, draftState, type Draft } from "@/features/adaptivepath/coach/draft";
import { BiologyCoachError } from "@/features/adaptivepath/coach/errors";
import type { ClassifiedTurn, CoachPhase, IntentKind } from "@/features/adaptivepath/coach/intents";
import { findMemoryDisclosures, isMemoryDisclosureGuardEnabled } from "@/features/adaptivepath/coach/memory-disclosure-guard";
import type { MemorySignals } from "@/features/adaptivepath/coach/memory-signals";
import { validateCoachReply, type CoachReply } from "@/features/adaptivepath/coach/reply-contract";
import { planTeachingTurn, type TeachingPlan } from "@/features/adaptivepath/coach/teaching-policy";
import type { TutorEvidence } from "@/features/adaptivepath/memory/tutor-context";
import type { BankQuestion } from "@/features/adaptivepath/question-bank";
import { appendTutorExchange, loadCoachThread, recordAccess, type AssistantMeta, type CoachThread } from "@/server/adaptivepath/activity-store";
import type { LearnerMemory, LearnerScope } from "@/server/adaptivepath/memory-store";
import { appendTraceEventBestEffort, type TraceContext } from "@/server/llm/trace-context";
import { buildCoachContext } from "./coach-prompt";
import { diagnoseReasoning, type Diagnosis } from "./diagnoser";
import { classifyBiologyTurn } from "./intent-classifier";
import type { LlmNodeDeps } from "./llm-node";
import { runBiologyToolLoop, type LoopResult, type ToolUse } from "./tool-loop";

type Env = Readonly<Record<string, string | undefined>>;
type TraceKind = "memory" | "guard" | "tool" | "lifecycle";
type DiagnosisCache = NonNullable<AssistantMeta["diagnosisCache"]>;
export type BiologyCoachLlm = Readonly<{ client: OpenAI; model: string }>;
export type CoachTarget = Readonly<{ phase: CoachPhase; question: BankQuestion; attempt: TutorEvidence | null }>;
export type CoachTurnDeps = Readonly<{ db: PrismaClient; llm: BiologyCoachLlm; trace: TraceContext; env?: Env }>;
export type CoachTurnRequest = Readonly<{
  scope: LearnerScope; target: CoachTarget; memory: LearnerMemory; signals: MemorySignals;
  pickReason: string | null; message: string; draft: Draft | null;
}>;
export type CoachTurnOutcome = Readonly<{
  reply: string; intents: IntentKind[]; policyId: string; tools: readonly ToolUse[];
  citedChunkIds: readonly string[]; quotedSpans: readonly string[]; stopReason: LoopResult["stopReason"];
}>;
type TurnState = Readonly<{ deps: CoachTurnDeps; request: CoachTurnRequest; llmDeps: LlmNodeDeps; thread: CoachThread }>;

const HINT_INTENTS: ReadonlySet<string> = new Set(["question_hint", "request_answer"]);

async function traceEvent(trace: TraceContext, event: Readonly<{ stage: string; kind: TraceKind; metadata: Record<string, unknown>; failed?: boolean }>) {
  await appendTraceEventBestEffort(trace, {
    stage: event.stage, kind: event.kind, title: `Biology ${event.stage}`, status: event.failed ? "failed" : "succeeded", details: { metadata: event.metadata },
  });
}

function previousDraft(thread: CoachThread): Draft | null {
  const snapshot = [...thread.userMetas].reverse().find((m) => m.draftSnapshot)?.draftSnapshot;
  return snapshot ? { selectedOption: snapshot.selectedOption, reasoning: snapshot.reasoning } : null;
}

function signalMetadata(signals: MemorySignals) {
  return {
    focusConceptId: signals.focusConceptId, prerequisiteGap: signals.prerequisiteGap, anchor: signals.anchor,
    reliesOnTutor: signals.reliesOnTutor, pastMissEventIds: signals.pastMisses.map((m) => m.l1EventId),
  };
}

/** Reuses the diagnosis stored for an identical draft; otherwise runs the diagnoser once. */
function diagnosisRunner(state: TurnState) {
  let used: DiagnosisCache | null = null;
  const run = async (): Promise<Diagnosis["forCoach"]> => {
    const { request, thread, deps } = state;
    if (!request.draft) throw new Error("diagnose_reasoning needs the student's draft");
    const hash = draftHash(request.target.question.id, request.draft);
    const cached = [...thread.assistantMetas].reverse().find((m) => m.diagnosisCache?.hash === hash)?.diagnosisCache;
    const fresh = cached ? null : await diagnoseReasoning(state.llmDeps, { question: request.target.question, draft: request.draft, pastMisses: request.signals.pastMisses });
    used = cached ?? { hash, ...fresh!.forCoach };
    await traceEvent(deps.trace, { stage: "biology_diagnosis", kind: "tool", metadata: { hash, cached: Boolean(cached), internal: fresh?.internal ?? null } });
    return { probeStep: used.probeStep, studentSpan: used.studentSpan };
  };
  return { run, used: () => used };
}

async function classifyAndPlan(state: TurnState): Promise<{ turn: ClassifiedTurn; plan: TeachingPlan }> {
  const { request, thread, llmDeps } = state;
  const turn = await classifyBiologyTurn(llmDeps, {
    phase: request.target.phase, message: request.message, history: thread.messages, draft: request.draft,
    conceptNames: request.target.question.conceptIds.map((id) => getConcept(id).name),
  });
  const plan = planTeachingTurn({
    turn, phase: request.target.phase, signals: request.signals, draftState: draftState(request.draft),
    priorHintTurns: thread.userMetas.filter((m) => m.intents?.some((k) => HINT_INTENTS.has(k))).length,
    firstTurnOnQuestion: thread.messages.length === 0,
  });
  await traceEvent(state.deps.trace, { stage: "biology_memory_signals", kind: "memory", metadata: signalMetadata(request.signals) });
  await traceEvent(state.deps.trace, { stage: "biology_teaching_plan", kind: "lifecycle", metadata: { intents: turn.intents, affect: turn.affect, plan } });
  return { turn, plan };
}

/** In review the "draft" the coach may quote is the submitted reasoning. */
function quotableReasoning(target: CoachTarget, draft: Draft | null): string {
  return target.phase === "submitted_attempt" ? target.attempt?.explanation ?? "" : draft?.reasoning ?? "";
}

async function runGuards(state: TurnState, reply: CoachReply) {
  const { request, deps } = state;
  const { question, phase } = request.target;
  const answerLeaks = phase === "current_question"
    ? findAnswerLeaks(reply.reply, { correctOption: question.correctAnswer, options: question.options, quotedSpans: reply.quotedSpans })
    : [];
  const disclosureGuardEnabled = isMemoryDisclosureGuardEnabled(deps.env ?? process.env);
  const memoryDisclosures = disclosureGuardEnabled
    ? findMemoryDisclosures(reply.reply, { pastExcerpts: request.signals.pastMisses.map((m) => m.reasoningExcerpt), quotedSpans: reply.quotedSpans })
    : [];
  const failed = answerLeaks.length > 0 || memoryDisclosures.length > 0;
  await traceEvent(deps.trace, { stage: "biology_guard", kind: "guard", failed, metadata: { phase, answerLeaks, memoryDisclosures, disclosureGuardEnabled } });
  if (answerLeaks.length) throw new BiologyCoachError("answer_leak", "guard", "The coach reply contained answer information and was blocked. Please ask again.", { details: { answerLeaks } });
  if (memoryDisclosures.length) throw new BiologyCoachError("memory_disclosure", "guard", "The coach reply revealed stored learner records and was blocked. Please ask again.", { details: { memoryDisclosures } });
}

async function persist(state: TurnState, outcome: Readonly<{ turn: ClassifiedTurn; plan: TeachingPlan; loop: LoopResult; reply: CoachReply; diagnosis: DiagnosisCache | null }>) {
  const { request, deps } = state;
  const { scope, target, draft } = request;
  await appendTutorExchange(deps.db, {
    scope, questionId: target.question.id, phase: target.phase, userText: request.message, reply: outcome.reply.reply,
    userMeta: {
      attemptId: target.attempt?.attemptId, intents: outcome.turn.intents.map((i) => i.kind), affect: outcome.turn.affect,
      draftSnapshot: draft ? { ...draft, hash: draftHash(target.question.id, draft) } : undefined,
    },
    assistantMeta: {
      policyId: outcome.plan.policyId, hintStep: outcome.plan.hintStep, tools: [...outcome.loop.tools],
      citedChunkIds: outcome.reply.citedChunkIds, quotedSpans: outcome.reply.quotedSpans, memorySignals: signalMetadata(request.signals),
      diagnosisCache: outcome.diagnosis ?? undefined, traceRunId: deps.trace.traceRunId,
    },
  });
  if (target.phase === "current_question") await recordAccess(deps.db, { scope, questionId: target.question.id, kind: "biology_guided_assistance" });
}

export async function runBiologyCoachTurn(deps: CoachTurnDeps, request: CoachTurnRequest): Promise<CoachTurnOutcome> {
  const thread = await loadCoachThread(deps.db, { scope: request.scope, questionId: request.target.question.id, phase: request.target.phase });
  const state: TurnState = { deps, request, thread, llmDeps: { client: deps.llm.client, model: deps.llm.model, trace: deps.trace } };
  const { turn, plan } = await classifyAndPlan(state);
  const diagnosis = diagnosisRunner(state);
  const draftDiff = request.draft ? diffDraft(previousDraft(thread), request.draft) : null;
  const context = buildCoachContext({ question: request.target.question, phase: request.target.phase, plan, draft: request.draft, draftDiff, pickReason: request.pickReason, concepts: CONCEPTS });
  const loop = await runBiologyToolLoop(state.llmDeps, {
    context, history: thread.messages, message: request.message, plan,
    toolCtx: { phase: request.target.phase, question: request.target.question, draft: request.draft, attempt: request.target.attempt, signals: request.signals, memory: request.memory, diagnose: diagnosis.run, trace: deps.trace },
  });
  const reply = validateCoachReply(loop.raw, { retrievedChunkIds: loop.retrievedChunkIds, reasoning: quotableReasoning(request.target, request.draft), requireCitation: plan.requireCitation });
  await runGuards(state, reply);
  await persist(state, { turn, plan, loop, reply, diagnosis: diagnosis.used() });
  return {
    reply: reply.reply, intents: turn.intents.map((i) => i.kind), policyId: plan.policyId, tools: loop.tools,
    citedChunkIds: reply.citedChunkIds, quotedSpans: reply.quotedSpans, stopReason: loop.stopReason,
  };
}
