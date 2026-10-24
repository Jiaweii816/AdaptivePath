import type { WorkbenchProblem } from "./types";

export type ProblemResolution =
  | { status: "resolved"; problem: WorkbenchProblem }
  | { status: "unknown"; message: string };

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
}

function extractProblemSlug(input: string) {
  const match = input.match(/leetcode\.com\/problems\/([^/?#\s]+)/i);

  return match?.[1] ?? null;
}

function extractProblemNumber(input: string) {
  const match = input.trim().match(/^(?:lc|leetcode|#)?\s*(\d+)$/i);

  return match ? Number(match[1]) : null;
}

export function resolveProblemInput(
  input: string,
  problems: WorkbenchProblem[],
): ProblemResolution {
  const query = input.trim();

  if (!query) {
    return {
      status: "unknown",
      message: "Type a Hot-150 problem number, title, slug, or LeetCode URL.",
    };
  }

  const slugFromUrl = extractProblemSlug(query);
  const number = extractProblemNumber(query);
  const normalizedQuery = normalizeText(slugFromUrl ?? query);
  const problem = problems.find((candidate) => {
    if (number !== null && candidate.leetcodeNumber === number) {
      return true;
    }

    return (
      normalizeText(candidate.slug) === normalizedQuery ||
      normalizeText(candidate.title) === normalizedQuery
    );
  });

  if (problem) {
    return { status: "resolved", problem };
  }

  return {
    status: "unknown",
    message:
      "This local MVP resolves Hot-150 problems. Check the number, title, slug, or LeetCode URL.",
  };
}
