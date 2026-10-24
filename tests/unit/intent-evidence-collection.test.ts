import { describe, expect, it } from "vitest";

import { segmentClausesV2 } from "@/server/agents/coach-agent/turn-understanding-v2/clause-segmenter-v2";
import { collectTurnEvidence } from "@/server/agents/coach-agent/turn-understanding-v2/evidence/collect-turn-evidence";

function evidenceFor(message: string) {
  return collectTurnEvidence(segmentClausesV2(message));
}

describe("collectTurnEvidence", () => {
  it("flattens per-clause signals into one turn-level list", () => {
    const evidence = evidenceFor("基于我之前做过的 DP 题，解释 heapq");
    expect(evidence.map((item) => `${item.category}:${item.value}`)).toEqual(
      expect.arrayContaining([
        "basis:past_problems",
        "target:concept",
        "deliverable:understand",
        "target:api",
      ]),
    );
  });

  it("keeps spans aligned with the original message offsets", () => {
    const message = "基于我之前做过的 DP 题，解释 heapq";
    const api = evidenceFor(message).find((item) => item.value === "api");
    expect(api).toBeDefined();
    expect(message.slice(api!.start, api!.end)).toBe("heapq");
  });

  it("assigns stable unique ids ordered by span start", () => {
    const evidence = evidenceFor("解释 heapq，再推荐两道图题");
    expect(evidence.map((item) => item.id)).toEqual(
      evidence.map((_, index) => `ev${index}`),
    );
    expect(evidence.map((item) => item.start)).toEqual(
      [...evidence.map((item) => item.start)].sort((a, b) => a - b),
    );
  });

  it("returns an empty list when no pattern matches", () => {
    expect(evidenceFor("嗯嗯")).toEqual([]);
  });
});
