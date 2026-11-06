/**
 * Biology practice orchestration: current question from L2, answer
 * submission into L1→L2→L3, help-usage recording, and tutor turns.
 */
import type { PrismaClient } from "@prisma/client";
import { CONCEPTS, type Concept } from "@/features/adaptivepath/concepts";
import {
  getBankQuestion, isCorrectOption, listQuestions, QUESTION_LOOKUP, toClientQuestion,
  type BankQuestion, type ClientQuestion,
} from "@/features/adaptivepath/question-bank";
import { attemptCondition } from "@/features/adaptivepath/memory/mastery-engine";
import { pickNextQuestion, type PickResult } from "@/features/adaptivepath/memory/question-picker";
import { ACTIVE_RULE_VERSION, getRuleset } from "@/features/adaptivepath/memory/rules";
import type { JudgmentState, LedgerRow, MasteryContext } from "@/features/adaptivepath/memory/types";
import type { Draft } from "@/features/adaptivepath/coach/draft";
import { BiologyCoachError } from "@/features/adaptivepath/coach/errors";
import type { IntentKind } from "@/features/adaptivepath/coach/intents";
import { getPassages, isKnownChunk, type TextbookPassage } from "@/features/adaptivepath/coach/textbook";
import { describePickReason } from "@/features/adaptivepath/coach/wording";
import type { PromptId } from "@/features/adaptivepath/practice/suggested-prompts";
import { biologyOfflineReply } from "@/server/agents/coach-agent/biology-chat-reply";
import { runBiologyCoachTurn, type BiologyCoachLlm, type CoachTarget } from "@/server/agents/coach-agent/biology/turn";
import type { ToolUse } from "@/server/agents/coach-agent/biology/tool-loop";
import { appendTraceEventBestEffort, createTraceContext, type TraceContext } from "@/server/llm/trace-context";
import { recallBiologyCoachMemory } from "@/server/memory/biology-memory-context";
import { finalizeTraceRun, markTraceRunDegradedBestEffort } from "@/server/observability/trace-store";
import { appendTutorExchange, loadCoachThread, loadQuestionActivity, recordAccess, type QuestionActivity, type TutorMessage } from "./activity-store";
import { resolveBiologyLearner } from "./learner";
import { loadLearnerMemory, recordAttempt, type LatestProfile, type LearnerMemory, type LearnerScope } from "./memory-store";
import type { StoredLedgerRow } from "./memory-records";
import { loadOnboardingMetadata } from "./onboarding-store";

export type BiologyDeps = Readonly<{ db: PrismaClient; coach: BiologyCoachLlm | null; env?: Readonly<Record<string, string | undefined>> }>;
export type CoachFocus = Readonly<{ kind: "current_question"; questionId: string }> | Readonly<{ kind: "submitted_attempt"; attemptId: string }>;
export type CoachTurnResponse = Readonly<{
  provider: "offline_rules" | "live_llm"; focus: CoachFocus; reply: string; intents: readonly IntentKind[]; policyId: string;
  tools: readonly ToolUse[]; citedChunkIds: readonly string[]; quotedSpans: readonly string[]; stopReason: "tool_budget" | null;
  review: Readonly<{ question: ClientQuestion; messages: readonly TutorMessage[] }> | null;
}>;
export type BiologyView = Readonly<{
  question: ClientQuestion | null;
  pick: PickResult;
  activity: QuestionActivity;
  judgments: readonly JudgmentState[];
  modelReady: boolean;
}>;
export type SubmitFeedback = Readonly<{ correct: boolean; correctAnswer: string; explanation: string; changes: readonly LedgerRow[] }>;
type Current = Readonly<{ scope: LearnerScope; memory: LearnerMemory; pick: PickResult; question: BankQuestion | null }>;

const NO_ACTIVITY: QuestionActivity = { tutorUsed: false, referenceUsed: false, messages: [] };
const masteryContext = (): MasteryContext => ({ rules: getRuleset(ACTIVE_RULE_VERSION), lookup: QUESTION_LOOKUP });

async function loadCurrent(deps: BiologyDeps): Promise<Current> {
  const scope = await resolveBiologyLearner(deps.db, deps.env);
  const memory = await loadLearnerMemory(deps.db, scope);
  const pick = pickNextQuestion({
    states: memory.states,
    attemptedQuestionIds: new Set(memory.attempts.map((a) => a.questionId)),
    concepts: CONCEPTS,
    questions: listQuestions(),
    rules: masteryContext().rules,
  });
  return { scope, memory, pick, question: pick.kind === "question" ? getBankQuestion(pick.questionId) : null };
}

function requireCurrent(current: Current, questionId: string): BankQuestion {
  if (!current.question || current.question.id !== questionId) throw new Error("This is not the current activity");
  return current.question;
}

