import type { IntentEvidence } from "../evidence/intent-evidence.types";
import {
  contentUnitsOf,
  detectQueryScript,
  type QueryScript,
} from "./content-units";

const MIN_CONTENT_UNITS = 2;

/**
 * Provisional value. `labeled-intent-v1` remains `pending_review`, so its
 * diagnostic calibration cannot select a production value or support accuracy
 * claims. Re-run `scripts/calibrate-coverage-threshold.ts` after approval.
 */
export const COVERAGE_ESCALATION_THRESHOLD = 0.6;

export type TurnCoverage = {
  readonly queryScript: QueryScript;
  readonly contentUnitCount: number;
  readonly coveredUnitCount: number;
  readonly ratio: number;
  readonly resolution: "resolved" | "trivial" | "unknown";
};

export function computeTurnCoverage(
  message: string,
  evidence: readonly IntentEvidence[],
): TurnCoverage {
  const queryScript = detectQueryScript(message);
  const units = contentUnitsOf(message);
  if (units.length < MIN_CONTENT_UNITS) {
    return trivialCoverage(queryScript, units.length);
  }
  const coveredUnitCount = units.filter((unit) => isCovered(unit, evidence)).length;
  const ratio = coveredUnitCount / units.length;
  return {
    queryScript,
    contentUnitCount: units.length,
    coveredUnitCount,
    ratio,
    resolution: ratio < COVERAGE_ESCALATION_THRESHOLD ? "unknown" : "resolved",
  };
}

function trivialCoverage(queryScript: QueryScript, contentUnitCount: number): TurnCoverage {
  return { queryScript, contentUnitCount, coveredUnitCount: 0, ratio: 1, resolution: "trivial" };
}

function isCovered(
  unit: { readonly start: number; readonly end: number },
  evidence: readonly IntentEvidence[],
): boolean {
  return evidence.some((item) => item.start < unit.end && item.end > unit.start);
}
