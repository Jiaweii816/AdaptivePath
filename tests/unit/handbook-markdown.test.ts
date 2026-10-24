import { describe, expect, it } from "vitest";
import {
  buildHandbookMarkdown,
  type HandbookNote,
} from "@/features/handbook/handbook-markdown";

const GENERATED_AT = new Date("2026-06-29T12:00:00Z");

function note(overrides: Partial<HandbookNote>): HandbookNote {
  return {
    id: "n1",
    conceptKey: "python_heapq",
    title: "heapq · 最小堆",
    snippet: "import heapq\nheapq.heappush(h, x)",
    whenToUse: "Top-K、Dijkstra",
    category: "python_api",
    lookupCount: 4,
    ...overrides,
  };
}

describe("buildHandbookMarkdown", () => {
  it("groups by category, shows the count, and fences code", () => {
    const md = buildHandbookMarkdown([note({})], GENERATED_AT);
    expect(md).toContain("# 我的知识手册");
    expect(md).toContain("## Python API");
    expect(md).toContain("### heapq · 最小堆（查了 4 次）");
    expect(md).toContain("```\nimport heapq\nheapq.heappush(h, x)\n```");
    expect(md).toContain("何时用：Top-K、Dijkstra");
  });

  it("shows an empty-state line for no notes", () => {
    expect(buildHandbookMarkdown([], GENERATED_AT)).toContain("_手册还是空的_");
  });
});
