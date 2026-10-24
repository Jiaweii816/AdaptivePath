import { describe, expect, it } from "vitest";
import {
  factDisplayGroup,
  factMechanismKey,
  LADDER_RUNGS,
  ladderConfidence,
  readLadder,
} from "@/features/profile/ledger/fact-display";
import {
  auditSelfReportedPatterns,
  mechanismKeysForPattern,
} from "@/features/profile/ledger/self-reported-audit";
import { isDisplayableCandidateFact } from "@/features/profile/ledger/load-ledger-facts";
import { isTrustedL2FactForConsumption } from "@/server/memory/integrity/memory-integrity-policy";
import type { LedgerFact } from "@/features/profile/ledger/ledger-types";

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: "fact-1",
    factType: "strength",
    mechanismKey: "sliding_window_invariant",
    statement: "sliding-window expand/shrink invariant",
    polarity: "positive",
    group: "can",
    confidence: 0.9,
    evidenceCount: 10,
    lastSeenAt: new Date("2026-07-28T00:00:00Z"),
    ladder: readLadder(10),
    evidence: [],
    verifiedCount: 0,
    distinctProblemCount: 2,
    untraceableCount: 0,
    ...overrides,
  };
}

describe("confidence ladder", () => {
  // The stored learner facts follow this ladder exactly, which is what lets the
  // surface claim the number is computed rather than chosen by a model.
  it("reproduces the deterministic confidence for each sighting count", () => {
    expect(ladderConfidence(1)).toBeCloseTo(0.5);
    expect(ladderConfidence(2)).toBeCloseTo(0.58);
    expect(ladderConfidence(3)).toBeCloseTo(0.66);
    expect(ladderConfidence(4)).toBeCloseTo(0.74);
    expect(ladderConfidence(5)).toBeCloseTo(0.82);
    expect(ladderConfidence(6)).toBeCloseTo(0.9);
  });

  it("caps confidence so extra sightings cannot raise it further", () => {
    expect(ladderConfidence(20)).toBeCloseTo(ladderConfidence(LADDER_RUNGS));
  });

  it("reports rungs beyond the cap instead of hiding them", () => {
    expect(readLadder(20)).toEqual({
      filled: 6,
      rungs: 6,
      beyondCap: 14,
      capped: true,
    });
    expect(readLadder(3)).toEqual({
      filled: 3,
      rungs: 6,
      beyondCap: 0,
      capped: false,
    });
  });
});

describe("display grouping", () => {
  it("groups capability claims by polarity", () => {
    expect(factDisplayGroup({ factType: "strength", tag: "a", polarity: "positive" })).toBe("can");
    expect(factDisplayGroup({ factType: "knowledge_state", tag: "b", polarity: "positive" })).toBe("can");
    expect(factDisplayGroup({ factType: "weakness", tag: "c", polarity: "negative" })).toBe("wrong");
    expect(factDisplayGroup({ factType: "mistake", tag: "d", polarity: "negative" })).toBe("wrong");
  });

  it("keeps process-shaped claims out of the capability groups", () => {
    expect(factDisplayGroup({ factType: "strategy", tag: "e", polarity: "positive" })).toBe("work");
    expect(factDisplayGroup({ factType: "learning_trajectory", tag: "f", polarity: "positive" })).toBe("work");
  });

  it("falls back to a mechanism key rather than showing a claim hash", () => {
    expect(
      factMechanismKey({
        factType: "strength",
        tag: "claim_99aca6a8b19ca7f59af071b1",
        mechanismKeysJson: JSON.stringify(["sliding_window_invariant"]),
      }),
    ).toBe("sliding_window_invariant");
    expect(
      factMechanismKey({ factType: "weakness", tag: "claim_deadbeef" }),
    ).toBe("weakness");
    expect(factMechanismKey({ factType: "mistake", tag: "carry_propagation" })).toBe(
      "carry_propagation",
    );
  });
});

