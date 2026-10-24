import { describe, expect, it } from "vitest";

import {
  contentUnitsOf,
  detectQueryScript,
} from "@/server/agents/coach-agent/turn-understanding-v2/coverage/content-units";

describe("detectQueryScript", () => {
  it("treats any Han presence as a Chinese query", () => {
    expect(detectQueryScript("解释 heapq")).toBe("han");
  });

  it("falls back to latin when no Han is present", () => {
    expect(detectQueryScript("explain heapq please")).toBe("latin");
  });
});

describe("contentUnitsOf", () => {
  it("drops Han function characters and pairs the remainder", () => {
    expect(contentUnitsOf("把当前代码跑下看看")).toHaveLength(4);
  });

  it("drops latin stopwords and counts one unit per remaining word", () => {
    expect(contentUnitsOf("please run my current code")).toHaveLength(3);
  });

  it("excludes protected prose from the denominator", () => {
    const prefix = "解释 `for i in range(n)` ";
    const withProtectedProse = contentUnitsOf(`${prefix}这段`);
    expect(withProtectedProse).toHaveLength(contentUnitsOf("解释 这段").length);
    expect(withProtectedProse.at(-1)).toEqual({
      start: prefix.length + 1,
      end: prefix.length + 2,
    });
  });

  it("keeps identifiers embedded in a Chinese sentence", () => {
    const units = contentUnitsOf("解释 heapq");
    expect(units.length).toBeGreaterThanOrEqual(2);
  });

  it("returns no units for a bare acknowledgement", () => {
    expect(contentUnitsOf("好的")).toHaveLength(0);
  });
});
