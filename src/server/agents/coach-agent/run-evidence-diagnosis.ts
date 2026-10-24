import type { CodeRunResult } from "@/types/code-runner";
import type { CoachDiagnosis } from "@/types/coach";

// Deterministic diagnosis rebuilt purely from run evidence. It deliberately
// proposes no memory facts because no structured model diagnosis was available.
export function buildRunEvidenceDiagnosis(args: {
  problemSlug: string;
  problemTags: string[];
  runResult: CodeRunResult;
}): CoachDiagnosis {
  const failed = args.runResult.firstFailedCase;

  return {
    problemSlug: args.problemSlug,
    runStatus: args.runResult.status,
    userIssueSummary: failed
      ? `${failed.label}: expected ${compactValue(failed.expected)}, actual ${compactValue(failed.actual ?? failed.error)}.`
      : args.runResult.errorDetail
        ? `${args.runResult.errorDetail.title}: ${args.runResult.errorDetail.summary}`
      : `Runner status: ${args.runResult.status}.`,
    coachSummary:
      "Diagnosis metadata was rebuilt from run evidence because structured diagnosis was unavailable.",
    mistakeTags:
      args.runResult.status === "passed_visible_tests"
        ? []
        : [`run_status_${args.runResult.status}`],
    skillTags: args.problemTags,
    selfCheck: null,
    memoryUpdateCandidate: {
      facts: [],
      summary:
        "Skipped L2 fact updates because structured diagnosis metadata was unavailable.",
    },
  };
}

function compactValue(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
