import type { Difficulty, QuestionType } from "../question-bank";
import type { Ruleset } from "./rules";

/** 0 not yet · 1 with tutor · 2 with reference · 3 independent. */
export type MasteryLevel = 0 | 1 | 2 | 3;
/** The least help used on an attempt: 1 tutor, 2 reference only, 3 none. */
export type AttemptCondition = 1 | 2 | 3;
export type AttemptResult = "S" | "F";
export type LedgerEffect = "first" | "support" | "counter_down" | "counter_up" | "neutral" | "ineligible";

/** L1 learning evidence: one submitted attempt, append-only. */
export type AttemptEvidence = Readonly<{
  l1EventId: string;
  attemptId: string;
  questionId: string;
  questionType: QuestionType;
  conceptIds: readonly string[];
  difficulty: Difficulty;
  selectedOption: string;
  correct: boolean;
  tutorUsed: boolean;
  referenceUsed: boolean;
  condition: AttemptCondition;
  submittedAt: string;
}>;

/** L2 mastery judgment for one learner × concept. */
export type JudgmentState = Readonly<{
  conceptId: string;
  level: MasteryLevel;
  stability: number;
  supportStreak: number;
  ruleVersion: string;
}>;

/** One ledger line; `*After` is null only for ineligible evidence on an unjudged concept. */
export type LedgerRow = Readonly<{
  conceptId: string;
  l1EventId: string;
  condition: AttemptCondition;
  result: AttemptResult;
  effect: LedgerEffect;
  reason: string | null;
  levelBefore: MasteryLevel | null;
  levelAfter: MasteryLevel | null;
  stabilityBefore: number | null;
  stabilityAfter: number | null;
  ruleVersion: string;
}>;

export type QuestionLookup = Readonly<{
  has(questionId: string): boolean;
  optionIds(questionId: string): readonly string[];
}>;

export type MasteryContext = Readonly<{ rules: Ruleset; lookup: QuestionLookup }>;
