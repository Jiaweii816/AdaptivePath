/**
 * Versioned, instructor-tunable L2 rules. Ledger rows record the version they
 * were computed under; never edit a published version — add a new one and
 * replay (scripts/adaptivepath-replay-l2.ts).
 */
export type Ruleset = Readonly<{
  version: string;
  initialStability: number;
  /** Support increments by consecutive-support count; the last value repeats. */
  supportDeltas: readonly number[];
  counterDelta: number;
  /** A counter that leaves stability below this moves the level. */
  flipThreshold: number;
  resetStability: number;
  maxLevelStep: number;
  minStability: number;
  maxStability: number;
  /** A concept counts as mastered for question picking at or above this. */
  advanceRule: Readonly<{ minLevel: number; minStability: number }>;
}>;

export const ACTIVE_RULE_VERSION = "bio-l2-v1";

export const BIOLOGY_RULESETS: Readonly<Record<string, Ruleset>> = Object.freeze({
  "bio-l2-v1": Object.freeze({
    version: "bio-l2-v1",
    initialStability: 40,
    supportDeltas: Object.freeze([30, 20, 10]),
    counterDelta: 30,
    flipThreshold: 30,
    resetStability: 40,
    maxLevelStep: 1,
    minStability: 0,
    maxStability: 100,
    advanceRule: Object.freeze({ minLevel: 3, minStability: 70 }),
  }),
});

export function getRuleset(version: string): Ruleset {
  const ruleset = BIOLOGY_RULESETS[version];
  if (!ruleset) throw new Error(`Unknown biology rule version: ${version}`);
  return ruleset;
}
