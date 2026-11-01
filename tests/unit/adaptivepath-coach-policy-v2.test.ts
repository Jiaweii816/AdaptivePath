import { describe, expect, it } from "vitest";
import { CONCEPTS } from "@/features/adaptivepath/concepts";
import { getBankQuestion, type BankQuestion } from "@/features/adaptivepath/question-bank";
import { buildProfileCard } from "@/features/adaptivepath/memory/profile-card";
import { ACTIVE_RULE_VERSION, getRuleset } from "@/features/adaptivepath/memory/rules";
import type { TutorEvidence } from "@/features/adaptivepath/memory/tutor-context";
import type { AttemptCondition, JudgmentState, MasteryLevel } from "@/features/adaptivepath/memory/types";
import { classifiedTurnSchema, type ClassifiedTurn, type IntentKind } from "@/features/adaptivepath/coach/intents";
import { deriveMemorySignals, type MemorySignals } from "@/features/adaptivepath/coach/memory-signals";
import { planTeachingTurn, type DraftState } from "@/features/adaptivepath/coach/teaching-policy";
import { describePickReason } from "@/features/adaptivepath/coach/wording";

const rules = getRuleset(ACTIVE_RULE_VERSION);
const cid = (n: number) => `b2e-12-2-concept-${String(n).padStart(2, "0")}`;
const TEST_CROSS_Q = getBankQuestion("b2e-12-2-q-c04-medium-01");

function states(entries: Array<[number, MasteryLevel, number]>): ReadonlyMap<string, JudgmentState> {
  return new Map(entries.map(([n, level, stability]) => [cid(n), { conceptId: cid(n), level, stability, supportStreak: 0, ruleVersion: rules.version }]));
}

function attempt(n: number, overrides: Partial<TutorEvidence> = {}): TutorEvidence {
  return {
    l1EventId: `e${n}`, attemptId: `a${n}`, questionId: `b2e-12-2-q-c04-easy-0${n}`, questionType: "single_concept",
    conceptIds: [cid(4)], difficulty: "easy", selectedOption: "A", correct: false, tutorUsed: true, referenceUsed: false,
    condition: 1 as AttemptCondition, submittedAt: `2026-11-0${n}T00:00:00.000Z`, explanation: `reasoning ${n}`, ...overrides,
  };
}

function signalsFor(input: { question?: BankQuestion; judged?: Array<[number, MasteryLevel, number]>; attempts?: TutorEvidence[] }): MemorySignals {
  const judged = states(input.judged ?? []);
  return deriveMemorySignals({
    question: input.question ?? TEST_CROSS_Q, states: judged,
    card: buildProfileCard({ states: judged, rows: [], concepts: CONCEPTS, rules }),
    attempts: input.attempts ?? [], concepts: CONCEPTS, lookupQuestion: getBankQuestion,
  });
}

const BASE_SIGNALS: MemorySignals = { level: 1, focusConceptId: cid(4), prerequisiteGap: null, anchor: null, pastMisses: [], reliesOnTutor: false };

function plan(kinds: IntentKind[], opts: { signals?: Partial<MemorySignals>; draft?: DraftState; prior?: number; anxious?: boolean; phase?: "current_question" | "submitted_attempt"; first?: boolean } = {}) {
  const turn: ClassifiedTurn = { intents: kinds.map((kind) => ({ kind })), affect: opts.anxious ? "anxious_stuck" : "none", textbookQuery: "test cross" };
  return planTeachingTurn({
    turn, phase: opts.phase ?? "current_question", signals: { ...BASE_SIGNALS, ...opts.signals },
    draftState: opts.draft ?? "reasoning", priorHintTurns: opts.prior ?? 0, firstTurnOnQuestion: opts.first ?? false,
  });
}
const names = (p: ReturnType<typeof plan>) => p.requiredCalls.map((c) => c.name);

