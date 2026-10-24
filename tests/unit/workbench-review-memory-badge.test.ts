import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewMemoryBadge } from "@/features/workbench/workbench-client";
import type { WorkbenchCoachMemoryBrief } from "@/features/workbench/types";

describe("ReviewMemoryBadge", () => {
  it("does not render when the brief has no teachable memories", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewMemoryBadge, {
        brief: brief([]),
      }),
    );

    expect(html).toBe("");
  });

  it("renders earned evidence using the cited memory source label", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewMemoryBadge, {
        brief: brief([
          {
            sourceLabel: "Graph DFS visited-state recurrence",
            learnerSignalBasis: "earned_evidence",
            applicability: "directly_teachable",
          },
        ]),
      }),
    );

    expect(html).toContain("Uses your practice history");
    expect(html).toContain("Graph DFS visited-state recurrence");
    expect(html).not.toContain("Referenced your watch list");
  });

  it("does not count teaching-style-only memories as history citations", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewMemoryBadge, {
        brief: brief([
          {
            sourceLabel: "Concise explanation preference",
            learnerSignalBasis: "self_reported",
            applicability: "teaching_style_only",
          },
        ]),
      }),
    );

    expect(html).toBe("");
  });
});

function brief(
  teachableMemories: WorkbenchCoachMemoryBrief["teachableMemories"],
): WorkbenchCoachMemoryBrief {
  return { teachableMemories };
}
