import type { MemoryEpisodeInput } from "@/server/memory/store/episode-store";

export const REVIEW_EPISODE_SALIENCE = {
  failed: 0.7,
  passed: 0.4,
} as const;

export function buildReviewEpisode(args: {
  problemTitle: string;
  problemTags: string[];
  attemptOrdinal: number;
  runResult: { status: string; passedCount: number; failedCount: number };
  evidenceScope?: "official_judge" | "local_visible";
  diagnosis: {
    userIssueSummary?: string;
    coachSummary?: string;
    mistakeTags: string[];
  };
  sourceTraceIds: string[];
}): Omit<
  MemoryEpisodeInput,
  "userId" | "problemId" | "chatSessionId" | "kind"
> & { kind: "review" } {
  const passed = args.runResult.status.startsWith("passed");
  const issue = args.diagnosis.userIssueSummary?.trim();
  const coach = args.diagnosis.coachSummary?.trim();

  return {
    kind: "review",
    title: `${args.problemTitle} review #${args.attemptOrdinal}: ${
      passed ? "passed visible tests" : "needs revision"
    }`,
    summary: [
      args.evidenceScope === "local_visible"
        ? "Evidence scope: selected local visible tests only; not an official LeetCode verdict."
        : args.evidenceScope === "official_judge"
          ? "Evidence scope: LeetCode judge response; hidden-test details remain unavailable."
          : undefined,
      `Run: ${args.runResult.status} (${args.runResult.passedCount} passed, ${args.runResult.failedCount} failed).`,
      issue ? `Issue: ${issue}` : undefined,
      coach ? `Coach: ${coach}` : undefined,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 600),
    outcome: passed ? "passed" : "failed",
    tags: [...new Set([...args.problemTags, ...args.diagnosis.mistakeTags])],
    salience: passed
      ? REVIEW_EPISODE_SALIENCE.passed
      : REVIEW_EPISODE_SALIENCE.failed,
    sourceTraceIds: args.sourceTraceIds,
  };
}
