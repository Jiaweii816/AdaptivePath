/** Client-safe display text for L2 levels, attempt conditions and ledger rows. */
import { getConcept } from "./concepts";
import type { AttemptCondition, LedgerRow, MasteryLevel } from "./memory/types";

export const LEVEL_LABELS: Readonly<Record<MasteryLevel, string>> = {
  0: "Not yet",
  1: "With tutor",
  2: "With reference",
  3: "Independent",
};
export const CONDITION_LABELS: Readonly<Record<AttemptCondition, string>> = {
  1: "tutor used",
  2: "reference used",
  3: "no help",
};
export const RESULT_LABELS = { S: "correct", F: "incorrect" } as const;
const NONE = "—";

export function levelLabel(level: MasteryLevel | null): string {
  return level === null ? NONE : LEVEL_LABELS[level];
}

function stabilityLabel(stability: number | null): string {
  return stability === null ? NONE : String(stability);
}

export function describeLedgerChange(row: LedgerRow): string {
  const effect = row.effect === "ineligible" ? `ineligible: ${row.reason}` : row.effect;
  return `${getConcept(row.conceptId).name}: ${levelLabel(row.levelBefore)} → ${levelLabel(row.levelAfter)}, ` +
    `S ${stabilityLabel(row.stabilityBefore)} → ${stabilityLabel(row.stabilityAfter)} (${effect} · ${RESULT_LABELS[row.result]} · ${CONDITION_LABELS[row.condition]})`;
}
