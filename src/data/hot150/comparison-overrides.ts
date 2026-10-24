import type { ComparisonStrategy } from "./local-run-types";

export type Hot150ComparisonOverride = {
  comparisonConfig?: Record<string, unknown>;
  rationale: string;
  strategy: ComparisonStrategy;
};

export const hot150ComparisonOverrides = {
  1: {
    strategy: "multiset_top",
    rationale: "Two Sum accepts either index order for the same pair.",
  },
  4: {
    strategy: "float_tol",
    rationale: "Median returns a floating-point value.",
  },
  15: {
    strategy: "multiset_deep",
    rationale: "3Sum result is a set of triplets; triplet and outer order are irrelevant.",
  },
  17: {
    strategy: "multiset_top",
    rationale: "Letter combinations may be returned in any order; each string is atomic.",
  },
  22: {
    strategy: "multiset_top",
    rationale: "Generated parenthesis strings may be returned in any order.",
  },
  30: {
    strategy: "multiset_top",
    rationale: "Substring match start indices may be returned in any order.",
  },
  34: {
    strategy: "exact",
    rationale: "The first and last positions are returned as [left, right].",
  },
  39: {
    strategy: "multiset_deep",
    rationale: "Combination Sum is a set of combinations; candidate order inside a combination is irrelevant.",
  },
  46: {
    strategy: "multiset_top",
    rationale: "Permutations are a set of ordered sequences; only the outer result order is irrelevant.",
  },
  49: {
    strategy: "multiset_deep",
    rationale: "Group Anagrams permits groups and words within groups in any order.",
  },
  50: {
    strategy: "float_tol",
    rationale: "Pow(x, n) returns a floating-point value.",
  },
  54: {
    strategy: "exact",
    rationale: "Spiral Matrix output order is the traversal itself.",
  },
  56: {
    strategy: "exact",
    rationale: "Merged intervals are expected in sorted interval order.",
  },
  57: {
    strategy: "exact",
    rationale: "Inserted intervals are expected in sorted interval order.",
  },
  66: {
    strategy: "exact",
    rationale: "Plus One returns digits in positional order.",
  },
  68: {
    strategy: "exact",
    rationale: "Text justification line order and spacing are part of the result.",
  },
  77: {
    strategy: "multiset_deep",
    rationale: "Combinations are an unordered set of unordered selections.",
  },
  102: {
    strategy: "exact",
    rationale: "Level-order traversal preserves level and left-to-right order.",
  },
  103: {
    strategy: "exact",
    rationale: "Zigzag traversal preserves level and per-level traversal order.",
  },
  167: {
    strategy: "exact",
    rationale: "Two Sum II asks for 1-indexed answer in increasing index order.",
  },
  199: {
    strategy: "exact",
    rationale: "Right-side view is top-to-bottom order.",
  },
  210: {
    comparisonConfig: {
      kind: "topological_order",
      numCoursesParam: "numCourses",
      prerequisitesParam: "prerequisites",
    },
    strategy: "special_judge",
    rationale: "Course Schedule II accepts any valid topological ordering.",
  },
  212: {
    strategy: "multiset_top",
    rationale: "Word Search II may return found words in any order.",
  },
  228: {
    strategy: "exact",
    rationale: "Summary ranges are reported in ascending input order.",
  },
  238: {
    strategy: "exact",
    rationale: "Product Except Self returns one value per input index.",
  },
  295: {
    strategy: "op_sequence",
    rationale: "MedianFinder is a design class with floating-point query outputs.",
  },
  373: {
    strategy: "multiset_top",
    rationale: "K smallest pairs are compared as a set of ordered pairs.",
  },
  380: {
    comparisonConfig: { ignoreOps: ["getRandom"] },
    strategy: "op_sequence",
    rationale: "getRandom is non-deterministic; execute it but ignore its returned value.",
  },
  399: {
    strategy: "float_tol",
    rationale: "Evaluate Division returns a list of floating-point values.",
  },
  427: {
    strategy: "exact",
    rationale: "Quad-tree serialization is structural and order-sensitive.",
  },
  637: {
    strategy: "float_tol",
    rationale: "Average of Levels returns floating-point values.",
  },
} satisfies Record<number, Hot150ComparisonOverride>;

export function getHot150ComparisonOverride(
  leetcodeNumber: number,
): Hot150ComparisonOverride | undefined {
  return hot150ComparisonOverrides[
    leetcodeNumber as keyof typeof hot150ComparisonOverrides
  ] as Hot150ComparisonOverride | undefined;
}
