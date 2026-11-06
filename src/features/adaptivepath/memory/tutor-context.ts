/**
 * Bounded learner memory handed to the tutor model (report §8): at most two
 * L2 judgments and five categorized L1 evidence summaries. Student-written
 * explanations never leave this boundary, even as short substrings.
 */
import type { Concept } from "../concepts";
import type { AttemptEvidence, AttemptCondition, AttemptResult, JudgmentState, MasteryLevel } from "./types";

export const MAX_CONTEXT_JUDGMENTS = 2;
export const MAX_CONTEXT_EVIDENCE = 5;
export const EXCERPT_CHARS = 200;

export type TutorEvidence = AttemptEvidence & Readonly<{ explanation: string }>;

export type TutorMemoryContext = Readonly<{
  judgments: readonly Readonly<{ conceptId: string; level: MasteryLevel; stability: number }>[];
  evidence: readonly Readonly<{ questionId: string; condition: AttemptCondition; result: AttemptResult; explanationExcerpt: string }>[];
}>;

type ContextInput = Readonly<{
  questionConceptIds: readonly string[];
  states: ReadonlyMap<string, JudgmentState>;
  attempts: readonly TutorEvidence[];
  concepts: readonly Concept[];
}>;

function weakestFirst(a: JudgmentState, b: JudgmentState) {
  return a.level - b.level || a.stability - b.stability || a.conceptId.localeCompare(b.conceptId);
}

function judgedOf(ids: readonly string[], states: ReadonlyMap<string, JudgmentState>): JudgmentState[] {
  return ids.flatMap((id) => {
    const state = states.get(id);
    return state ? [state] : [];
  });
}

function selectJudgments(input: ContextInput): JudgmentState[] {
  const { questionConceptIds, states, concepts } = input;
  if (questionConceptIds.length > 1) {
    return judgedOf(questionConceptIds, states).sort(weakestFirst).slice(0, MAX_CONTEXT_JUDGMENTS);
  }
  const current = judgedOf(questionConceptIds, states);
  const concept = concepts.find((c) => c.id === questionConceptIds[0]);
  const prerequisite = judgedOf(concept?.prerequisiteIds ?? [], states).sort(weakestFirst).slice(0, 1);
  return [...current, ...prerequisite].slice(0, MAX_CONTEXT_JUDGMENTS);
}

export function buildTutorMemoryContext(input: ContextInput): TutorMemoryContext {
  const judgments = selectJudgments(input);
  const selected = new Set(judgments.map((j) => j.conceptId));
  const evidence = [...input.attempts]
    .filter((a) => a.conceptIds.some((id) => selected.has(id)))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, MAX_CONTEXT_EVIDENCE)
    .map((a) => ({
      questionId: a.questionId,
      condition: a.condition,
      result: (a.correct ? "S" : "F") as AttemptResult,
      // No raw reasoning text: lengths are not anonymization.
      explanationExcerpt: a.correct ? "structured_evidence_success" : "structured_evidence_needs_review",
    }));
  return {
    judgments: judgments.map((j) => ({ conceptId: j.conceptId, level: j.level, stability: j.stability })),
    evidence,
  };
}
