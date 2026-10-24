import { describe, expect, it } from "vitest";
import { hot150Problems } from "@/data/hot150";
import { resolveProblemInput } from "@/features/workbench/problem-resolver";
import type { WorkbenchProblem } from "@/features/workbench/types";

const problemBase = {
  difficulty: "Easy",
  statementMarkdown: "",
  examples: [],
  constraints: [],
  tags: [],
  starterCode: { Python: "", "C++": "" },
  methodName: "",
  inputContract: {},
  outputContract: {},
  isDemoSupported: true,
  localRunStatus: "not_ready",
  localRunStatusMessage: "not generated",
  comparisonStrategy: "exact",
  comparisonConfig: {},
  contractKind: "pure_function",
  testCases: [],
  drafts: {},
} satisfies Omit<
  WorkbenchProblem,
  "id" | "leetcodeNumber" | "slug" | "title"
>;

const problems: WorkbenchProblem[] = hot150Problems.map((problem) => ({
  ...problemBase,
  id: problem.slug,
  leetcodeNumber: problem.leetcodeNumber,
  slug: problem.slug,
  title: problem.title,
  difficulty: problem.difficulty,
  tags: problem.tags,
  isDemoSupported: [1, 3, 35].includes(problem.leetcodeNumber),
}));

describe("resolveProblemInput", () => {
  it.each([
    ["1", "Two Sum"],
    ["LC 35", "Search Insert Position"],
    ["Two Sum", "Two Sum"],
    ["search-insert-position", "Search Insert Position"],
    [
      "https://leetcode.com/problems/longest-substring-without-repeating-characters/description/",
      "Longest Substring Without Repeating Characters",
    ],
    ["92", "Reverse Linked List II"],
    ["merge-two-sorted-lists", "Merge Two Sorted Lists"],
    ["Linked List Cycle", "Linked List Cycle"],
    ["LC 88", "Merge Sorted Array"],
    [
      "https://leetcode.com/problems/minimum-window-substring/",
      "Minimum Window Substring",
    ],
  ])("resolves %s", (input, title) => {
    const result = resolveProblemInput(input, problems);

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.problem.title).toBe(title);
    }
  });

  it("returns an unknown result without throwing", () => {
    expect(() => resolveProblemInput("binary-search", problems)).not.toThrow();
    expect(resolveProblemInput("binary-search", problems).status).toBe(
      "unknown",
    );
  });
});
