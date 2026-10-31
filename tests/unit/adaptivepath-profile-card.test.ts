import { describe, expect, it } from "vitest";
import { CONCEPTS } from "@/features/adaptivepath/concepts";
import { buildProfileCard, PROFILE_NOTE_PENDING } from "@/features/adaptivepath/memory/profile-card";
import { ACTIVE_RULE_VERSION, getRuleset } from "@/features/adaptivepath/memory/rules";
import type { JudgmentState, LedgerRow, MasteryLevel } from "@/features/adaptivepath/memory/types";

const rules = getRuleset(ACTIVE_RULE_VERSION);
const id = (n: number) => `b2e-12-2-concept-${String(n).padStart(2, "0")}`;

function judged(entries: Array<[number, MasteryLevel, number]>): ReadonlyMap<string, JudgmentState> {
  return new Map(entries.map(([n, level, stability]) => [
    id(n),
    { conceptId: id(n), level, stability, supportStreak: 0, ruleVersion: rules.version },
  ]));
}

function ledger(conceptId: string, effect: LedgerRow["effect"]): LedgerRow {
  return {
    conceptId, l1EventId: "e", condition: 3, result: "S", effect, reason: null,
    levelBefore: null, levelAfter: 3, stabilityBefore: null, stabilityAfter: 40, ruleVersion: rules.version,
  };
}

describe("L3 profile card", () => {
  it("covers all 10 concepts when nothing is judged", () => {
    const card = buildProfileCard({ states: new Map(), rows: [], concepts: CONCEPTS, rules });
    expect(card.sectionId).toBe("12.2");
    expect(card.basedOnRuleVersion).toBe("bio-l2-v1");
    expect(card.concepts).toHaveLength(10);
    expect(card.concepts.every((c) => c.level === null && c.stability === null)).toBe(true);
    expect(card.levelDistribution).toEqual({ unassessed: 10, level0: 0, level1: 0, level2: 0, level3: 0 });
    expect(PROFILE_NOTE_PENDING).toBe("pending_llm");
  });

  it("lists strengths only at the advance threshold", () => {
    const card = buildProfileCard({ states: judged([[1, 3, 70], [2, 3, 40]]), rows: [], concepts: CONCEPTS, rules });
    expect(card.strengths).toEqual([id(1)]);
  });

  it("lists gaps at level 1 or below", () => {
    const card = buildProfileCard({ states: judged([[1, 0, 40], [2, 1, 70], [3, 2, 40]]), rows: [], concepts: CONCEPTS, rules });
    expect(card.gaps).toEqual([id(1), id(2)]);
    expect(card.levelDistribution).toEqual({ unassessed: 7, level0: 1, level1: 1, level2: 1, level3: 0 });
  });

  it("flags weak prerequisites of weak concepts", () => {
    const card = buildProfileCard({ states: judged([[2, 3, 70], [3, 1, 40], [4, 0, 40]]), rows: [], concepts: CONCEPTS, rules });
    expect(card.prerequisiteGaps).toContainEqual({ conceptId: id(4), prerequisiteId: id(3) });
    expect(card.prerequisiteGaps).not.toContainEqual({ conceptId: id(4), prerequisiteId: id(2) });
  });

  it("counts only eligible ledger rows as evidence", () => {
    const rows = [ledger(id(1), "first"), ledger(id(1), "support"), ledger(id(1), "ineligible")];
    const card = buildProfileCard({ states: judged([[1, 3, 70]]), rows, concepts: CONCEPTS, rules });
    expect(card.concepts[0].evidenceCount).toBe(2);
  });
});
