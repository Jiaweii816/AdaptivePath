/**
 * L3 learner profile (spec §8): a deterministic section card derived only from
 * L2. The tutor note is filled later by an LLM; until then it stays pending.
 */
import { BIOLOGY_SECTION_ID, type Concept } from "../concepts";
import type { Ruleset } from "./rules";
import type { JudgmentState, LedgerRow, MasteryLevel } from "./types";

export const PROFILE_NOTE_PENDING = "pending_llm";
/** Concepts at or below this level are gaps. */
const GAP_MAX_LEVEL = 1;

export type ProfileCard = Readonly<{
  sectionId: string;
  basedOnRuleVersion: string;
  concepts: readonly Readonly<{ conceptId: string; level: MasteryLevel | null; stability: number | null; evidenceCount: number }>[];
  levelDistribution: Readonly<{ unassessed: number; level0: number; level1: number; level2: number; level3: number }>;
  strengths: readonly string[];
  gaps: readonly string[];
  prerequisiteGaps: readonly Readonly<{ conceptId: string; prerequisiteId: string }>[];
}>;

type CardInput = Readonly<{
  states: ReadonlyMap<string, JudgmentState>;
  rows: readonly LedgerRow[];
  concepts: readonly Concept[];
  rules: Ruleset;
}>;

export function isMastered(state: JudgmentState | undefined, rules: Ruleset): boolean {
  return Boolean(state && state.level >= rules.advanceRule.minLevel && state.stability >= rules.advanceRule.minStability);
}

function isGap(state: JudgmentState | undefined): boolean {
  return Boolean(state && state.level <= GAP_MAX_LEVEL);
}

function distribution(states: ReadonlyMap<string, JudgmentState>, concepts: readonly Concept[]) {
  const levels = concepts.map((c) => states.get(c.id)?.level);
  const count = (level: MasteryLevel) => levels.filter((l) => l === level).length;
  return {
    unassessed: levels.filter((l) => l === undefined).length,
    level0: count(0),
    level1: count(1),
    level2: count(2),
    level3: count(3),
  };
}

export function buildProfileCard({ states, rows, concepts, rules }: CardInput): ProfileCard {
  const evidenceCount = (conceptId: string) =>
    rows.filter((r) => r.conceptId === conceptId && r.effect !== "ineligible").length;
  const gaps = concepts.filter((c) => isGap(states.get(c.id)));
  return {
    sectionId: BIOLOGY_SECTION_ID,
    basedOnRuleVersion: rules.version,
    concepts: concepts.map((c) => ({
      conceptId: c.id,
      level: states.get(c.id)?.level ?? null,
      stability: states.get(c.id)?.stability ?? null,
      evidenceCount: evidenceCount(c.id),
    })),
    levelDistribution: distribution(states, concepts),
    strengths: concepts.filter((c) => isMastered(states.get(c.id), rules)).map((c) => c.id),
    gaps: gaps.map((c) => c.id),
    prerequisiteGaps: gaps.flatMap((c) =>
      c.prerequisiteIds
        .filter((p) => isGap(states.get(p)))
        .map((prerequisiteId) => ({ conceptId: c.id, prerequisiteId })),
    ),
  };
}
