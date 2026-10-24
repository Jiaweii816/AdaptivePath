import { describe, expect, it } from "vitest";
import { derivePassedReviewStrengthFact } from "@/server/agents/coach-agent/passed-review-strength";

describe("passed Review strength detection", () => {
  it("requires a binary-search problem topic in addition to left/right/mid code shape", () => {
    const code = `
def buildTree(inorder, postorder):
    left, right = 0, len(inorder) - 1
    mid = inorder.index(postorder[-1])
    return buildTree(inorder[left:mid], postorder[:mid])
`;

    expect(
      derivePassedReviewStrengthFact({
        code,
        problemTags: ["array", "binary-tree", "divide-and-conquer"],
        evidenceScope: "official_judge",
      }),
    ).toBeUndefined();
    expect(
      derivePassedReviewStrengthFact({
        code,
        problemTags: ["array", "binary-search"],
        evidenceScope: "official_judge",
      }),
    ).toMatchObject({ tag: "binary_search_invariant" });
  });

  it("does not confuse ordinary two-pointer code with a sliding window", () => {
    const code = `
left, right = 0, len(height) - 1
while left < right:
    if height[left] < height[right]: left += 1
    else: right -= 1
`;

    expect(
      derivePassedReviewStrengthFact({
        code,
        problemTags: ["array", "two-pointers"],
        evidenceScope: "official_judge",
      })?.tag,
    ).toBe("two_pointer_movement_invariant");
  });
});
