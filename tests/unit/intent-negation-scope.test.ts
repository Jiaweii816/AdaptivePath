import { describe, expect, it } from "vitest";

import { segmentClausesV2 } from "@/server/agents/coach-agent/turn-understanding-v2/clause-segmenter-v2";
import { collectTurnEvidence } from "@/server/agents/coach-agent/turn-understanding-v2/evidence/collect-turn-evidence";
import {
  deriveCategoryDenials,
  hasNegationScope,
} from "@/server/agents/coach-agent/turn-understanding-v2/evidence/negation-scope";
import { annotateEffectDenialsV2 } from "@/server/agents/coach-agent/turn-understanding-v2/signal-annotators-v2";

function denialsFor(message: string) {
  const clauses = segmentClausesV2(message);
  return deriveCategoryDenials({
    clauses,
    evidence: collectTurnEvidence(clauses),
    effectDenials: annotateEffectDenialsV2(clauses),
  });
}

describe("hasNegationScope", () => {
  it("tolerates an intervening verb between marker and evidence", () => {
    expect(hasNegationScope("不要查我以前犯过的错", 3)).toBe(true);
  });

  it("tolerates up to two intervening English words", () => {
    expect(hasNegationScope("don't look at my past mistakes", 12)).toBe(true);
  });

  it("does not fire without a negation marker", () => {
    expect(hasNegationScope("请查我以前犯过的错", 2)).toBe(false);
  });
});

describe("deriveCategoryDenials", () => {
  it.each([
    ["不要解释当前代码", "deliverable", "understand"],
    ["不要查我以前犯过的错", "basis", "past_mistakes"],
    ["不要给提示", "delivery", "hint"],
    ["不要运行我的代码", "effect", "execute"],
  ] as const)("covers the %s axis", (message, category, value) => {
    expect(denialsFor(message)).toContainEqual(
      expect.objectContaining({ category, value }),
    );
  });

  it("does not deny a target axis", () => {
    expect(denialsFor("不要查我的代码")).not.toContainEqual(
      expect.objectContaining({ category: "target" }),
    );
  });

  it("denies a basis category, not only effects", () => {
    expect(denialsFor("不要查我以前犯过的错，直接解释当前边界")).toContainEqual(
      expect.objectContaining({ category: "basis", value: "past_mistakes" }),
    );
  });

  it("still derives execute denials that produce no positive evidence", () => {
    expect(denialsFor("不要运行我的代码，只解释思路")).toContainEqual(
      expect.objectContaining({ category: "effect", value: "execute" }),
    );
  });

  it("does not leak a denial across clause boundaries", () => {
    const denials = denialsFor("不要跑，帮我看看代码哪里错了");
    expect(denials).toContainEqual(
      expect.objectContaining({ category: "effect", value: "execute" }),
    );
    expect(denials).not.toContainEqual(
      expect.objectContaining({ category: "deliverable" }),
    );
  });

  it("deduplicates a denial reported by both sources", () => {
    const denials = denialsFor("不要运行我的代码");
    const executeDenials = denials.filter(
      (denial) => denial.category === "effect" && denial.value === "execute",
    );
    expect(executeDenials).toHaveLength(1);
  });
});
