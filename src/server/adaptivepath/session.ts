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
import { biologyCoachReply, type BiologyTurnResult } from "@/server/agents/coach-agent/biology-chat-reply";
import { createTraceContext, type TraceContext } from "@/server/llm/trace-context";
import { recallBiologyTutorMemory } from "@/server/memory/biology-memory-context";
import { finalizeTraceRun, markTraceRunDegradedBestEffort } from "@/server/observability/trace-store";
import { appendTutorExchange, loadQuestionActivity, recordAccess, type QuestionActivity } from "./activity-store";
import { resolveBiologyLearner } from "./learner";
import { loadLearnerMemory, recordAttempt, type LatestProfile, type LearnerMemory, type LearnerScope } from "./memory-store";
import type { StoredLedgerRow } from "./memory-records";
import { loadOnboardingMetadata } from "./onboarding-store";
import type { LiveTutor } from "./tutor-provider";

export const MIN_EXPLANATION_CHARS = 12;
export type BiologyDeps = Readonly<{ db: PrismaClient; live: LiveTutor | null; env?: Readonly<Record<string, string | undefined>> }>;
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
    modelReady: deps.live !== null,
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
  if (explanation.length < MIN_EXPLANATION_CHARS) throw new Error("Please explain your reasoning (at least 12 characters).");
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

async function runTutorTurn(deps: BiologyDeps, input: { current: Current; question: BankQuestion; message: string; trace: TraceContext }): Promise<BiologyTurnResult> {
  const { current, question, message, trace } = input;
  const activity = await loadQuestionActivity(deps.db, { scope: current.scope, questionId: question.id });
  const recalled = await recallBiologyTutorMemory(deps.db, { scope: current.scope, question, trace });
  const turn = await biologyCoachReply({
    question, message, history: activity.messages,
    priorTutorTurns: activity.messages.filter((m) => m.role === "tutor").length,
    memory: recalled.memory, levels: recalled.levels,
  }, { live: deps.live, trace });
  await appendTutorExchange(deps.db, { scope: current.scope, questionId: question.id, userText: message, reply: turn.reply, tool: turn.tool });
  await recordAccess(deps.db, { scope: current.scope, questionId: question.id, kind: "biology_guided_assistance" });
  return turn;
}

export async function tutorTurn(
  deps: BiologyDeps,
  input: Readonly<{ questionId: string; message: string }>,
): Promise<BiologyView & BiologyTurnResult> {
  const current = await loadCurrent(deps);
  const question = requireCurrent(current, input.questionId);
  const { scope } = current;
  const trace = createTraceContext({
    prisma: deps.db, userId: scope.userId, path: "memory", task: "biology_tutor_turn",
    problemId: scope.problemId, chatSessionId: scope.chatSessionId, memoryOrigin: scope.memoryOrigin,
  });
  try {
    const turn = await runTutorTurn(deps, { current, question, message: input.message, trace });
    await finalizeTurnTrace(trace, "succeeded");
    return { ...(await toView(deps, current)), ...turn };
  } catch (error) {
    await finalizeTurnTrace(trace, "failed");
    throw error;
  }
}

export type ProfileLedgerRow = StoredLedgerRow & Readonly<{ questionId: string }>;

export async function loadProfileData(deps: BiologyDeps): Promise<{
  concepts: readonly Concept[]; states: readonly JudgmentState[]; rows: readonly ProfileLedgerRow[]; latestProfile: LatestProfile | null;
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
