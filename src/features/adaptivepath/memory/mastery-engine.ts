/**
 * Pure L2 rule engine (spec §7). The write path and replay share
 * `applyAttempt`, so a replay under the same ruleset reproduces every row.
 */
import type { Ruleset } from "./rules";
import type {
  AttemptCondition,
  AttemptEvidence,
  AttemptResult,
  JudgmentState,
  LedgerEffect,
  LedgerRow,
  MasteryContext,
  MasteryLevel,
  QuestionLookup,
} from "./types";

const MIN_LEVEL = 0;
const MAX_LEVEL = 3;

export type EvidenceInput = Readonly<{
  conceptId: string;
  l1EventId: string;
  condition: AttemptCondition;
  result: AttemptResult;
}>;
type Transition = Readonly<{ state: JudgmentState; row: LedgerRow }>;
type Eligibility = Readonly<{ eligible: true }> | Readonly<{ eligible: false; reason: string }>;

export function attemptCondition(used: { tutorUsed: boolean; referenceUsed: boolean }): AttemptCondition {
  if (used.tutorUsed) return 1;
  return used.referenceUsed ? 2 : 3;
}

export function checkEligibility(e: AttemptEvidence, lookup: QuestionLookup): Eligibility {
  if (!lookup.has(e.questionId)) return { eligible: false, reason: "unknown_question" };
  if (!lookup.optionIds(e.questionId).includes(e.selectedOption)) return { eligible: false, reason: "invalid_option" };
  if (e.conceptIds.length === 0) return { eligible: false, reason: "no_concepts" };
  return { eligible: true };
}

/** Integrated failures carry no per-concept attribution, so they stay in L1 only. */
export function ledgerTargets(e: AttemptEvidence): readonly { conceptId: string; result: AttemptResult }[] {
  const result: AttemptResult = e.correct ? "S" : "F";
  if (e.questionType === "integrated" && !e.correct) return [];
  return e.conceptIds.map((conceptId) => ({ conceptId, result }));
}

function classify(level: MasteryLevel, input: EvidenceInput): Exclude<LedgerEffect, "first" | "ineligible"> {
  const { condition: c, result } = input;
  if (result === "S") return c === level ? "support" : c > level ? "counter_up" : "neutral";
  return c > level ? "support" : "counter_down";
}

function clampLevel(level: number): MasteryLevel {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level)) as MasteryLevel;
}

function nextState(prior: JudgmentState, effect: LedgerEffect, rules: Ruleset): JudgmentState {
  const base = { ...prior, ruleVersion: rules.version };
  if (effect === "neutral") return base;
  if (effect === "support") {
    const delta = rules.supportDeltas[Math.min(prior.supportStreak, rules.supportDeltas.length - 1)];
    return { ...base, stability: Math.min(rules.maxStability, prior.stability + delta), supportStreak: prior.supportStreak + 1 };
  }
  const lowered = prior.stability - rules.counterDelta;
  if (lowered >= rules.flipThreshold) return { ...base, stability: Math.max(rules.minStability, lowered), supportStreak: 0 };
  const direction = effect === "counter_up" ? 1 : -1;
  return {
    ...base,
    level: clampLevel(prior.level + direction * rules.maxLevelStep),
    stability: rules.resetStability,
    supportStreak: 0,
  };
}

function row(input: EvidenceInput, effect: LedgerEffect, before: JudgmentState | null, after: JudgmentState | null, rules: Ruleset): LedgerRow {
  return {
    conceptId: input.conceptId,
    l1EventId: input.l1EventId,
    condition: input.condition,
    result: input.result,
    effect,
    reason: null,
    levelBefore: before?.level ?? null,
    levelAfter: after?.level ?? null,
    stabilityBefore: before?.stability ?? null,
    stabilityAfter: after?.stability ?? null,
    ruleVersion: rules.version,
  };
}

export function applyEvidence(prior: JudgmentState | null, input: EvidenceInput, rules: Ruleset): Transition {
  if (!prior) {
    const state: JudgmentState = {
      conceptId: input.conceptId,
      level: input.result === "S" ? input.condition : 0,
      stability: rules.initialStability,
      supportStreak: 0,
      ruleVersion: rules.version,
    };
    return { state, row: row(input, "first", null, state, rules) };
  }
  const effect = classify(prior.level, input);
  const state = nextState(prior, effect, rules);
  return { state, row: row(input, effect, prior, state, rules) };
}

function ineligibleRows(states: ReadonlyMap<string, JudgmentState>, e: AttemptEvidence, reason: string, rules: Ruleset): LedgerRow[] {
  const result: AttemptResult = e.correct ? "S" : "F";
  return e.conceptIds.map((conceptId) => {
    const current = states.get(conceptId) ?? null;
    const input = { conceptId, l1EventId: e.l1EventId, condition: e.condition, result };
    return { ...row(input, "ineligible", current, current, rules), reason };
  });
}

export function applyAttempt(
  states: ReadonlyMap<string, JudgmentState>,
  e: AttemptEvidence,
  ctx: MasteryContext,
): { states: ReadonlyMap<string, JudgmentState>; rows: readonly LedgerRow[] } {
  const eligibility = checkEligibility(e, ctx.lookup);
  if (!eligibility.eligible) return { states, rows: ineligibleRows(states, e, eligibility.reason, ctx.rules) };
  const next = new Map(states);
  const rows: LedgerRow[] = [];
  for (const target of ledgerTargets(e)) {
    const input = { ...target, l1EventId: e.l1EventId, condition: e.condition };
    const transition = applyEvidence(next.get(target.conceptId) ?? null, input, ctx.rules);
    next.set(target.conceptId, transition.state);
    rows.push(transition.row);
  }
  return { states: next, rows };
}

export function replayLearner(
  events: readonly AttemptEvidence[],
  ctx: MasteryContext,
): { states: ReadonlyMap<string, JudgmentState>; rows: readonly LedgerRow[] } {
  const ordered = [...events].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  let states: ReadonlyMap<string, JudgmentState> = new Map();
  const rows: LedgerRow[] = [];
  for (const event of ordered) {
    const applied = applyAttempt(states, event, ctx);
    states = applied.states;
    rows.push(...applied.rows);
  }
  return { states, rows };
}