async function toView(deps: BiologyDeps, current: Current): Promise<BiologyView> {
  const activity = current.question
    ? await loadQuestionActivity(deps.db, { scope: current.scope, questionId: current.question.id })
    : NO_ACTIVITY;
  return {
    question: current.question && toClientQuestion(current.question),
    pick: current.pick,
    activity,
    judgments: [...current.memory.states.values()],
    modelReady: deps.coach !== null,
  };
}

export async function loadBiologyView(deps: BiologyDeps): Promise<BiologyView> {
  return toView(deps, await loadCurrent(deps));
}

function feedbackFor(question: BankQuestion, input: { selectedOption: string; changes: readonly LedgerRow[] }): SubmitFeedback {
  return {
    correct: isCorrectOption(question, input.selectedOption),
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    changes: input.changes,
  };
}

function priorFeedback(memory: LearnerMemory, attemptId: string): SubmitFeedback | null {
  const prior = memory.attempts.find((a) => a.attemptId === attemptId);
  if (!prior) return null;
  const changes: StoredLedgerRow[] = memory.rows.filter((r) => r.l1EventId === prior.l1EventId);
  return feedbackFor(getBankQuestion(prior.questionId), { selectedOption: prior.selectedOption, changes });
}

export async function submitAnswer(
  deps: BiologyDeps,
  input: Readonly<{ questionId: string; selectedOption: string; explanation: string; attemptId: string }>,
): Promise<BiologyView & { feedback: SubmitFeedback }> {
  const current = await loadCurrent(deps);
  const replayed = priorFeedback(current.memory, input.attemptId);
  if (replayed) return { ...(await toView(deps, current)), feedback: replayed };
  const question = requireCurrent(current, input.questionId);
  const explanation = input.explanation.trim();
  const correct = isCorrectOption(question, input.selectedOption);
  const activity = await loadQuestionActivity(deps.db, { scope: current.scope, questionId: question.id });
  const result = await recordAttempt(deps.db, {
    scope: current.scope,
    ctx: masteryContext(),
    attempt: {
      attemptId: input.attemptId, questionId: question.id, questionType: question.questionType, conceptIds: question.conceptIds,
      difficulty: question.difficulty, selectedOption: input.selectedOption, correct, tutorUsed: activity.tutorUsed,
      referenceUsed: activity.referenceUsed, condition: attemptCondition(activity), submittedAt: new Date().toISOString(), explanation,
    },
  });
  const view = await loadBiologyView(deps);
  return { ...view, feedback: feedbackFor(question, { selectedOption: input.selectedOption, changes: result.rows }) };
}

export async function recordReference(deps: BiologyDeps, questionId: string): Promise<BiologyView> {
  const current = await loadCurrent(deps);
  requireCurrent(current, questionId);
  await recordAccess(deps.db, { scope: current.scope, questionId, kind: "biology_reference_access" });
  return toView(deps, current);
}

/** Telemetry must not fail tutoring; a finalize failure is logged and the run marked degraded. */
async function finalizeTurnTrace(trace: TraceContext, status: "succeeded" | "failed") {
  try {
    await finalizeTraceRun(trace.prisma, { traceRunId: trace.traceRunId, status, traceCompleteness: "complete", endedAt: new Date(), traceOverheadMs: 0 });
  } catch (error) {
    console.warn(`Unable to finalize biology tutor trace ${trace.traceRunId}:`, error);
    await markTraceRunDegradedBestEffort(trace.prisma, trace.traceRunId);
  }
}

type TurnInput = Readonly<{ focus: CoachFocus; message: string; draft?: Draft; promptIds: readonly PromptId[]; referenceChunkId?: string }>;

/** Offline rules never read a passage, so attaching one needs the live coach. */
function attachedPassage(deps: BiologyDeps, chunkId: string | undefined): TextbookPassage | null {
  if (chunkId === undefined) return null;
  if (!deps.coach) throw new BiologyCoachError("reference_requires_live", "request", "Asking about a reference passage needs the live coach.");
  if (!isKnownChunk(chunkId)) throw new BiologyCoachError("unknown_reference", "request", `Unknown textbook passage ${chunkId}.`);
  return getPassages([chunkId])[0];
}

function resolveTarget(deps: BiologyDeps, current: Current, focus: CoachFocus): CoachTarget {
  if (focus.kind === "current_question") return { phase: "current_question", question: requireCurrent(current, focus.questionId), attempt: null };
  if (!deps.coach) throw new BiologyCoachError("review_requires_live", "request", "Reviewing a submitted answer needs the live coach.");
  const attempt = current.memory.attempts.find((a) => a.attemptId === focus.attemptId);
  if (!attempt) throw new BiologyCoachError("attempt_not_found", "request", "That submitted attempt was not found for this learner.");
  return { phase: "submitted_attempt", question: getBankQuestion(attempt.questionId), attempt };
}