describe("intent schema", () => {
  const ok = { affect: "none", textbookQuery: "test cross" };
  it("rejects review_attempt in current_question and question_hint in submitted_attempt", () => {
    expect(classifiedTurnSchema("current_question").safeParse({ ...ok, intents: [{ kind: "review_attempt" }] }).success).toBe(false);
    expect(classifiedTurnSchema("submitted_attempt").safeParse({ ...ok, intents: [{ kind: "question_hint" }] }).success).toBe(false);
    expect(classifiedTurnSchema("submitted_attempt").safeParse({ ...ok, intents: [{ kind: "review_attempt" }] }).success).toBe(true);
  });
  it("rejects 4 intents and unknown conceptId", () => {
    const four = Array.from({ length: 4 }, () => ({ kind: "off_topic" }));
    expect(classifiedTurnSchema("current_question").safeParse({ ...ok, intents: four }).success).toBe(false);
    expect(classifiedTurnSchema("current_question").safeParse({ ...ok, intents: [{ kind: "explain_concept", conceptId: "nope" }] }).success).toBe(false);
  });
  it("rejects a textbook query over 12 words", () => {
    const long = Array.from({ length: 13 }, () => "word").join(" ");
    expect(classifiedTurnSchema("current_question").safeParse({ ...ok, textbookQuery: long, intents: [{ kind: "off_topic" }] }).success).toBe(false);
  });
});

describe("memory signals", () => {
  it("integrated question focuses the weakest concept, unjudged counts as 0, ties go to the smaller id", () => {
    const integrated = getBankQuestion("b2e-12-2-q-i01-medium-01");
    expect(integrated.conceptIds).toEqual([cid(2), cid(3), cid(4)]);
    expect(signalsFor({ question: integrated, judged: [[2, 3, 80], [3, 1, 40], [4, 2, 70]] })).toMatchObject({ focusConceptId: cid(3), level: 1 });
    expect(signalsFor({ question: integrated, judged: [[2, 3, 80], [3, 1, 40]] })).toMatchObject({ focusConceptId: cid(4), level: 0 });
    expect(signalsFor({ question: integrated, judged: [[2, 1, 80], [3, 1, 40], [4, 2, 70]] }).focusConceptId).toBe(cid(2));
  });
  it("prerequisiteGap picks smallest gap prerequisite only when level ≤ 1", () => {
    expect(signalsFor({ judged: [[4, 1, 40], [2, 0, 40], [3, 1, 40]] }).prerequisiteGap).toBe(cid(2));
    expect(signalsFor({ judged: [[4, 2, 40], [2, 0, 40]] }).prerequisiteGap).toBeNull();
    expect(signalsFor({ judged: [[4, 0, 40], [2, 3, 80], [3, 2, 40]] }).prerequisiteGap).toBeNull();
  });
  it("anchor picks strongest mastered prerequisite", () => {
    expect(signalsFor({ judged: [[4, 1, 40], [2, 3, 70], [3, 3, 90]] }).anchor).toBe(cid(3));
    expect(signalsFor({ judged: [[4, 1, 40], [2, 3, 60]] }).anchor).toBeNull();
  });
  it("pastMisses keeps newest 3 wrong attempts on the question concepts", () => {
    const attempts = [attempt(1), attempt(2), attempt(3, { correct: true }), attempt(4), attempt(5), attempt(6, { conceptIds: [cid(7)] })];
    const misses = signalsFor({ attempts }).pastMisses;
    expect(misses.map((m) => m.l1EventId)).toEqual(["e5", "e4", "e2"]);
    const source = getBankQuestion(attempts[4].questionId);
    expect(misses[0]).toMatchObject({ selectedOption: "A", reasoningExcerpt: "reasoning 5", misconception: source.optionExplanations.A });
  });
  it("reliesOnTutor needs exactly the last 3 at condition 1", () => {
    expect(signalsFor({ attempts: [attempt(1), attempt(2), attempt(3)] }).reliesOnTutor).toBe(true);
    expect(signalsFor({ attempts: [attempt(1), attempt(2)] }).reliesOnTutor).toBe(false);
    expect(signalsFor({ attempts: [attempt(1), attempt(2), attempt(3, { condition: 3 }), attempt(4)] }).reliesOnTutor).toBe(false);
  });
});

