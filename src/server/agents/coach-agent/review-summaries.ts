import { isNonVerdict } from "@/lib/evidence-trust";
import type { CodeRunResult } from "@/types/code-runner";
import type { CoachDiagnosis } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";
import type { CoachReviewPlannerContext } from "./coach-agent.types";
import { formatProblemLabel } from "./review-passed-result";

export function summarizeFailedCase(
  runResult: CodeRunResult,
  evidenceVerdict?: EvidenceVerdict,
) {
  if (evidenceVerdict && isNonVerdict(evidenceVerdict)) {
    return evidenceVerdict.scopeLabel;
  }
  if (!runResult.firstFailedCase) return undefined;
  const failed = runResult.firstFailedCase;
  const expected = runResult.expectedOutput ?? stringifyUnknown(failed.expected);
  const actual =
    runResult.actualOutput ?? failed.error ?? stringifyUnknown(failed.actual);
  return `${failed.label}: expected ${expected}, actual ${actual}`;
}

export function summarizeMemoryCandidate(diagnosis: CoachDiagnosis) {
  const candidate = diagnosis.memoryUpdateCandidate;
  if (candidate.summary) return candidate.summary;
  const factTags = candidate.facts.map((fact) => fact.tag);
  return factTags.length > 0
    ? `Candidate facts: ${factTags.join(", ")}`
    : undefined;
}

export function summarizeNextRecommendation(args: {
  runResult: CodeRunResult;
  evidenceVerdict?: EvidenceVerdict;
  planner?: CoachReviewPlannerContext;
}) {
  if (args.evidenceVerdict && isNonVerdict(args.evidenceVerdict)) {
    return "Retry Review My Code after execution evidence is available.";
  }
  if (args.evidenceVerdict?.evidenceClass === "local_only") {
    return args.runResult.status === "passed_visible_tests"
      ? "The selected local visible tests passed; add a meaningful boundary case or verify with the official judge before making any official-success claim."
      : "Apply the coach's next step, then rerun the same selected local visible tests.";
  }
  if (args.runResult.status !== "passed_visible_tests") {
    return "Apply the coach's next step, then run Review My Code again.";
  }
  const next = args.planner?.nextTodayItem;
  if (next) {
    return `After self-rating, continue with ${formatProblemLabel(next)} from Today.`;
  }
  return "After self-rating, return to Today for the next pending item or opt into an optimization discussion.";
}

function stringifyUnknown(value: unknown) {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
