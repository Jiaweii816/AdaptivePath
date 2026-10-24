import { hot150ReferenceMarkdown } from "../../scripts/fixtures/hot150-reference-solutions";
import { describe, expect, it } from "vitest";
import {
  getHot150ComparisonOverride,
  hot150ComparisonOverrides,
  type Hot150ComparisonOverride,
} from "@/data/hot150/comparison-overrides";
import { localHot150Bank } from "@/data/hot150/local-bank.generated";
import { localHot150BankSchema, normalizeLeetCodeMetaData } from "@/data/hot150/local-run-types";
import {
  inferDesignClassContractFromExampleTestcases,
  splitLeetCodeExampleTestcases,
} from "@/server/hot150-local/example-testcases";
import { parseHot150ReferenceSolutions } from "@/server/hot150-local/reference-solutions";

describe("Hot-150 local bank contracts", () => {
  it("parses exactly 150 reference Python solutions from the markdown source", () => {
    const markdown = hot150ReferenceMarkdown();
    const solutions = parseHot150ReferenceSolutions(markdown);

    expect(solutions).toHaveLength(150);
    expect(solutions.find((solution) => solution.leetcodeNumber === 209)?.code)
      .toContain("def minSubArrayLen");
  });

  it("rejects duplicate or incomplete reference solution markdown", () => {
    expect(() =>
      parseHot150ReferenceSolutions(
        "### 1. Two Sum\n```python\nclass Solution: pass\n```\n### 1. Two Sum Again\n```python\nclass Solution: pass\n```",
      ),
    ).toThrow(/Duplicate|Expected 150/);
  });

  it("splits LeetCode exampleTestcases using metadata parameter order", () => {
    const contract = normalizeLeetCodeMetaData(
      JSON.stringify({
        name: "minSubArrayLen",
        params: [
          { name: "target", type: "integer" },
          { name: "nums", type: "integer[]" },
        ],
        return: { type: "integer" },
      }),
    );
    const examples = splitLeetCodeExampleTestcases(
      "7\n[2,3,1,2,4,3]\n4\n[1,4,4]",
      contract,
    );

    expect(examples).toEqual([
      {
        dataInput: "7\n[2,3,1,2,4,3]",
        input: { target: 7, nums: [2, 3, 1, 2, 4, 3] },
      },
      {
        dataInput: "4\n[1,4,4]",
        input: { target: 4, nums: [1, 4, 4] },
      },
    ]);
  });

  it("validates the committed generated bank", () => {
    const parsed = localHot150BankSchema.parse(localHot150Bank);
    const generated = parsed.problems.find(
      (problem) => problem.slug === "minimum-size-subarray-sum",
    );

    expect(parsed.problems).toHaveLength(150);
    expect(parsed.problems.every((problem) => problem.localRunStatus === "runnable"))
      .toBe(true);
    expect(generated?.localRunStatus).toBe("runnable");
    expect(generated?.tests[0]?.source).toBe("local_sample");
    expect(generated?.tests[0]?.expected).toBe(2);
  });

  it("keeps generated comparison strategies aligned with explicit overrides", () => {
    const byNumber = new Map(
      localHot150Bank.problems.map((problem) => [
        problem.leetcodeNumber,
        problem,
      ]),
    );

    for (const [numberText, rawOverride] of Object.entries(
      hot150ComparisonOverrides,
    )) {
      const override = rawOverride as Hot150ComparisonOverride;
      const problem = byNumber.get(Number(numberText));

      expect(problem?.comparisonStrategy).toBe(override.strategy);
      expect(problem?.comparisonConfig ?? {}).toEqual(
        override.comparisonConfig ?? {},
      );
    }

    expect(getHot150ComparisonOverride(15)?.strategy).toBe("multiset_deep");
    expect(getHot150ComparisonOverride(46)?.strategy).toBe("multiset_top");
    expect(getHot150ComparisonOverride(210)?.strategy).toBe("special_judge");
  });

  it("parses design-class example testcases without mistaking normal string arrays for operations", () => {
    const designInput =
      '["MinStack","push","push","getMin"]\n[[],[-2],[0],[]]';
    const designContract = inferDesignClassContractFromExampleTestcases(
      designInput,
    );

    expect(designContract).toMatchObject({
      name: "MinStack",
      contractKind: "design_class",
    });
    expect(splitLeetCodeExampleTestcases(designInput, designContract!)).toEqual([
      {
        dataInput: designInput,
        input: {
          operations: ["MinStack", "push", "push", "getMin"],
          arguments: [[], [-2], [0], []],
        },
      },
    ]);

    expect(
      inferDesignClassContractFromExampleTestcases(
        '["This","is","text"]\n16',
      ),
    ).toBeNull();
  });
});
