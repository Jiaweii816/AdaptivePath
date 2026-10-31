/**
 * Deterministic next-question picker (spec §9.1). Concept id order is a valid
 * prerequisite order, so the first unmastered concept is the learning frontier.
 */
import type { Concept } from "../concepts";
import type { Difficulty, QuestionType } from "../question-bank";
import { isMastered } from "./profile-card";
import type { Ruleset } from "./rules";
import type { JudgmentState, MasteryLevel } from "./types";

export type PickableQuestion = Readonly<{
  id: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  primaryConceptId: string | null;
}>;

export type PickResult = Readonly<
  | {
      kind: "question";
      questionId: string;
      conceptId: string | null;
      difficulty: Difficulty;
      reason: "frontier_concept" | "integrated_review";
      exhaustedConceptIds: readonly string[];
    }
  | { kind: "completed"; exhaustedConceptIds: readonly string[] }
>;

type PickInput = Readonly<{
  states: ReadonlyMap<string, JudgmentState>;
  attemptedQuestionIds: ReadonlySet<string>;
  concepts: readonly Concept[];
  questions: readonly PickableQuestion[];
  rules: Ruleset;
}>;

export const UNJUDGED_DIFFICULTY: Difficulty = "easy";
export const DIFFICULTY_BY_LEVEL: Readonly<Record<MasteryLevel, Difficulty>> = { 0: "easy", 1: "medium", 2: "hard", 3: "hard" };
export const DIFFICULTY_SEARCH_ORDER: Readonly<Record<Difficulty, readonly Difficulty[]>> = {
  easy: ["easy", "medium", "hard"],
  medium: ["medium", "hard", "easy"],
  hard: ["hard", "medium", "easy"],
};
const DIFFICULTY_RANK: Readonly<Record<Difficulty, number>> = { easy: 0, medium: 1, hard: 2 };

function byId(a: PickableQuestion, b: PickableQuestion) {
  return a.id.localeCompare(b.id);
}

function pickForConcept(concept: Concept, input: PickInput): PickableQuestion | null {
  const state = input.states.get(concept.id);
  const target = state ? DIFFICULTY_BY_LEVEL[state.level] : UNJUDGED_DIFFICULTY;
  const open = input.questions
    .filter((q) => q.primaryConceptId === concept.id && !input.attemptedQuestionIds.has(q.id))
    .sort(byId);
  for (const difficulty of DIFFICULTY_SEARCH_ORDER[target]) {
    const found = open.find((q) => q.difficulty === difficulty);
    if (found) return found;
  }
  return null;
}

/** Integrated questions run medium before hard, then by id. */
function pickIntegrated(input: PickInput): PickableQuestion | null {
  const open = input.questions
    .filter((q) => q.questionType === "integrated" && !input.attemptedQuestionIds.has(q.id))
    .sort((a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] || byId(a, b));
  return open[0] ?? null;
}

export function pickNextQuestion(input: PickInput): PickResult {
  const exhaustedConceptIds: string[] = [];
  for (const concept of input.concepts) {
    if (isMastered(input.states.get(concept.id), input.rules)) continue;
    const question = pickForConcept(concept, input);
    if (!question) {
      exhaustedConceptIds.push(concept.id);
      continue;
    }
    return { kind: "question", questionId: question.id, conceptId: concept.id, difficulty: question.difficulty, reason: "frontier_concept", exhaustedConceptIds };
  }
  const integrated = pickIntegrated(input);
  if (!integrated) return { kind: "completed", exhaustedConceptIds };
  return { kind: "question", questionId: integrated.id, conceptId: null, difficulty: integrated.difficulty, reason: "integrated_review", exhaustedConceptIds };
}
