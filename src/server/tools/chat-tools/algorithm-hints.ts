import { z } from "zod";

export const algorithmHintLevelSchema = z.object({
  heading: z.string(),
  content: z.string(),
});

export const algorithmHintSetSchema = z.object({
  title: z.string(),
  problemSlug: z.string(),
  levels: z.tuple([
    algorithmHintLevelSchema,
    algorithmHintLevelSchema,
    algorithmHintLevelSchema,
  ]),
});

export type AlgorithmHintSet = z.infer<typeof algorithmHintSetSchema>;

const algorithmHintsSchema = z.record(z.string(), algorithmHintSetSchema);

export const algorithmHints = algorithmHintsSchema.parse({
  "two-sum": {
    title: "Two Sum",
    problemSlug: "two-sum",
    levels: [
      {
        heading: "Level 1: Algorithm family",
        content:
          "Use a hashmap/dict. The pattern is: while scanning once, remember values you have already seen.",
      },
      {
        heading: "Level 2: Key insight",
        content:
          "For each num, the only value that can pair with it is target - num. Check that complement before storing the current index.",
      },
      {
        heading: "Level 3: Pseudocode",
        content:
          "seen = {}; for each index i and num: need = target - num; if need in seen return [seen[need], i]; seen[num] = i.",
      },
    ],
  },
  "search-insert-position": {
    title: "Search Insert Position",
    problemSlug: "search-insert-position",
    levels: [
      {
        heading: "Level 1: Algorithm family",
        content:
          "This is a lower-bound binary search: find the first index whose value is >= target.",
      },
      {
        heading: "Level 2: Key insight",
        content:
          "When nums[mid] is already >= target, mid may still be the answer, so keep it in the search range instead of skipping past it.",
      },
      {
        heading: "Level 3: Pseudocode",
        content:
          "left = 0, right = len(nums); while left < right: mid = (left + right)//2; if nums[mid] >= target: right = mid; else: left = mid + 1; return left.",
      },
    ],
  },
  "longest-substring-without-repeating-characters": {
    title: "Longest Substring Without Repeating Characters",
    problemSlug: "longest-substring-without-repeating-characters",
    levels: [
      {
        heading: "Level 1: Algorithm family",
        content:
          "Use a sliding window with a dict/map of last seen positions for each character.",
      },
      {
        heading: "Level 2: Key insight",
        content:
          "The left pointer should only move forward. If a repeated character was last seen before the current window, ignore that old index.",
      },
      {
        heading: "Level 3: Pseudocode",
        content:
          "left = 0; last = {}; best = 0; for right, ch in enumerate(s): if ch in last: left = max(left, last[ch] + 1); last[ch] = right; best = max(best, right - left + 1).",
      },
    ],
  },
});
