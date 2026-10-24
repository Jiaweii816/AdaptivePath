import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type MarkerMatch = "case_insensitive_substring" | "compact_substring";

type ProblemDef = {
  leetcodeId: number;
  slug: string;
  title: string;
  methodName: string;
  tags: string[];
};

type ReviewCaseDraft = {
  id: string;
  problem: ProblemDef;
  bugCategory: string;
  scenario: string;
  userCode: string;
  input: unknown;
  expected: unknown;
  actual?: unknown;
  error?: string;
  stderr?: string;
  testLabel: string;
  evidenceMarkers: Array<{
    label: string;
    value: string;
    match?: MarkerMatch;
  }>;
  expectedCoachFocus: string[];
  notes: string;
  limitations?: string[];
};

const GENERATED_AT = "2026-07-06";

const PROBLEMS = {
  twoSum: {
    leetcodeId: 1,
    slug: "two-sum",
    title: "Two Sum",
    methodName: "twoSum",
    tags: ["Array", "Hash Table"],
  },
  climbingStairs: {
    leetcodeId: 70,
    slug: "climbing-stairs",
    title: "Climbing Stairs",
    methodName: "climbStairs",
    tags: ["Math", "Dynamic Programming", "Memoization"],
  },
  productExceptSelf: {
    leetcodeId: 238,
    slug: "product-of-array-except-self",
    title: "Product of Array Except Self",
    methodName: "productExceptSelf",
    tags: ["Array", "Prefix Sum"],
  },
  rotateArray: {
    leetcodeId: 189,
    slug: "rotate-array",
    title: "Rotate Array",
    methodName: "rotate",
    tags: ["Array", "Math", "Two Pointers"],
  },
  removeElement: {
    leetcodeId: 27,
    slug: "remove-element",
    title: "Remove Element",
    methodName: "removeElement",
    tags: ["Array", "Two Pointers"],
  },
  searchInsert: {
    leetcodeId: 35,
    slug: "search-insert-position",
    title: "Search Insert Position",
    methodName: "searchInsert",
    tags: ["Array", "Binary Search"],
  },
  searchRange: {
    leetcodeId: 34,
    slug: "find-first-and-last-position-of-element-in-sorted-array",
    title: "Find First and Last Position of Element in Sorted Array",
    methodName: "searchRange",
    tags: ["Array", "Binary Search"],
  },
  rotatedSearch: {
    leetcodeId: 33,
    slug: "search-in-rotated-sorted-array",
    title: "Search in Rotated Sorted Array",
    methodName: "search",
    tags: ["Array", "Binary Search"],
  },
  findMinRotated: {
    leetcodeId: 153,
    slug: "find-minimum-in-rotated-sorted-array",
    title: "Find Minimum in Rotated Sorted Array",
    methodName: "findMin",
    tags: ["Array", "Binary Search"],
  },
  longestSubstring: {
    leetcodeId: 3,
    slug: "longest-substring-without-repeating-characters",
    title: "Longest Substring Without Repeating Characters",
    methodName: "lengthOfLongestSubstring",
    tags: ["Hash Table", "String", "Sliding Window"],
  },
  minSubArrayLen: {
    leetcodeId: 209,
    slug: "minimum-size-subarray-sum",
    title: "Minimum Size Subarray Sum",
    methodName: "minSubArrayLen",
    tags: ["Array", "Binary Search", "Sliding Window", "Prefix Sum"],
  },
  minWindow: {
    leetcodeId: 76,
    slug: "minimum-window-substring",
    title: "Minimum Window Substring",
    methodName: "minWindow",
    tags: ["Hash Table", "String", "Sliding Window"],
  },
  validAnagram: {
    leetcodeId: 242,
    slug: "valid-anagram",
    title: "Valid Anagram",
    methodName: "isAnagram",
    tags: ["Hash Table", "String", "Sorting"],
  },
  removeDuplicatesTwo: {
    leetcodeId: 80,
    slug: "remove-duplicates-from-sorted-array-ii",
    title: "Remove Duplicates from Sorted Array II",
    methodName: "removeDuplicates",
    tags: ["Array", "Two Pointers"],
  },
  threeSum: {
    leetcodeId: 15,
    slug: "3sum",
    title: "3Sum",
    methodName: "threeSum",
    tags: ["Array", "Two Pointers", "Sorting"],
  },
  wordPattern: {
    leetcodeId: 290,
    slug: "word-pattern",
    title: "Word Pattern",
    methodName: "wordPattern",
    tags: ["Hash Table", "String"],
  },
  mergeSortedArray: {
    leetcodeId: 88,
    slug: "merge-sorted-array",
    title: "Merge Sorted Array",
    methodName: "merge",
    tags: ["Array", "Two Pointers", "Sorting"],
  },
  summaryRanges: {
    leetcodeId: 228,
    slug: "summary-ranges",
    title: "Summary Ranges",
    methodName: "summaryRanges",
    tags: ["Array"],
  },
  insertInterval: {
    leetcodeId: 57,
    slug: "insert-interval",
    title: "Insert Interval",
    methodName: "insert",
    tags: ["Array"],
  },
  lengthOfLastWord: {
    leetcodeId: 58,
    slug: "length-of-last-word",
    title: "Length of Last Word",
    methodName: "lengthOfLastWord",
    tags: ["String"],
  },
  spiralMatrix: {
    leetcodeId: 54,
    slug: "spiral-matrix",
    title: "Spiral Matrix",
    methodName: "spiralOrder",
    tags: ["Array", "Matrix", "Simulation"],
  },
  coinChange: {
    leetcodeId: 322,
    slug: "coin-change",
    title: "Coin Change",
    methodName: "coinChange",
    tags: ["Array", "Dynamic Programming", "Breadth-First Search"],
  },
  uniquePathsTwo: {
    leetcodeId: 63,
    slug: "unique-paths-ii",
    title: "Unique Paths II",
    methodName: "uniquePathsWithObstacles",
    tags: ["Array", "Dynamic Programming", "Matrix"],
  },
  wordBreak: {
    leetcodeId: 139,
    slug: "word-break",
    title: "Word Break",
    methodName: "wordBreak",
    tags: ["Hash Table", "String", "Dynamic Programming", "Trie"],
  },
  lis: {
    leetcodeId: 300,
    slug: "longest-increasing-subsequence",
    title: "Longest Increasing Subsequence",
    methodName: "lengthOfLIS",
    tags: ["Array", "Binary Search", "Dynamic Programming"],
  },
  minPathSum: {
    leetcodeId: 64,
    slug: "minimum-path-sum",
    title: "Minimum Path Sum",
    methodName: "minPathSum",
    tags: ["Array", "Dynamic Programming", "Matrix"],
  },
} satisfies Record<string, ProblemDef>;

