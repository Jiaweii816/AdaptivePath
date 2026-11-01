/**
 * Reasoning diagnoser (spec §9): the only node that sees the answer key and the
 * learner's past misses. Only {probeStep, studentSpan} ever reach the coach.
 */
import { z } from "zod";
import { BiologyCoachError } from "@/features/adaptivepath/coach/errors";
import type { Draft } from "@/features/adaptivepath/coach/draft";
import type { PastMiss } from "@/features/adaptivepath/coach/memory-signals";
import { MIN_DISCLOSURE_OVERLAP_CHARS, findMemoryDisclosures } from "@/features/adaptivepath/coach/memory-disclosure-guard";
import { findAnswerLeaks } from "@/features/adaptivepath/coach/answer-leak-guard";
import { isCorrectOption, type BankQuestion } from "@/features/adaptivepath/question-bank";
import { callLlmNode, NODE_TIMEOUT_MS, parseJsonOutput, type LlmNodeDeps } from "./llm-node";

const TASK = "adaptivepath.biology.diagnoser";
/** Same text for every rejection so the error itself carries no hint; details go to the trace. */
const BLOCKED_PROBE = "The coach's diagnosis was blocked by a safety check. Please ask again.";
const diagnosisSchema = z.object({
  issueKind: z.enum(["wrong_step", "missing_step", "unsupported_claim", "guess_risk", "none"]),
  recurringMisconception: z.boolean(),
  studentSpan: z.string().min(1).nullable(),
  probeStep: z.string().trim().min(1),
  rationale: z.string(),
}).strict();

export type Diagnosis = Readonly<{
  forCoach: Readonly<{ probeStep: string; studentSpan: string | null }>;
  internal: Readonly<{ issueKind: z.infer<typeof diagnosisSchema>["issueKind"]; recurringMisconception: boolean; rationale: string; optionCorrect: boolean | null }>;
}>;
type DiagnoserInput = Readonly<{ question: BankQuestion; draft: Draft; pastMisses: readonly PastMiss[] }>;

const SYSTEM_PROMPT = [
  "You diagnose a biology student's unsubmitted multiple-choice work. You see the answer key; the tutor who talks to the student does not.",
  "Find the first step in the student's reasoning that is wrong, missing or unsupported. If there is no reasoning, judge from the chosen option.",
  "If the work repeats a misconception from pastMisses, set recurringMisconception=true and aim probeStep at that misconception.",
  "If the option is correct and the reasoning complete, use issueKind=none and still give a probeStep asking the student to justify one step, phrased exactly like the other cases.",
  "probeStep: one neutral sentence naming the step to ask about. Never state or hint which option is correct, never give the final value, never mention past attempts.",
  "studentSpan: copy the exact sentence from the student's reasoning that the probe is about, or null.",
  "Return JSON {issueKind, recurringMisconception, studentSpan, probeStep, rationale}.",
].join("\n");

function invalid(message: string, details?: unknown): BiologyCoachError {
  return new BiologyCoachError("diagnosis_invalid", "diagnoser", message, { details });
}

function validate(output: z.infer<typeof diagnosisSchema>, input: DiagnoserInput): void {
  if (output.studentSpan !== null && !input.draft.reasoning.includes(output.studentSpan)) throw invalid("studentSpan is not in the student's reasoning", { studentSpan: output.studentSpan });
  const leaks = findAnswerLeaks(output.probeStep, { correctOption: input.question.correctAnswer, options: input.question.options, quotedSpans: [] });
  if (leaks.length) throw invalid(BLOCKED_PROBE, { leaks });
  const excerpts = input.pastMisses.map((m) => m.reasoningExcerpt).filter((e) => e.trim().length >= MIN_DISCLOSURE_OVERLAP_CHARS);
  const quoted = findMemoryDisclosures(output.probeStep, { pastExcerpts: excerpts, quotedSpans: [], allowedSources: [input.draft.reasoning] });
  if (quoted.length) throw invalid(BLOCKED_PROBE, { quoted });
}

export async function diagnoseReasoning(deps: LlmNodeDeps, input: DiagnoserInput): Promise<Diagnosis> {
  const { question, draft } = input;
  const payload = {
    question: { prompt: question.prompt, options: question.options, assumptions: question.assumptions },
    answerKey: { correctOption: question.correctAnswer, explanation: question.explanation, optionExplanations: question.optionExplanations },
    student: draft,
    pastMisses: input.pastMisses.map((m) => ({ selectedOption: m.selectedOption, reasoning: m.reasoningExcerpt, misconception: m.misconception })),
  };
  const result = await callLlmNode(deps, {
    node: "diagnoser", task: TASK, json: true, timeoutMs: NODE_TIMEOUT_MS,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(payload) }],
  });
  const output = parseJsonOutput(result.content, diagnosisSchema, "diagnoser");
  validate(output, input);
  return {
    forCoach: { probeStep: output.probeStep, studentSpan: output.studentSpan },
    internal: {
      issueKind: output.issueKind, recurringMisconception: output.recurringMisconception, rationale: output.rationale,
      optionCorrect: draft.selectedOption ? isCorrectOption(question, draft.selectedOption) : null,
    },
  };
}
