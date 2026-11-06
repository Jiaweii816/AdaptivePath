import { describe, expect, it } from "vitest";
import { CONCEPTS } from "@/features/adaptivepath/concepts";
import { listQuestions } from "@/features/adaptivepath/question-bank";
import { pickNextQuestion } from "@/features/adaptivepath/memory/question-picker";
import { ACTIVE_RULE_VERSION, getRuleset } from "@/features/adaptivepath/memory/rules";
import type { JudgmentState, MasteryLevel } from "@/features/adaptivepath/memory/types";

const rules = getRuleset(ACTIVE_RULE_VERSION);
const questions = listQuestions();
const id = (n: number) => `b2e-12-2-concept-${String(n).padStart(2, "0")}`;
const qid = (n: number, difficulty: string, k: number) =>
  `b2e-12-2-q-c${String(n).padStart(2, "0")}-${difficulty}-${String(k).padStart(2, "0")}`;

function judged(entries: Array<[number, MasteryLevel, number]>): ReadonlyMap<string, JudgmentState> {
  return new Map(entries.map(([n, level, stability]) => [
    id(n),
    { conceptId: id(n), level, stability, supportStreak: 0, ruleVersion: rules.version },
  ]));
}
const allMastered = () => judged(CONCEPTS.map((_, i) => [i + 1, 3, 70] as [number, MasteryLevel, number]));
const pick = (states: ReadonlyMap<string, JudgmentState>, attempted: Iterable<string> = []) =>
  pickNextQuestion({ states, attemptedQuestionIds: new Set(attempted), concepts: CONCEPTS, questions, rules });
const poolOf = (n: number, difficulty?: string) =>
  questions.filter((q) => q.primaryConceptId === id(n) && (!difficulty || q.difficulty === difficulty)).map((q) => q.id);

describe("next-question picker", () => {
  it("starts at concept 01 easy", () => {
    expect(pick(new Map())).toEqual({
      kind: "question", questionId: qid(1, "easy", 1), conceptId: id(1), difficulty: "easy",
      reason: "frontier_concept", exhaustedConceptIds: [],
    });
  });

  it("advances only past mastered concepts", () => {
    expect(pick(judged([[1, 3, 70]]))).toMatchObject({ conceptId: id(2), difficulty: "easy" });
    expect(pick(judged([[1, 3, 40]]))).toMatchObject({ conceptId: id(1), difficulty: "hard" });
  });

  it("maps level 1 to medium", () => {
    expect(pick(judged([[1, 1, 40]]))).toMatchObject({ conceptId: id(1), difficulty: "medium" });
  });

  it("returns to a demoted prerequisite", () => {
    expect(pick(judged([[1, 2, 40], [2, 3, 70]]))).toMatchObject({ conceptId: id(1), difficulty: "hard" });
  });

  it("falls back to the nearest difficulty", () => {
    expect(pick(judged([[1, 2, 40]]), poolOf(1, "hard"))).toMatchObject({ conceptId: id(1), difficulty: "medium" });
  });

  it("skips exhausted concepts and reports them", () => {
    const result = pick(new Map(), poolOf(1));
    expect(result).toMatchObject({ kind: "question", conceptId: id(2), exhaustedConceptIds: [id(1)] });
  });

  it("moves to integrated questions once all concepts are mastered", () => {
    expect(pick(allMastered())).toMatchObject({
      kind: "question", questionId: "b2e-12-2-q-i01-medium-01", conceptId: null, reason: "integrated_review",
    });
  });

  it("completes when everything is mastered and integrated questions are done", () => {
    const integrated = questions.filter((q) => q.questionType === "integrated").map((q) => q.id);
    expect(pick(allMastered(), integrated)).toEqual({ kind: "completed", exhaustedConceptIds: [] });
  });

  it("never repeats an attempted question", () => {
    const attempted = [qid(1, "easy", 1), qid(1, "easy", 2)];
    expect(pick(new Map(), attempted)).toMatchObject({ questionId: qid(1, "easy", 3) });
  });
});
