import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";

const workspace = { hasCurrentCode: true, hasAssistantCandidate: false };

function coverageFor(message: string) {
  return compileTurnUnderstandingV2(message, { workspace }).coverage;
}

describe("turn coverage", () => {
  it("marks an unmatched run request as unknown", () => {
    const coverage = coverageFor("把当前代码跑下看看");
    expect(coverage.resolution).toBe("unknown");
    expect(coverage.ratio).toBeLessThan(1);
    expect(coverage.queryScript).toBe("han");
  });

  it("marks a typo-bearing history question as unknown", () => {
    expect(coverageFor("能查一下我历使中有没有这种坑？").resolution).toBe(
      "unknown",
    );
  });

  it("resolves a fully matched request", () => {
    expect(coverageFor("请运行我的代码").resolution).toBe("resolved");
  });

  it("treats a bare acknowledgement as trivial rather than unknown", () => {
    const coverage = coverageFor("谢谢");
    expect(coverage.resolution).toBe("trivial");
    expect(coverage.contentUnitCount).toBeLessThan(2);
  });

  it("reports latin script for an English query", () => {
    expect(coverageFor("run my current code").queryScript).toBe("latin");
  });

  it("routes unknown coverage through the model assembler", () => {
    expect(
      compileTurnUnderstandingV2("把当前代码跑下看看", { workspace }).route.kind,
    ).toBe("model_assembled");
  });
});
