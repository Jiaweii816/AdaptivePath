import { describe, expect, it } from "vitest";
import {
  applyAttempt,
  applyEvidence,
  attemptCondition,
  ledgerTargets,
  replayLearner,
} from "@/features/adaptivepath/memory/mastery-engine";
import { ACTIVE_RULE_VERSION, getRuleset, type Ruleset } from "@/features/adaptivepath/memory/rules";
import type {
  AttemptCondition,
  AttemptEvidence,
  AttemptResult,
  JudgmentState,
  MasteryContext,
  QuestionLookup,
} from "@/features/adaptivepath/memory/types";

const C04 = "b2e-12-2-concept-04";
const rules = getRuleset(ACTIVE_RULE_VERSION);
const lookup: QuestionLookup = { has: () => true, optionIds: () => ["A", "B", "C", "D"] };
const ctx: MasteryContext = { rules, lookup };

function state(level: 0 | 1 | 2 | 3, stability: number, supportStreak = 0): JudgmentState {
  return { conceptId: C04, level, stability, supportStreak, ruleVersion: rules.version };
}

function step(prior: JudgmentState | null, condition: AttemptCondition, result: AttemptResult, r: Ruleset = rules) {
  return applyEvidence(prior, { conceptId: C04, l1EventId: "e", condition, result }, r);
}

let seq = 0;
function attempt(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  seq += 1;
  return {
    l1EventId: `l1-${seq}`,
    attemptId: `a-${seq}`,
    questionId: `q-${seq}`,
    questionType: "single_concept",
    conceptIds: [C04],
    difficulty: "easy",
    selectedOption: "A",
    correct: true,
    tutorUsed: false,
    referenceUsed: false,
    condition: 3,
    submittedAt: new Date(Date.UTC(2026, 9, 31, 0, 0, seq)).toISOString(),
    ...overrides,
  };
}

describe("L2 mastery transitions", () => {
  it("report table 3", () => {
    const e1 = step(null, 1, "S");
    const e2 = step(e1.state, 1, "S");
    const e3 = step(e2.state, 1, "F");
    const e4 = step(e3.state, 1, "F");
    expect([e1, e2, e3, e4].map((r) => [r.row.effect, r.state.level, r.state.stability])).toEqual([
      ["first", 1, 40],
      ["support", 1, 70],
      ["counter_down", 1, 40],
      ["counter_down", 0, 40],
    ]);
    expect(e2.row).toMatchObject({ levelBefore: 1, stabilityBefore: 40, levelAfter: 1, stabilityAfter: 70, ruleVersion: "bio-l2-v1" });
  });

  it("support deltas decay 30,20,10,10", () => {
    let current = step(null, 2, "S").state;
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      current = step(current, 2, "S").state;
      seen.push(current.stability);
    }
    expect(seen).toEqual([70, 90, 100, 100]);
  });

  it("failure at higher condition supports", () => {
    expect(step(state(1, 40), 3, "F").row.effect).toBe("support");
  });

  it("stability resists promotion", () => {
    const once = step(state(1, 70), 3, "S");
    expect([once.row.effect, once.state.level, once.state.stability]).toEqual(["counter_up", 1, 40]);
    const twice = step(once.state, 3, "S");
    expect([twice.state.level, twice.state.stability]).toEqual([2, 40]);
  });

  it("new judgment promotes after one", () => {
    const result = step(state(1, 40), 3, "S");
    expect([result.state.level, result.state.stability]).toEqual([2, 40]);
  });

  it("lower-condition success is neutral", () => {
    const result = step(state(3, 70), 1, "S");
    expect(result.row.effect).toBe("neutral");
    expect(result.state).toEqual(state(3, 70));
  });

  it("first failure is level 0", () => {
    const result = step(null, 3, "F");
    expect([result.row.effect, result.state.level, result.state.stability]).toEqual(["first", 0, 40]);
  });

  it("level stays within 0..3", () => {
    expect(step(state(0, 40), 1, "F").state.level).toBe(0);
    expect(step(state(3, 40), 3, "S").row.effect).toBe("support");
  });

  it("counters reset the support streak", () => {
    const supported = step(state(1, 80, 2), 1, "S");
    expect(supported.state.stability).toBe(90);
    const countered = step(supported.state, 1, "F");
    expect([countered.state.level, countered.state.stability, countered.state.supportStreak]).toEqual([1, 60, 0]);
    expect(step(countered.state, 1, "S").state.stability).toBe(90);
  });
});

