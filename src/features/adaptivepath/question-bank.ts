/**
 * Server-side Biology 12.2 question bank. Contains answers and explanations:
 * never import from a client component (enforced by a unit test).
 */
import foundation from "./data/biology-12-2/questions/concepts-01-03.json";
import middle from "./data/biology-12-2/questions/concepts-04-06.json";
import advanced from "./data/biology-12-2/questions/concepts-07-10.json";
import integrated from "./data/biology-12-2/questions/integrated.json";

export type Difficulty = "easy" | "medium" | "hard";
export type QuestionType = "single_concept" | "integrated";

export type BankQuestion = Readonly<{
  id: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  primaryConceptId: string | null;
  conceptIds: readonly string[];
  objective: string;
  prompt: string;
  options: readonly Readonly<{ id: string; text: string }>[];
  correctAnswer: string;
  explanation: string;
  chunkIds: readonly string[];
  assumptions: readonly string[];
}>;

export type ClientQuestion = Omit<BankQuestion, "correctAnswer" | "explanation">;

type RawQuestion = (typeof foundation)[number] | (typeof integrated)[number];

function toBankQuestion(raw: RawQuestion): BankQuestion {
  return Object.freeze({
    id: raw.id,
    questionType: raw.question_type as QuestionType,
    difficulty: raw.difficulty as Difficulty,
    primaryConceptId: raw.primary_concept_id ?? null,
    conceptIds: Object.freeze([...raw.concept_ids]),
    objective: raw.objective,
    prompt: raw.question,
    options: Object.freeze(raw.options.map((o) => Object.freeze({ id: o.id, text: o.text }))),
    correctAnswer: raw.correct_answer,
    explanation: raw.explanation,
    chunkIds: Object.freeze([...raw.chunk_ids]),
    assumptions: Object.freeze([...raw.assumptions]),
  });
}

const QUESTIONS: readonly BankQuestion[] = Object.freeze(
  [...foundation, ...middle, ...advanced, ...integrated].map(toBankQuestion),
);
const BY_ID: ReadonlyMap<string, BankQuestion> = new Map(QUESTIONS.map((q) => [q.id, q]));

export function listQuestions(): readonly BankQuestion[] {
  return QUESTIONS;
}

export function getBankQuestion(id: string): BankQuestion {
  const question = BY_ID.get(id);
  if (!question) throw new Error(`Unknown biology question: ${id}`);
  return question;
}

export function toClientQuestion(question: BankQuestion): ClientQuestion {
  return Object.freeze({
    id: question.id,
    questionType: question.questionType,
    difficulty: question.difficulty,
    primaryConceptId: question.primaryConceptId,
    conceptIds: question.conceptIds,
    objective: question.objective,
    prompt: question.prompt,
    options: question.options,
    chunkIds: question.chunkIds,
    assumptions: question.assumptions,
  });
}

export function isCorrectOption(question: BankQuestion, optionId: string): boolean {
  if (!question.options.some((o) => o.id === optionId)) throw new Error("Invalid answer option");
  return question.correctAnswer === optionId;
}