describe("candidate display gate", () => {
  function envelope(promotionStatus: "pending" | "trusted") {
    return JSON.stringify({
      integrity: {
        version: 1,
        origin: "learner",
        subject: "learner_behavior",
        mechanism: "sliding_window_invariant",
        humanLabel: "seen once",
        portability: "portable",
        promotionStatus,
        evidenceClusters: [],
      },
    });
  }

  // Regression: the consumption gate requires promotionStatus "trusted", so
  // reusing it for candidates emptied the band even though 88 rows existed.
  it("accepts a pending candidate that the consumption gate rejects", () => {
    const candidate = {
      tag: "claim_pending",
      status: "candidate",
      memoryOrigin: "learner",
      validationJson: envelope("pending"),
    };

    expect(isDisplayableCandidateFact(candidate)).toBe(true);
    expect(isTrustedL2FactForConsumption(candidate)).toBe(false);
  });

  it("rejects rows that are not pending candidates or not learner-origin", () => {
    expect(
      isDisplayableCandidateFact({
        tag: "claim_active",
        status: "active",
        memoryOrigin: "learner",
        validationJson: envelope("trusted"),
      }),
    ).toBe(false);
    expect(
      isDisplayableCandidateFact({
        tag: "claim_pending",
        status: "candidate",
        memoryOrigin: "development",
        validationJson: envelope("pending"),
      }),
    ).toBe(false);
    expect(
      isDisplayableCandidateFact({
        tag: "claim_pending",
        status: "candidate",
        memoryOrigin: "learner",
        validationJson: "{}",
      }),
    ).toBe(false);
  });
});

describe("self-reported audit", () => {
  it("contradicts a claimed weakness that the ledger records as a strength", () => {
    const [audit] = auditSelfReportedPatterns({
      strongPatterns: [],
      weakPatterns: ["DP state design"],
      facts: [
        fact({
          mechanismKey: "dynamic_programming_state_transition",
          polarity: "positive",
          evidenceCount: 20,
        }),
      ],
    });

    expect(audit?.verdict).toBe("contradicted");
    expect(audit?.positiveFacts).toHaveLength(1);
  });

  it("reports both sides when one mechanism carries a strength and a mistake", () => {
    const [audit] = auditSelfReportedPatterns({
      strongPatterns: [],
      weakPatterns: ["Sliding Window shrink condition"],
      facts: [
        fact({ id: "s", polarity: "positive", evidenceCount: 10 }),
        fact({ id: "m", polarity: "negative", factType: "mistake", evidenceCount: 4 }),
      ],
    });

    expect(audit?.verdict).toBe("split");
    expect(audit?.positiveFacts).toHaveLength(1);
    expect(audit?.negativeFacts).toHaveLength(1);
  });

  it("confirms a claimed strength backed by positive evidence", () => {
    const [audit] = auditSelfReportedPatterns({
      strongPatterns: ["HashMap"],
      weakPatterns: [],
      facts: [fact({ mechanismKey: "hash_map_lookup", polarity: "positive" })],
    });

    expect(audit?.verdict).toBe("confirmed");
  });

  it("says unobserved instead of guessing when no fact matches", () => {
    const [audit] = auditSelfReportedPatterns({
      strongPatterns: ["Brute force to optimization"],
      weakPatterns: [],
      facts: [fact({ mechanismKey: "hash_map_lookup" })],
    });

    expect(audit?.verdict).toBe("unobserved");
    expect(audit?.positiveFacts).toHaveLength(0);
  });

  it("orders disagreements ahead of agreement and unobserved entries", () => {
    const audits = auditSelfReportedPatterns({
      strongPatterns: ["HashMap", "Brute force to optimization"],
      weakPatterns: ["DP state design"],
      facts: [
        fact({
          id: "dp",
          mechanismKey: "dynamic_programming_state_transition",
          polarity: "positive",
          evidenceCount: 20,
        }),
        fact({ id: "hash", mechanismKey: "hash_map_lookup", polarity: "positive" }),
      ],
    });

    expect(audits.map((audit) => audit.verdict)).toEqual([
      "contradicted",
      "confirmed",
      "unobserved",
    ]);
  });

  it("keeps every onboarding pattern option mapped to a mechanism or explicitly empty", () => {
    // Guards against a new onboarding option silently reporting `unobserved`.
    expect(mechanismKeysForPattern("Binary Search")).toContain(
      "binary_search_invariant",
    );
    expect(mechanismKeysForPattern("not an onboarding option")).toEqual([]);
  });
});