describe("attempt handling", () => {
  it("condition precedence", () => {
    expect(attemptCondition({ tutorUsed: true, referenceUsed: true })).toBe(1);
    expect(attemptCondition({ tutorUsed: false, referenceUsed: true })).toBe(2);
    expect(attemptCondition({ tutorUsed: false, referenceUsed: false })).toBe(3);
  });

  it("integrated success hits all three; failure writes no rows", () => {
    const ids = ["b2e-12-2-concept-02", "b2e-12-2-concept-03", C04];
    const win = attempt({ questionType: "integrated", conceptIds: ids });
    expect(ledgerTargets(win)).toEqual(ids.map((conceptId) => ({ conceptId, result: "S" })));
    const loss = attempt({ questionType: "integrated", conceptIds: ids, correct: false });
    expect(ledgerTargets(loss)).toEqual([]);
    const applied = applyAttempt(new Map(), loss, ctx);
    expect(applied.rows).toEqual([]);
    expect(applied.states.size).toBe(0);
  });

  it("ineligible evidence writes a row and changes nothing", () => {
    const prior = new Map([[C04, state(2, 70)]]);
    const unknown = { has: () => false, optionIds: () => [] };
    const applied = applyAttempt(prior, attempt(), { rules, lookup: unknown });
    expect(applied.rows).toHaveLength(1);
    expect(applied.rows[0]).toMatchObject({ effect: "ineligible", reason: "unknown_question", levelAfter: 2, stabilityAfter: 70 });
    expect(applied.states.get(C04)).toEqual(state(2, 70));
  });

  it("rejects an option the question does not have", () => {
    const applied = applyAttempt(new Map(), attempt({ selectedOption: "Z" }), ctx);
    expect(applied.rows[0]).toMatchObject({ effect: "ineligible", reason: "invalid_option", levelAfter: null });
    expect(applied.states.size).toBe(0);
  });
});

describe("replay", () => {
  const C03 = "b2e-12-2-concept-03";
  function mixedEvents(): AttemptEvidence[] {
    return [
      attempt({ condition: 1, tutorUsed: true }),
      attempt({ condition: 1, tutorUsed: true, correct: false }),
      attempt({ conceptIds: [C03], condition: 2, referenceUsed: true }),
      attempt({ questionType: "integrated", conceptIds: [C03, C04, "b2e-12-2-concept-05"], correct: false }),
      attempt({ condition: 3 }),
      attempt({ selectedOption: "Z" }),
      attempt({ condition: 3 }),
      attempt({ conceptIds: [C03], condition: 3, correct: false }),
      attempt({ questionType: "integrated", conceptIds: [C03, C04, "b2e-12-2-concept-05"] }),
      attempt({ condition: 2, referenceUsed: true }),
      attempt({ condition: 3, correct: false }),
      attempt({ conceptIds: [C03], condition: 1, tutorUsed: true }),
    ];
  }

  it("replay equals incremental application", () => {
    const events = mixedEvents();
    const initial = new Map<string, JudgmentState>();
    let states: ReadonlyMap<string, JudgmentState> = initial;
    const rows = [];
    for (const event of events) {
      const applied = applyAttempt(states, event, ctx);
      states = applied.states;
      rows.push(...applied.rows);
    }
    const replayed = replayLearner([...events].reverse(), ctx);
    expect(replayed.rows).toEqual(rows);
    expect([...replayed.states]).toEqual([...states]);
    expect(initial.size).toBe(0);
  });

  it("ruleset change alters replay", () => {
    const strict: Ruleset = { ...rules, version: "bio-l2-test-strict", flipThreshold: 50 };
    const events = [attempt({ condition: 1, tutorUsed: true }), attempt({ condition: 1, tutorUsed: true }), attempt({ condition: 1, tutorUsed: true, correct: false })];
    const normal = replayLearner(events, ctx).states.get(C04)!;
    const tightened = replayLearner(events, { rules: strict, lookup }).states.get(C04)!;
    expect(normal.level).toBe(1);
    expect(tightened.level).toBe(0);
    expect(tightened.ruleVersion).toBe("bio-l2-test-strict");
  });

  it("rejects an unknown rule version", () => {
    expect(() => getRuleset("nope")).toThrow();
  });
});