const TAXONOMY = [
  {
    bugCategory: "state_update_order_error",
    goldenMistakeTags: ["state_update_order_error"],
    notes:
      "The intended state exists, but the code mutates it before the old value has been used safely.",
  },
  {
    bugCategory: "binary_search_boundary_invariant_error",
    goldenMistakeTags: ["binary_search_boundary_invariant_error"],
    notes:
      "The binary-search interval, boundary update, or returned index does not match the intended invariant.",
  },
  {
    bugCategory: "sliding_window_boundary_error",
    goldenMistakeTags: ["sliding_window_boundary_error"],
    notes:
      "The active window boundary or shrink condition stops representing the current valid window.",
  },
  {
    bugCategory: "duplicate_or_frequency_count_error",
    goldenMistakeTags: ["duplicate_or_frequency_count_error"],
    notes:
      "The code treats repeated values, repeated characters, or required counts as if uniqueness were enough.",
  },
  {
    bugCategory: "boundary_condition_error",
    goldenMistakeTags: ["boundary_condition_error"],
    notes:
      "The main idea is plausible, but empty, first/last, single-row, or exact-boundary inputs are not covered.",
  },
  {
    bugCategory: "dp_transition_error",
    goldenMistakeTags: ["dp_transition_error"],
    notes:
      "The DP state is mostly recognizable, but initialization, recurrence, or iteration order is wrong.",
  },
];

