import type { LedgerFact } from "./ledger-types";

function describe(facts: LedgerFact[]) {
  return facts
    .map((fact) => `${fact.confidence.toFixed(2)} (×${fact.evidenceCount})`)
    .join(", ");
}

/**
 * Finds mechanisms the ledger records as both a capability and a defect, and
 * writes a note for each side pointing at the other.
 *
 * This is not a contradiction to resolve. "Drives the window well, breaks the
 * shrink boundary" is a single honest description of one mechanism, and showing
 * only the stronger side would misrepresent the learner.
 */
export function findTwoSidedMechanismNotes(
  facts: LedgerFact[],
): Map<string, string> {
  const byMechanism = new Map<string, LedgerFact[]>();
  for (const fact of facts) {
    const bucket = byMechanism.get(fact.mechanismKey) ?? [];
    bucket.push(fact);
    byMechanism.set(fact.mechanismKey, bucket);
  }

  const notes = new Map<string, string>();
  for (const bucket of byMechanism.values()) {
    const positive = bucket.filter((fact) => fact.polarity === "positive");
    const negative = bucket.filter((fact) => fact.polarity === "negative");
    if (positive.length === 0 || negative.length === 0) continue;

    for (const fact of positive) {
      notes.set(
        fact.id,
        `The same mechanism also carries an open defect at ${describe(negative)}. Both are true: the capability holds, and there is a boundary where it still breaks.`,
      );
    }
    for (const fact of negative) {
      notes.set(
        fact.id,
        `The same mechanism is also an established capability at ${describe(positive)}. Read them together rather than treating either as the whole picture.`,
      );
    }
  }

  return notes;
}