describe("teaching policy", () => {
  it("check_reasoning with empty draft elicits and skips diagnosis", () => {
    const p = plan(["check_reasoning"], { draft: "empty" });
    expect(names(p)).not.toContain("diagnose_reasoning");
    expect(p.styleKeys).toContain("elicit_first_step");
  });
  it("question_hint with reasoning requires evidence + diagnose", () => {
    expect(names(plan(["question_hint"]))).toEqual(["get_question_evidence", "diagnose_reasoning"]);
    expect(names(plan(["question_hint"], { draft: "option_only" }))).toContain("diagnose_reasoning");
  });
  it("level maps to depth key 0→worked_example 1→hint_ladder 2→reference 3→socratic", () => {
    const depth = (level: MasteryLevel) => plan(["explain_concept"], { signals: { level } }).styleKeys[0];
    expect([0, 1, 2, 3].map((l) => depth(l as MasteryLevel))).toEqual(["depth_worked_example", "depth_hint_ladder", "depth_reference", "depth_socratic"]);
  });
  it("explain_concept searches with the classifier query and requires a citation", () => {
    const p = plan(["explain_concept"]);
    expect(p.requiredCalls[0]).toEqual({ name: "search_textbook", args: { query: "test cross" } });
    expect(p.requireCitation).toBe(true);
    expect(plan(["off_topic"]).requireCitation).toBe(false);
  });
  it("prerequisite gap adds get_concept_card(prerequisite) and prerequisite_detour for explain/hint/check/request but not locate_textbook", () => {
    const gap = { signals: { prerequisiteGap: cid(3) } };
    for (const kind of ["explain_concept", "question_hint", "check_reasoning", "request_answer"] as const) {
      const p = plan([kind], gap);
      expect(p.requiredCalls).toContainEqual({ name: "get_concept_card", args: { conceptId: cid(3) } });
      expect(p.styleKeys).toContain("prerequisite_detour");
      expect(p.prerequisiteConceptId).toBe(cid(3));
    }
    expect(plan(["locate_textbook"], gap).styleKeys).not.toContain("prerequisite_detour");
  });
  it("anchor adds anchor_bridge only for explain_concept and question_hint", () => {
    const anchor = { signals: { anchor: cid(3) } };
    expect(plan(["explain_concept"], anchor).styleKeys).toContain("anchor_bridge");
    expect(plan(["question_hint"], anchor).anchorConceptId).toBe(cid(3));
    expect(plan(["check_reasoning"], anchor).styleKeys).not.toContain("anchor_bridge");
  });
  it("fade_help only on first turn with empty draft", () => {
    const relies = { signals: { reliesOnTutor: true } };
    expect(plan(["question_hint"], { ...relies, draft: "empty", first: true }).styleKeys).toContain("fade_help");
    expect(plan(["question_hint"], { ...relies, draft: "empty", first: false }).styleKeys).not.toContain("fade_help");
    expect(plan(["question_hint"], { ...relies, draft: "reasoning", first: true }).styleKeys).not.toContain("fade_help");
  });
  it("hintStep ladder 1→2→3, anxious skips one, request_answer is 3, null when level ≠ 1", () => {
    expect([0, 1, 2, 5].map((prior) => plan(["question_hint"], { prior }).hintStep)).toEqual([1, 2, 3, 3]);
    expect(plan(["question_hint"], { anxious: true }).hintStep).toBe(2);
    expect(plan(["question_hint"], { anxious: true }).styleKeys).toContain("empathize_first");
    expect(plan(["request_answer"]).hintStep).toBe(3);
    expect(plan(["question_hint"], { signals: { level: 2 } }).hintStep).toBeNull();
    expect(plan(["explain_concept"]).hintStep).toBeNull();
  });
  it("multiple intents union required calls without duplicates", () => {
    expect(names(plan(["check_reasoning", "question_hint"]))).toEqual(["diagnose_reasoning", "get_question_evidence"]);
  });
  it("review phase requires get_attempt_review", () => {
    expect(names(plan(["review_attempt"], { phase: "submitted_attempt" }))).toEqual(["get_attempt_review"]);
    expect(names(plan(["explain_concept"], { phase: "submitted_attempt" }))).toContain("get_attempt_review");
  });
  it("policyId carries no level", () => {
    expect(plan(["check_reasoning", "question_hint"], { signals: { level: 3 } }).policyId).toBe("bio-coach-v1:check_reasoning+question_hint");
  });
  it("describePickReason copies spec text", () => {
    expect(describePickReason("frontier_concept")).toBe("按课本的先修顺序，这是接下来要练的概念和难度");
    expect(describePickReason("integrated_review")).toBe("把几个概念串起来练");
  });
});