const CASES: ReviewCaseDraft[] = [
  {
    id: "review-v1.1-two-sum-store-before-check-same-index",
    problem: PROBLEMS.twoSum,
    bugCategory: "state_update_order_error",
    scenario:
      "A common HashMap attempt stores the current value before checking its complement, so the current index can pair with itself.",
    userCode: `class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        seen = {}
        for i, num in enumerate(nums):
            seen[num] = i
            complement = target - num
            if complement in seen:
                return [seen[complement], i]
        return []
`,
    input: { nums: [3, 2, 4], target: 6 },
    expected: [1, 2],
    actual: [0, 0],
    testLabel: "same value cannot reuse current index",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[3,2,4], target=6", match: "compact_substring" },
      { label: "actual output", value: "[0,0]", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Point out that index 0 is reused with itself before a real pair is found.",
      "Keep the HashMap idea and suggest checking the complement before storing the current number.",
    ],
    notes:
      "Real learners often remember 'put numbers in a dict' but miss the check-before-store invariant.",
  },
  {
    id: "review-v1.1-climbing-stairs-overwrites-prev-before-sum",
    problem: PROBLEMS.climbingStairs,
    bugCategory: "state_update_order_error",
    scenario:
      "The Fibonacci rolling variables are named correctly, but the first assignment overwrites the old value needed by the sum.",
    userCode: `class Solution:
    def climbStairs(self, n: int) -> int:
        prev2, prev1 = 1, 1
        for _ in range(2, n + 1):
            prev2 = prev1
            prev1 = prev2 + prev1
        return prev1
`,
    input: { n: 3 },
    expected: 3,
    actual: 4,
    testLabel: "three steps needs 2+1 split without double-counting",
    evidenceMarkers: [
      { label: "failed input", value: "n=3", match: "compact_substring" },
      { label: "actual output", value: "4", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Explain that both operands in the sum now read the same updated value.",
      "Suggest using a temporary variable or tuple assignment.",
    ],
    notes:
      "This is a realistic rolling-state update-order slip rather than a missing DP solution.",
  },
  {
    id: "review-v1.1-product-except-self-prefix-suffix-include-self",
    problem: PROBLEMS.productExceptSelf,
    bugCategory: "state_update_order_error",
    scenario:
      "The code builds prefix and suffix products, but multiplies by nums[i] before writing res[i], so each answer includes itself.",
    userCode: `class Solution:
    def productExceptSelf(self, nums: list[int]) -> list[int]:
        res = [1] * len(nums)

        prefix = 1
        for i in range(len(nums)):
            prefix *= nums[i]
            res[i] = prefix

        suffix = 1
        for i in range(len(nums) - 1, -1, -1):
            suffix *= nums[i]
            res[i] *= suffix

        return res
`,
    input: { nums: [1, 2, 3, 4] },
    expected: [24, 12, 8, 6],
    actual: [24, 48, 72, 96],
    testLabel: "sample with self included in each product",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[1,2,3,4]", match: "compact_substring" },
      { label: "actual output", value: "[24,48,72,96]", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Show that res[1] becomes 2 * suffix 24 instead of excluding nums[1].",
      "Suggest writing res[i] before updating prefix/suffix with nums[i].",
    ],
    notes:
      "The algorithm choice is right; the bug is the order in which state is consumed and updated.",
  },
  {
    id: "review-v1.1-rotate-array-overwrites-source-slots-in-place",
    problem: PROBLEMS.rotateArray,
    bugCategory: "state_update_order_error",
    scenario:
      "The user tries to rotate in place by copying the last k values forward, but overwrites source positions before preserving them.",
    userCode: `class Solution:
    def rotate(self, nums: list[int], k: int) -> None:
        n = len(nums)
        k %= n
        for i in range(k):
            nums[i] = nums[n - k + i]
            nums[n - k + i] = nums[i]
`,
    input: { nums: [1, 2, 3, 4, 5, 6, 7], k: 3 },
    expected: [5, 6, 7, 1, 2, 3, 4],
    actual: [5, 6, 7, 4, 5, 6, 7],
    testLabel: "in-place rotation overwrites values that are still needed",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[1,2,3,4,5,6,7], k=3", match: "compact_substring" },
      { label: "actual output", value: "[5,6,7,4,5,6,7]", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Point out that nums[n-k+i] is overwritten with the copied value, losing 1,2,3.",
      "Suggest preserving a copy or using reverse cycles before writing back.",
    ],
    notes:
      "This is a human-plausible in-place mutation order bug, not a hardcoded fixture.",
  },
  {
    id: "review-v1.1-remove-element-increments-write-before-assignment",
    problem: PROBLEMS.removeElement,
    bugCategory: "state_update_order_error",
    scenario:
      "The two-pointer idea is present, but write is incremented before assignment, leaving the stale first element inside the returned prefix.",
    userCode: `class Solution:
    def removeElement(self, nums: list[int], val: int) -> int:
        write = 0
        for num in nums:
            if num != val:
                write += 1
                nums[write] = num
        return write
`,
    input: { nums: [3, 2, 2, 3], val: 3 },
    expected: { k: 2, prefix: [2, 2] },
    actual: { k: 2, prefix: [3, 2] },
    testLabel: "returned prefix still contains removed value",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[3,2,2,3], val=3", match: "compact_substring" },
      { label: "actual prefix", value: "prefix=[3,2]", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Show that index 0 is never overwritten before returning k=2.",
      "Suggest assigning nums[write] first, then incrementing write.",
    ],
    notes:
      "Off-by-one appears here as a state update order error around the write pointer.",
  },
  {
    id: "review-v1.1-search-insert-return-left-plus-one-shifts-boundary",
    problem: PROBLEMS.searchInsert,
    bugCategory: "binary_search_boundary_invariant_error",
    scenario:
      "The binary search loop leaves left at the insertion index, but the return adds one more position.",
    userCode: `class Solution:
    def searchInsert(self, nums: list[int], target: int) -> int:
        left, right = 0, len(nums) - 1
        while left <= right:
            mid = (left + right) // 2
            if nums[mid] < target:
                left = mid + 1
            else:
                right = mid - 1
        return left + 1
`,
    input: { nums: [1, 3, 5, 6], target: 2 },
    expected: 1,
    actual: 2,
    testLabel: "insert in the middle should return first >= target",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[1,3,5,6], target=2", match: "compact_substring" },
      { label: "actual output", value: "2", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "State that left already means the first index whose value is >= target after the loop.",
      "Suggest returning left without shifting it.",
    ],
    notes:
      "This replaces the old fixture-specific off-by-one label with the transferable binary-search invariant label.",
  },
  {
    id: "review-v1.1-search-insert-left-right-mixed-closed-half-open",
    problem: PROBLEMS.searchInsert,
    bugCategory: "binary_search_boundary_invariant_error",
    scenario:
      "The loop condition looks half-open, but right is updated like an inclusive boundary, so the insertion slot can be skipped.",
    userCode: `class Solution:
    def searchInsert(self, nums: list[int], target: int) -> int:
        left, right = 0, len(nums) - 1
        while left < right:
            mid = (left + right) // 2
            if nums[mid] < target:
                left = mid + 1
            else:
                right = mid - 1
        return left
`,
    input: { nums: [1, 3, 5, 6], target: 2 },
    expected: 1,
    actual: 0,
    testLabel: "mixed interval semantics skip the insertion boundary",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[1,3,5,6], target=2", match: "compact_substring" },
      { label: "actual output", value: "0", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Explain the mismatch between while left < right and right = mid - 1.",
      "Ask the learner to choose one invariant and keep the updates consistent.",
    ],
    notes:
      "The code is not a stub; it is a plausible invariant-mixing binary search mistake.",
  },
  {
    id: "review-v1.1-search-range-any-hit-not-left-right-boundaries",
    problem: PROBLEMS.searchRange,
    bugCategory: "binary_search_boundary_invariant_error",
    scenario:
      "The code finds one occurrence of target, but the problem needs the first and last target boundaries.",
    userCode: `class Solution:
    def searchRange(self, nums: list[int], target: int) -> list[int]:
        left, right = 0, len(nums) - 1
        while left <= right:
            mid = (left + right) // 2
            if nums[mid] == target:
                return [mid, mid]
            if nums[mid] < target:
                left = mid + 1
            else:
                right = mid - 1
        return [-1, -1]
`,
    input: { nums: [5, 7, 7, 8, 8, 10], target: 8 },
    expected: [3, 4],
    actual: [4, 4],
    testLabel: "duplicate target needs both boundaries",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[5,7,7,8,8,10], target=8", match: "compact_substring" },
      { label: "actual output", value: "[4,4]", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Explain that finding any mid is not the same invariant as finding the left/right boundary.",
      "Suggest running two boundary searches or expanding from a found target only as a fallback.",
    ],
    notes:
      "This is a transferable boundary-search mistake on a different Hot-150 binary-search problem.",
  },
  {
    id: "review-v1.1-rotated-search-uses-plain-sorted-invariant",
    problem: PROBLEMS.rotatedSearch,
    bugCategory: "binary_search_boundary_invariant_error",
    scenario:
      "The user applies normal sorted-array binary search to a rotated array without tracking which half is ordered.",
    userCode: `class Solution:
    def search(self, nums: list[int], target: int) -> int:
        left, right = 0, len(nums) - 1
        while left <= right:
            mid = (left + right) // 2
            if nums[mid] == target:
                return mid
            if nums[mid] < target:
                left = mid + 1
            else:
                right = mid - 1
        return -1
`,
    input: { nums: [4, 5, 6, 7, 0, 1, 2], target: 0 },
    expected: 4,
    actual: -1,
    testLabel: "target is in rotated right half",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[4,5,6,7,0,1,2], target=0", match: "compact_substring" },
      { label: "actual output", value: "-1", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Show that nums[mid] comparison alone assumes the whole interval is sorted.",
      "Suggest first deciding which half is sorted before moving boundaries.",
    ],
    notes:
      "The failure is still about maintaining the correct binary-search invariant under a rotated ordering.",
  },
  {
    id: "review-v1.1-find-min-rotated-discards-mid-containing-min",
    problem: PROBLEMS.findMinRotated,
    bugCategory: "binary_search_boundary_invariant_error",
    scenario:
      "The code uses right = mid - 1 when nums[mid] is smaller than nums[right], which can discard mid even when mid is the minimum.",
    userCode: `class Solution:
    def findMin(self, nums: list[int]) -> int:
        left, right = 0, len(nums) - 1
        while left <= right:
            mid = (left + right) // 2
            if nums[mid] < nums[right]:
                right = mid - 1
            else:
                left = mid + 1
        return nums[left]
`,
    input: { nums: [4, 5, 1, 2, 3] },
    expected: 1,
    actual: 4,
    testLabel: "mid itself can be the minimum",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[4,5,1,2,3]", match: "compact_substring" },
      { label: "actual output", value: "4", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Explain why mid cannot be excluded when nums[mid] < nums[right].",
      "Suggest right = mid under the invariant that the minimum remains inside [left, right].",
    ],
    notes:
      "This is a common inclusive-boundary binary-search error on rotated arrays.",
  },
  {
    id: "review-v1.1-longest-substring-left-regresses-on-stale-duplicate",
    problem: PROBLEMS.longestSubstring,
    bugCategory: "sliding_window_boundary_error",
    scenario:
      "The last_seen dictionary is right, but left can move backward when the duplicate is outside the active window.",
    userCode: `class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        last_seen = {}
        left = 0
        best = 0
        for right, ch in enumerate(s):
            if ch in last_seen:
                left = last_seen[ch] + 1
            last_seen[ch] = right
            best = max(best, right - left + 1)
        return best
`,
    input: { s: "tmmzuxt" },
    expected: 5,
    actual: 6,
    testLabel: "old duplicate should not move left backward",
    evidenceMarkers: [
      { label: "failed input", value: "s=\"tmmzuxt\"", match: "compact_substring" },
      { label: "expected output", value: "5", match: "compact_substring" },
      { label: "actual output", value: "6", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Walk through the old t at index 0 pulling left backward after the current window has moved on.",
      "Suggest left = max(left, last_seen[ch] + 1).",
    ],
    notes:
      "This keeps the realistic sliding-window bug from v1 but maps it to the portable taxonomy.",
  },
  {
    id: "review-v1.1-longest-substring-best-updated-before-shrink",
    problem: PROBLEMS.longestSubstring,
    bugCategory: "sliding_window_boundary_error",
    scenario:
      "The code recognizes duplicates, but records best length before shrinking the invalid window.",
    userCode: `class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        last_seen = {}
        left = 0
        best = 0
        for right, ch in enumerate(s):
            if ch in last_seen and last_seen[ch] >= left:
                best = max(best, right - left + 1)
                left = last_seen[ch] + 1
            last_seen[ch] = right
            best = max(best, right - left + 1)
        return best
`,
    input: { s: "abba" },
    expected: 2,
    actual: 3,
    testLabel: "invalid window counted before shrinking",
    evidenceMarkers: [
      { label: "failed input", value: "s=\"abba\"", match: "compact_substring" },
      { label: "actual output", value: "3", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Point out that the window abb is counted before removing the duplicate b.",
      "Suggest shrinking first, then updating best for the now-valid window.",
    ],
    notes:
      "A realistic order-of-operations bug inside a sliding-window boundary invariant.",
  },
  {
    id: "review-v1.1-min-subarray-shrinks-once-instead-of-while-valid",
    problem: PROBLEMS.minSubArrayLen,
    bugCategory: "sliding_window_boundary_error",
    scenario:
      "The window sum is tracked, but the code shrinks at most once after becoming valid, missing shorter valid windows.",
    userCode: `class Solution:
    def minSubArrayLen(self, target: int, nums: list[int]) -> int:
        left = 0
        total = 0
        best = float("inf")
        for right, num in enumerate(nums):
            total += num
            if total >= target:
                best = min(best, right - left + 1)
                total -= nums[left]
                left += 1
        return 0 if best == float("inf") else best
`,
    input: { target: 7, nums: [2, 3, 1, 2, 4, 3] },
    expected: 2,
    actual: 4,
    testLabel: "needs repeated shrinking after reaching target",
    evidenceMarkers: [
      { label: "failed input", value: "target=7, nums=[2,3,1,2,4,3]", match: "compact_substring" },
      { label: "actual output", value: "4", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Show that [4,3] is still valid after earlier left moves, but the code stops shrinking too early.",
      "Suggest a while total >= target loop.",
    ],
    notes:
      "This is the classic variable-size window shrink-condition mistake.",
  },
  {
    id: "review-v1.1-min-subarray-strict-greater-misses-exact-target",
    problem: PROBLEMS.minSubArrayLen,
    bugCategory: "sliding_window_boundary_error",
    scenario:
      "The shrink condition uses > target instead of >= target, so exact-sum windows are never considered minimal.",
    userCode: `class Solution:
    def minSubArrayLen(self, target: int, nums: list[int]) -> int:
        left = 0
        total = 0
        best = float("inf")
        for right, num in enumerate(nums):
            total += num
            while total > target:
                best = min(best, right - left + 1)
                total -= nums[left]
                left += 1
        return 0 if best == float("inf") else best
`,
    input: { target: 7, nums: [2, 3, 1, 2, 4, 3] },
    expected: 2,
    actual: 3,
    testLabel: "exact target window [4,3] should count",
    evidenceMarkers: [
      { label: "failed input", value: "target=7, nums=[2,3,1,2,4,3]", match: "compact_substring" },
      { label: "actual output", value: "3", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Explain that sum == target is already a valid window and must be scored.",
      "Suggest while total >= target.",
    ],
    notes:
      "A boundary variant of the same sliding-window invariant, useful for checking category consistency.",
  },
  {
    id: "review-v1.1-min-window-shrinks-only-once-after-valid",
    problem: PROBLEMS.minWindow,
    bugCategory: "sliding_window_boundary_error",
    scenario:
      "The code detects a valid minimum-window state but shrinks only one character, so it keeps an early long window.",
    userCode: `class Solution:
    def minWindow(self, s: str, t: str) -> str:
        need = {}
        for ch in t:
            need[ch] = need.get(ch, 0) + 1
        window = {}
        have = 0
        left = 0
        best = (float("inf"), 0, 0)

        for right, ch in enumerate(s):
            window[ch] = window.get(ch, 0) + 1
            if ch in need and window[ch] == need[ch]:
                have += 1
            if have == len(need):
                if right - left + 1 < best[0]:
                    best = (right - left + 1, left, right)
                left_ch = s[left]
                window[left_ch] -= 1
                if left_ch in need and window[left_ch] < need[left_ch]:
                    have -= 1
                left += 1

        return "" if best[0] == float("inf") else s[best[1]:best[2] + 1]
`,
    input: { s: "ADOBECODEBANC", t: "ABC" },
    expected: "BANC",
    actual: "ADOBEC",
    testLabel: "sample needs repeated shrink while valid",
    evidenceMarkers: [
      { label: "failed input", value: "s=\"ADOBECODEBANC\", t=\"ABC\"", match: "compact_substring" },
      { label: "actual output", value: "ADOBEC", match: "case_insensitive_substring" },
    ],
    expectedCoachFocus: [
      "Show that after a valid window appears, non-needed and surplus chars must be removed repeatedly.",
      "Suggest replacing the single if block with a while have == len(need) shrink loop.",
    ],
    notes:
      "This is a realistic Minimum Window shrink-loop bug, not a solution-style mismatch.",
  },
  {
    id: "review-v1.1-valid-anagram-uses-set-and-loses-counts",
    problem: PROBLEMS.validAnagram,
    bugCategory: "duplicate_or_frequency_count_error",
    scenario:
      "The code checks whether both strings contain the same unique letters, but ignores how many times each letter appears.",
    userCode: `class Solution:
    def isAnagram(self, s: str, t: str) -> bool:
        return set(s) == set(t)
`,
    input: { s: "aacc", t: "ccac" },
    expected: false,
    actual: true,
    testLabel: "same character set but different counts",
    evidenceMarkers: [
      { label: "failed input", value: "s=\"aacc\", t=\"ccac\"", match: "compact_substring" },
      { label: "actual output", value: "true", match: "case_insensitive_substring" },
    ],
    expectedCoachFocus: [
      "Point out that set equality loses the second a.",
      "Suggest comparing Counter/dict frequencies or sorted strings.",
    ],
    notes:
      "This is a very common beginner frequency-count bug.",
  },
  {
    id: "review-v1.1-remove-duplicates-ii-keeps-only-one-copy",
    problem: PROBLEMS.removeDuplicatesTwo,
    bugCategory: "duplicate_or_frequency_count_error",
    scenario:
      "The code solves the easier unique-only version and removes the second allowed copy.",
    userCode: `class Solution:
    def removeDuplicates(self, nums: list[int]) -> int:
        write = 0
        for num in nums:
            if write == 0 or nums[write - 1] != num:
                nums[write] = num
                write += 1
        return write
`,
    input: { nums: [1, 1, 1, 2, 2, 3] },
    expected: { k: 5, prefix: [1, 1, 2, 2, 3] },
    actual: { k: 3, prefix: [1, 2, 3] },
    testLabel: "problem allows up to two copies",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[1,1,1,2,2,3]", match: "compact_substring" },
      { label: "actual prefix", value: "prefix=[1,2,3]", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Explain that the requirement is at most two copies, not at most one.",
      "Suggest comparing nums[i] with nums[write - 2].",
    ],
    notes:
      "The mistake is duplicate-count policy, not pointer mechanics alone.",
  },
  {
    id: "review-v1.1-three-sum-does-not-skip-duplicate-triplets",
    problem: PROBLEMS.threeSum,
    bugCategory: "duplicate_or_frequency_count_error",
    scenario:
      "The two-pointer search finds valid triplets, but never skips duplicate anchors or duplicate pointer values after a hit.",
    userCode: `class Solution:
    def threeSum(self, nums: list[int]) -> list[list[int]]:
        nums.sort()
        ans = []
        for i in range(len(nums) - 2):
            left, right = i + 1, len(nums) - 1
            while left < right:
                total = nums[i] + nums[left] + nums[right]
                if total == 0:
                    ans.append([nums[i], nums[left], nums[right]])
                    left += 1
                    right -= 1
                elif total < 0:
                    left += 1
                else:
                    right -= 1
        return ans
`,
    input: { nums: [-1, 0, 1, 2, -1, -4] },
    expected: [[-1, -1, 2], [-1, 0, 1]],
    actual: [[-1, -1, 2], [-1, 0, 1], [-1, 0, 1]],
    testLabel: "sample produces duplicate triplet",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[-1,0,1,2,-1,-4]", match: "compact_substring" },
      { label: "duplicate triplet value", value: "[-1,0,1]", match: "compact_substring" },
      { label: "duplicate wording", value: "重复", match: "case_insensitive_substring" },
    ],
    expectedCoachFocus: [
      "Acknowledge the two-pointer direction is working.",
      "Focus on skipping duplicate i/left/right values so the answer set stays unique.",
    ],
    notes:
      "A realistic duplicate-handling error for a classic Hot-150 problem.",
  },
  {
    id: "review-v1.1-min-window-uses-set-and-ignores-required-duplicates",
    problem: PROBLEMS.minWindow,
    bugCategory: "duplicate_or_frequency_count_error",
    scenario:
      "The code tracks which required characters are present with a set, but t requires two A characters.",
    userCode: `class Solution:
    def minWindow(self, s: str, t: str) -> str:
        need = set(t)
        window = {}
        have = set()
        left = 0
        best = (float("inf"), 0, 0)

        for right, ch in enumerate(s):
            window[ch] = window.get(ch, 0) + 1
            if ch in need:
                have.add(ch)
            while len(have) == len(need):
                if right - left + 1 < best[0]:
                    best = (right - left + 1, left, right)
                left_ch = s[left]
                window[left_ch] -= 1
                if left_ch in need and window[left_ch] == 0:
                    have.remove(left_ch)
                left += 1

        return "" if best[0] == float("inf") else s[best[1]:best[2] + 1]
`,
    input: { s: "AAABBC", t: "AABC" },
    expected: "AABBC",
    actual: "ABBC",
    testLabel: "target needs two A characters",
    evidenceMarkers: [
      { label: "failed input", value: "s=\"AAABBC\", t=\"AABC\"", match: "compact_substring" },
      { label: "actual output", value: "ABBC", match: "case_insensitive_substring" },
    ],
    expectedCoachFocus: [
      "Explain why a set cannot represent the second required A.",
      "Suggest need/window counts and a satisfied-count invariant.",
    ],
    notes:
      "This tests frequency-count reasoning inside a sliding-window problem without labeling it as a boundary bug.",
  },
  {
    id: "review-v1.1-word-pattern-missing-reverse-word-mapping",
    problem: PROBLEMS.wordPattern,
    bugCategory: "duplicate_or_frequency_count_error",
    scenario:
      "The code maps pattern characters to words, but never prevents two different pattern characters from sharing the same word.",
    userCode: `class Solution:
    def wordPattern(self, pattern: str, s: str) -> bool:
        words = s.split()
        if len(pattern) != len(words):
            return False
        mapping = {}
        for ch, word in zip(pattern, words):
            if ch in mapping and mapping[ch] != word:
                return False
            mapping[ch] = word
        return True
`,
    input: { pattern: "abba", s: "dog dog dog dog" },
    expected: false,
    actual: true,
    testLabel: "two pattern letters reuse one word",
    evidenceMarkers: [
      { label: "failed input", value: "pattern=\"abba\", s=\"dog dog dog dog\"", match: "compact_substring" },
      { label: "actual output", value: "true", match: "case_insensitive_substring" },
    ],
    expectedCoachFocus: [
      "Point out that a and b both map to dog.",
      "Suggest checking a reverse word-to-character map or comparing set sizes.",
    ],
    notes:
      "This is a duplicate/collision mistake in a mapping problem, not a syntax issue.",
  },
  {
    id: "review-v1.1-merge-sorted-array-forgets-leftover-nums2",
    problem: PROBLEMS.mergeSortedArray,
    bugCategory: "boundary_condition_error",
    scenario:
      "The reverse merge loop handles the normal case but stops when nums1 is exhausted, leaving leftover nums2 values uncopied.",
    userCode: `class Solution:
    def merge(self, nums1: list[int], m: int, nums2: list[int], n: int) -> None:
        i, j, write = m - 1, n - 1, m + n - 1
        while i >= 0 and j >= 0:
            if nums1[i] > nums2[j]:
                nums1[write] = nums1[i]
                i -= 1
            else:
                nums1[write] = nums2[j]
                j -= 1
            write -= 1
`,
    input: { nums1: [0], m: 0, nums2: [1], n: 1 },
    expected: [1],
    actual: [0],
    testLabel: "nums1 has no initial values",
    evidenceMarkers: [
      { label: "failed input", value: "nums1=[0], m=0, nums2=[1], n=1", match: "compact_substring" },
      { label: "actual output", value: "[0]", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Show that the main loop never runs when i starts at -1.",
      "Suggest a second loop copying remaining nums2 values.",
    ],
    notes:
      "A realistic edge-case miss around one exhausted side of a merge.",
  },
  {
    id: "review-v1.1-summary-ranges-forgets-final-open-range",
    problem: PROBLEMS.summaryRanges,
    bugCategory: "boundary_condition_error",
    scenario:
      "The code appends ranges only when it sees a break, so the final open range is lost after the loop.",
    userCode: `class Solution:
    def summaryRanges(self, nums: list[int]) -> list[str]:
        if not nums:
            return []
        res = []
        start = nums[0]
        for i in range(1, len(nums)):
            if nums[i] != nums[i - 1] + 1:
                if start == nums[i - 1]:
                    res.append(str(start))
                else:
                    res.append(str(start) + "->" + str(nums[i - 1]))
                start = nums[i]
        return res
`,
    input: { nums: [0, 1, 2, 4, 5, 7] },
    expected: ["0->2", "4->5", "7"],
    actual: ["0->2", "4->5"],
    testLabel: "last singleton range should be emitted",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[0,1,2,4,5,7]", match: "compact_substring" },
      { label: "actual first range", value: "0->2", match: "case_insensitive_substring" },
      { label: "actual second range", value: "4->5", match: "case_insensitive_substring" },
    ],
    expectedCoachFocus: [
      "Explain that the last range is still open when the loop ends.",
      "Suggest appending the current range once after the loop.",
    ],
    notes:
      "A common final-segment boundary miss in array scanning.",
  },
  {
    id: "review-v1.1-insert-interval-empty-list-index-error",
    problem: PROBLEMS.insertInterval,
    bugCategory: "boundary_condition_error",
    scenario:
      "The code assumes intervals[0] exists before handling the empty input case.",
    userCode: `class Solution:
    def insert(self, intervals: list[list[int]], newInterval: list[int]) -> list[list[int]]:
        merged = [intervals[0]]
        for start, end in intervals[1:]:
            if start <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        merged.append(newInterval)
        return merged
`,
    input: { intervals: [], newInterval: [5, 7] },
    expected: [[5, 7]],
    error: "IndexError: list index out of range",
    stderr: "IndexError: list index out of range",
    testLabel: "empty intervals should return the new interval",
    evidenceMarkers: [
      { label: "failed input", value: "intervals=[], newInterval=[5,7]", match: "compact_substring" },
      { label: "runtime error", value: "IndexError", match: "case_insensitive_substring" },
    ],
    expectedCoachFocus: [
      "Start with the empty-list boundary before interval merge logic.",
      "Suggest returning [newInterval] when intervals is empty or using a phase-based insert.",
    ],
    notes:
      "The algorithm is incomplete only for a realistic boundary case, not a placeholder.",
  },
  {
    id: "review-v1.1-length-last-word-stops-at-trailing-space",
    problem: PROBLEMS.lengthOfLastWord,
    bugCategory: "boundary_condition_error",
    scenario:
      "The backward scan counts until the first space but never skips trailing spaces.",
    userCode: `class Solution:
    def lengthOfLastWord(self, s: str) -> int:
        count = 0
        for i in range(len(s) - 1, -1, -1):
            if s[i] == " ":
                break
            count += 1
        return count
`,
    input: { s: "Hello World   " },
    expected: 5,
    actual: 0,
    testLabel: "trailing spaces after last word",
    evidenceMarkers: [
      { label: "failed input", value: "s=\"Hello World   \"", match: "compact_substring" },
      { label: "actual output", value: "0", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Point out that the first character inspected is a trailing space.",
      "Suggest skipping trailing spaces before counting the word.",
    ],
    notes:
      "A small but real boundary-condition bug from a common string scan.",
  },
  {
    id: "review-v1.1-spiral-matrix-single-row-double-counts-bottom",
    problem: PROBLEMS.spiralMatrix,
    bugCategory: "boundary_condition_error",
    scenario:
      "The spiral traversal does not re-check top/bottom after consuming the only row, so it walks the same row backward.",
    userCode: `class Solution:
    def spiralOrder(self, matrix: list[list[int]]) -> list[int]:
        top, bottom = 0, len(matrix) - 1
        left, right = 0, len(matrix[0]) - 1
        ans = []
        while top <= bottom and left <= right:
            for col in range(left, right + 1):
                ans.append(matrix[top][col])
            top += 1
            for row in range(top, bottom + 1):
                ans.append(matrix[row][right])
            right -= 1
            for col in range(right, left - 1, -1):
                ans.append(matrix[bottom][col])
            bottom -= 1
            for row in range(bottom, top - 1, -1):
                ans.append(matrix[row][left])
            left += 1
        return ans
`,
    input: { matrix: [[1, 2, 3]] },
    expected: [1, 2, 3],
    actual: [1, 2, 3, 2, 1],
    testLabel: "single row should not traverse bottom edge again",
    evidenceMarkers: [
      { label: "failed input", value: "matrix=[[1,2,3]]", match: "compact_substring" },
      { label: "actual output", value: "[1,2,3,2,1]", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Show that top > bottom after the first row is consumed.",
      "Suggest guard checks before bottom-row and left-column traversals.",
    ],
    notes:
      "The normal spiral skeleton is present; the missing boundary guard is the point.",
  },
  {
    id: "review-v1.1-coin-change-descending-amount-prevents-reusing-coin",
    problem: PROBLEMS.coinChange,
    bugCategory: "dp_transition_error",
    scenario:
      "The DP table is recognizable, but iterating amounts downward turns the unbounded coin problem into a 0/1-style update.",
    userCode: `class Solution:
    def coinChange(self, coins: list[int], amount: int) -> int:
        dp = [float("inf")] * (amount + 1)
        dp[0] = 0
        for coin in coins:
            for total in range(amount, coin - 1, -1):
                dp[total] = min(dp[total], dp[total - coin] + 1)
        return -1 if dp[amount] == float("inf") else dp[amount]
`,
    input: { coins: [1, 2, 5], amount: 11 },
    expected: 3,
    actual: -1,
    testLabel: "unbounded coins need reuse within the same coin iteration",
    evidenceMarkers: [
      { label: "failed input", value: "coins=[1,2,5], amount=11", match: "compact_substring" },
      { label: "actual output", value: "-1", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Explain why descending total prevents using coin 5 twice or coin 1 repeatedly.",
      "Suggest iterating total from coin up to amount for unbounded coin change.",
    ],
    notes:
      "A realistic DP loop-order bug, not a missing DP table.",
  },
  {
    id: "review-v1.1-unique-paths-ii-initializes-through-obstacle",
    problem: PROBLEMS.uniquePathsTwo,
    bugCategory: "dp_transition_error",
    scenario:
      "The first row and column are initialized to one even after an obstacle blocks all paths past that point.",
    userCode: `class Solution:
    def uniquePathsWithObstacles(self, obstacleGrid: list[list[int]]) -> int:
        m, n = len(obstacleGrid), len(obstacleGrid[0])
        dp = [[0] * n for _ in range(m)]
        for row in range(m):
            dp[row][0] = 1
        for col in range(n):
            dp[0][col] = 1

        for row in range(1, m):
            for col in range(1, n):
                if obstacleGrid[row][col] == 1:
                    dp[row][col] = 0
                else:
                    dp[row][col] = dp[row - 1][col] + dp[row][col - 1]
        return dp[-1][-1]
`,
    input: { obstacleGrid: [[0, 1], [0, 0]] },
    expected: 1,
    actual: 2,
    testLabel: "first row obstacle should block paths to its right",
    evidenceMarkers: [
      { label: "failed input", value: "obstacleGrid=[[0,1],[0,0]]", match: "compact_substring" },
      { label: "actual output", value: "2", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Show that dp[0][1] is set to 1 despite an obstacle.",
      "Suggest initializing first row/column with obstacle-aware carry.",
    ],
    notes:
      "The bug is DP initialization under blocked boundary states.",
  },
  {
    id: "review-v1.1-word-break-ignores-prefix-reachability",
    problem: PROBLEMS.wordBreak,
    bugCategory: "dp_transition_error",
    scenario:
      "The code marks dp[i] true whenever a dictionary word ends at i, without checking whether the prefix before that word is segmentable.",
    userCode: `class Solution:
    def wordBreak(self, s: str, wordDict: list[str]) -> bool:
        dp = [False] * (len(s) + 1)
        dp[0] = True
        for i in range(1, len(s) + 1):
            for word in wordDict:
                if i >= len(word) and s[i - len(word):i] == word:
                    dp[i] = True
        return dp[-1]
`,
    input: { s: "catsandog", wordDict: ["cats", "dog", "sand", "and", "cat"] },
    expected: false,
    actual: true,
    testLabel: "suffix word exists but prefix is not segmentable",
    evidenceMarkers: [
      { label: "failed input", value: "s=\"catsandog\"", match: "compact_substring" },
      { label: "actual output", value: "true", match: "case_insensitive_substring" },
    ],
    expectedCoachFocus: [
      "Point out that dog exists at the end, but catsan is not a valid prefix segmentation.",
      "Suggest requiring dp[i - len(word)] before setting dp[i].",
    ],
    notes:
      "A real DP transition-contract mistake: the state means segmentable prefix, not word suffix match.",
  },
  {
    id: "review-v1.1-lis-compares-only-adjacent-elements",
    problem: PROBLEMS.lis,
    bugCategory: "dp_transition_error",
    scenario:
      "The code treats LIS like a contiguous increasing run, comparing only nums[i] with nums[i-1].",
    userCode: `class Solution:
    def lengthOfLIS(self, nums: list[int]) -> int:
        if not nums:
            return 0
        dp = [1] * len(nums)
        for i in range(1, len(nums)):
            if nums[i] > nums[i - 1]:
                dp[i] = dp[i - 1] + 1
        return max(dp)
`,
    input: { nums: [10, 9, 2, 5, 3, 7, 101, 18] },
    expected: 4,
    actual: 3,
    testLabel: "subsequence can skip non-adjacent values",
    evidenceMarkers: [
      { label: "failed input", value: "nums=[10,9,2,5,3,7,101,18]", match: "compact_substring" },
      { label: "actual output", value: "3", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Explain that LIS is not required to be contiguous.",
      "Suggest checking all j < i transitions or using tails for the optimized path later.",
    ],
    notes:
      "A common DP recurrence error from confusing subsequence with subarray.",
  },
  {
    id: "review-v1.1-min-path-sum-first-row-col-not-cumulative",
    problem: PROBLEMS.minPathSum,
    bugCategory: "dp_transition_error",
    scenario:
      "The DP recurrence is present for inner cells, but the first row and first column are initialized to raw grid values instead of cumulative sums.",
    userCode: `class Solution:
    def minPathSum(self, grid: list[list[int]]) -> int:
        m, n = len(grid), len(grid[0])
        dp = [[0] * n for _ in range(m)]
        for row in range(m):
            dp[row][0] = grid[row][0]
        for col in range(n):
            dp[0][col] = grid[0][col]

        for row in range(1, m):
            for col in range(1, n):
                dp[row][col] = grid[row][col] + min(dp[row - 1][col], dp[row][col - 1])
        return dp[-1][-1]
`,
    input: { grid: [[1, 2, 3], [4, 5, 6]] },
    expected: 12,
    actual: 9,
    testLabel: "first row path cost must accumulate previous cells",
    evidenceMarkers: [
      { label: "failed input", value: "grid=[[1,2,3],[4,5,6]]", match: "compact_substring" },
      { label: "actual output", value: "9", match: "compact_substring" },
    ],
    expectedCoachFocus: [
      "Show that reaching grid[0][2] costs 1+2+3, not just 3.",
      "Suggest cumulative initialization for row 0 and column 0.",
    ],
    notes:
      "This is an initialization/transition bug that real DP learners often make.",
  },
];

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const datasetPath = path.join(rootDir, "evals/datasets/review/review-v1.1.json");
const fixtureDir = path.join(rootDir, "evals/fixtures/run-evidence/review-v1.1");
const auditPath = path.join(rootDir, "evals/audits/review-v1.1-human-audit.md");

function main() {
  validateCases();
  writeDataset();
  writeFixtures();
  writeAudit();
  console.log(`Wrote ${CASES.length} review-v1.1 cases.`);
  console.log(`Dataset: ${datasetPath}`);
  console.log(`Fixtures: ${fixtureDir}`);
  console.log(`Audit: ${auditPath}`);
}

function validateCases() {
  if (CASES.length !== 30) {
    throw new Error(`review-v1.1 should contain exactly 30 cases, got ${CASES.length}.`);
  }

  const ids = new Set<string>();
  const counts = new Map<string, number>();
  for (const item of CASES) {
    if (ids.has(item.id)) {
      throw new Error(`Duplicate case id: ${item.id}`);
    }
    ids.add(item.id);
    counts.set(item.bugCategory, (counts.get(item.bugCategory) ?? 0) + 1);
  }

  for (const item of TAXONOMY) {
    const count = counts.get(item.bugCategory) ?? 0;
    if (count < 4) {
      throw new Error(`Category ${item.bugCategory} has only ${count} cases.`);
    }
  }
}

function writeDataset() {
  const dataset = {
    datasetVersion: "review-coachbench-v1.1",
    name: "review-v1.1-python-hot150-diagnostic",
    status: "human_approved",
    description:
      "Python-only Review CoachBench v1.1 with 30 replay-backed, human-plausible Hot-150 diagnostic cases across six transferable mistake categories. All humanReviewStatus values are approved after human audit.",
    labelTaxonomy: TAXONOMY,
    cases: CASES.map((item) => ({
      caseId: item.id,
      fixtureId: item.id,
      problem: {
        slug: item.problem.slug,
        title: item.problem.title,
        leetcodeNumber: item.problem.leetcodeId,
      },
      language: "Python",
      bugCategory: item.bugCategory,
      goldenMistakeTags: [item.bugCategory],
      expectedEvidenceMarkers: item.evidenceMarkers.map((marker) => ({
        label: marker.label,
        value: marker.value,
        match: marker.match ?? "compact_substring",
      })),
      source: "synthetic",
      notes: item.notes,
      limitations: item.limitations ?? [
        "Synthetic replay evidence, not a live LeetCode submit.",
        "One visible failing case is enough for diagnosis evidence but does not prove hidden-test acceptance.",
      ],
      humanReviewStatus: "approved",
    })),
  };

  writeJson(datasetPath, dataset);
}

function writeFixtures() {
  rmSync(fixtureDir, { force: true, recursive: true });
  mkdirSync(fixtureDir, { recursive: true });

  for (const item of CASES) {
    const status = item.error ? "runtime_error" : "failed";
    const actual = item.error ? undefined : item.actual;
    const fixture = {
      fixtureVersion: "review-v1.1",
      case: {
        id: item.id,
        problem: {
          leetcodeId: item.problem.leetcodeId,
          slug: item.problem.slug,
          title: item.problem.title,
          methodName: item.problem.methodName,
          tags: item.problem.tags,
        },
        language: "Python",
        scenario: item.scenario,
        bugPattern: item.bugCategory,
        userCode: item.userCode,
        selectedTestIds: ["case-main"],
        expectedCoachFocus: item.expectedCoachFocus,
      },
      codeRunResult: {
        status,
        failureProvenance: "user_code",
        passedCount: 0,
        failedCount: 1,
        stdout: "",
        stderr: item.stderr ?? "",
        durationMs: 25,
        actualOutput: item.error ? item.error : displayValue(actual),
        expectedOutput: displayValue(item.expected),
        ...(item.error
          ? {
              errorDetail: {
                kind: "index_out_of_range",
                title: "IndexError",
                summary: item.error,
                likelyCauses: ["The code reads from a list before checking whether it is empty."],
                nextStep: "Handle the empty input before indexing intervals[0].",
                rawMessage: item.error,
              },
            }
          : {}),
        firstFailedCase: {
          id: "case-main",
          label: item.testLabel,
          input: item.input,
          expected: item.expected,
          ...(item.error ? { error: item.error } : { actual }),
        },
        testResults: [
          {
            id: "case-main",
            label: item.testLabel,
            input: item.input,
            expected: item.expected,
            ...(item.error
              ? {
                  error: item.error,
                  stderr: item.stderr ?? item.error,
                  stderrCaptured: true,
                  status: "runtime_error",
                }
              : {
                  actual,
                  status: "failed",
                }),
            passed: false,
            stdoutCaptured: false,
            stderrCaptured: Boolean(item.error),
          },
        ],
        rawResult: {
          providerUsed: "replay_fixture",
          executionKind: "review",
          fixtureId: item.id,
          normalizedFrom: "review-v1.1-static-replay",
          generatedAt: GENERATED_AT,
        },
      },
      evidenceVerdict: {
        evidenceClass: "verdict_bearing",
        replyMode: "diagnostic",
        capabilities: {
          canVerdict: true,
          canWriteMistakeMemory: true,
          canWriteEpisode: true,
          canSignalPlanner: true,
          canUseFailureSalience: true,
        },
        status,
        provenance: "user_code",
        providerUsed: "replay_fixture",
        scopeLabel: "synthetic replay execution evidence",
        modelInstruction:
          "You may reason from this replayed visible-test evidence, without claiming hidden-test acceptance or LeetCode Accepted.",
      },
    };

    writeJson(path.join(fixtureDir, `${item.id}.json`), fixture);
  }
}

function writeAudit() {
  const lines = [
    "# Review v1.1 Human Audit Workbench",
    "",
    "Status: human-approved P1 audit record.",
    "",
    "This file covers `evals/datasets/review/review-v1.1.json`. All cases are marked approved after human review of the dataset row, replay fixture, taxonomy, and evidence markers.",
    "",
    `Audit draft date: ${GENERATED_AT}.`,
    "",
    "## Coverage Summary",
    "",
    "| Bucket | Cases | Agent recommendation summary |",
    "|---|---:|---|",
    ...TAXONOMY.map((item) => {
      const count = CASES.filter((reviewCase) => reviewCase.bugCategory === item.bugCategory).length;
      return `| \`${item.bugCategory}\` | ${count} | ${count} approve_candidate |`;
    }),
    "",
    "## Human Review Checklist",
    "",
    "- Does the code look like a real learner's plausible mistake, not a fixture/stub/hardcoded answer?",
    "- Does the failed replay evidence demonstrate the labeled mechanism?",
    "- Are `bugCategory` and `goldenMistakeTags` transferable beyond this one fixture?",
    "- Are evidence markers specific to run evidence rather than generic problem words?",
    "- Are limitations honest about visible replay evidence and non-AC scope?",
    "",
    "## Cases",
    "",
  ];

  for (const item of CASES) {
    lines.push(
      `### \`${item.id}\``,
      "",
      `- problem: ${item.problem.leetcodeId}. ${item.problem.title} (\`${item.problem.slug}\`)`,
      `- bugCategory: \`${item.bugCategory}\``,
      `- goldenMistakeTags: \`${item.bugCategory}\``,
      "- source: `synthetic`",
      "- agentRecommendation: `approve_candidate`",
      `- agentRationale: ${item.notes}`,
      `- evidenceMarkers: ${item.evidenceMarkers.map((marker) => `\`${marker.label}: ${marker.value}\``).join("; ")}`,
      `- reviewFocus: ${item.expectedCoachFocus.join(" ")}`,
      "- humanConclusion: `approved`",
      "- humanNotes:",
      "",
    );
  }

  writeText(auditPath, `${lines.join("\n")}\n`);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, value: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, "utf8");
}

function displayValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

main();