async function offlineTurn(deps: BiologyDeps, input: Readonly<{ current: Current; question: BankQuestion; turn: TurnInput; trace: TraceContext }>): Promise<CoachTurnResponse> {
  const { current, question } = input;
  const activity = await loadQuestionActivity(deps.db, { scope: current.scope, questionId: question.id });
  const turn = biologyOfflineReply({
    question, priorTutorTurns: activity.messages.filter((m) => m.role === "tutor").length,
    levels: question.conceptIds.map((id) => current.memory.states.get(id)?.level ?? null),
    onboarding: await loadOnboardingMetadata(deps.db,current.scope),
  });
  await appendTraceEventBestEffort(input.trace, {
    stage: "biology_offline_reply", kind: "lifecycle", title: "Biology offline rules reply", status: "succeeded",
    details: { metadata: { questionId: question.id, tool: turn.tool } },
  });
  await appendTutorExchange(deps.db, { scope: current.scope, questionId: question.id, phase: "current_question", userText: input.turn.message, reply: turn.reply,
    userMeta: { promptIds: [...input.turn.promptIds] }, assistantMeta: { tool: turn.tool } });
  await recordAccess(deps.db, { scope: current.scope, questionId: question.id, kind: "biology_guided_assistance" });
  return { provider: "offline_rules", focus: input.turn.focus, reply: turn.reply, intents: [], policyId: `offline_rules:${turn.tool}`, tools: [], citedChunkIds: [], quotedSpans: [], stopReason: null, review: null };
}

type LiveTurnInput = Readonly<{ current: Current; target: CoachTarget; trace: TraceContext; turn: TurnInput; attachedPassage: TextbookPassage | null }>;

async function liveTurn(deps: BiologyDeps & { coach: BiologyCoachLlm }, input: LiveTurnInput): Promise<CoachTurnResponse> {
  const { current, target, trace, turn } = input;
  const recalled = await recallBiologyCoachMemory(deps.db, { scope: current.scope, question: target.question, trace });
  const isCurrent = target.phase === "current_question";
  const outcome = await runBiologyCoachTurn({ db: deps.db, llm: deps.coach, trace, env: deps.env }, {
    scope: current.scope, target, memory: recalled.memory, signals: recalled.signals, message: turn.message,
    pickReason: isCurrent && current.pick.kind === "question" ? describePickReason(current.pick.reason) : null,
    draft: isCurrent ? turn.draft ?? null : null,
    promptIds: turn.promptIds, attachedPassage: input.attachedPassage,
  });
  const review = isCurrent ? null : {
    question: toClientQuestion(target.question),
    messages: (await loadCoachThread(deps.db, { scope: current.scope, questionId: target.question.id, phase: "submitted_attempt" })).messages,
  };
  return { provider: "live_llm", focus: turn.focus, ...outcome, review };
}

export async function tutorTurn(deps: BiologyDeps, input: TurnInput): Promise<BiologyView & CoachTurnResponse> {
  const current = await loadCurrent(deps);
  const target = resolveTarget(deps, current, input.focus);
  const passage = attachedPassage(deps, input.referenceChunkId);
  const { scope } = current;
  const trace = createTraceContext({
    prisma: deps.db, userId: scope.userId, path: "memory", task: "biology_coach_turn",
    problemId: scope.problemId, chatSessionId: scope.chatSessionId, memoryOrigin: scope.memoryOrigin,
    // Spec §5/§10.3: guard hits and recalled ids must survive for audit; summary capture drops arrays. Data stays in the local DB.
    captureLevel: "full",
  });
  try {
    const response = deps.coach
      ? await liveTurn({ ...deps, coach: deps.coach }, { current, target, trace, turn: input, attachedPassage: passage })
      : await offlineTurn(deps, { current, question: target.question, turn: input, trace });
    await finalizeTurnTrace(trace, "succeeded");
    return { ...(await toView(deps, current)), ...response };
  } catch (error) {
    await finalizeTurnTrace(trace, "failed");
    throw error;
  }
}

export type ProfileLedgerRow = StoredLedgerRow & Readonly<{ questionId: string }>;

export async function loadProfileData(deps: BiologyDeps): Promise<{
  concepts: readonly Concept[]; states: readonly JudgmentState[]; rows: readonly ProfileLedgerRow[]; latestProfile: LatestProfile | null;
  onboarding: Awaited<ReturnType<typeof loadOnboardingMetadata>>;
}> {
  const scope = await resolveBiologyLearner(deps.db, deps.env);
  const memory = await loadLearnerMemory(deps.db, scope);
  const questionByEvent = new Map(memory.attempts.map((a) => [a.l1EventId, a.questionId]));
  const rows = memory.rows.map((row) => {
    const questionId = questionByEvent.get(row.l1EventId);
    if (!questionId) throw new Error(`Ledger row references unknown L1 event ${row.l1EventId}`);
    return { ...row, questionId };
  });
  return { concepts: CONCEPTS, states: [...memory.states.values()], rows, latestProfile: memory.latestProfile,
    onboarding: await loadOnboardingMetadata(deps.db,scope) };
}
