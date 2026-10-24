import type {
  ReviewPipelineDeps,
  ReviewPipelineResult,
} from "./review-pipeline-contract";
import { resolveReviewSetup } from "./review-setup";
import { executeReviewTurn } from "./review-turn";

export async function reviewPipeline(
  rawInput: unknown,
  deps: ReviewPipelineDeps = {},
): Promise<ReviewPipelineResult> {
  const pathStartedAt = Date.now();
  const setup = await resolveReviewSetup(rawInput, deps, pathStartedAt);
  return executeReviewTurn(setup, pathStartedAt);
}

export * from "./review-pipeline-contract";
export {
  buildCoachProblemContext,
  buildCoachUserContext,
  getDemoProblem,
  getLocalUserAndProfile,
  getNextChatSequence,
  inferResponseLanguage,
  loadLatestVisibleUserMessageForReview,
  loadSelectedVisibleTests,
  parseJson,
} from "./review-context";
export { buildNonVerdictReviewResult } from "./review-non-verdict";
export { buildLlmUnavailableResult } from "./review-provider";
export { alignReviewResultWithRunEvidence } from "./review-result-guard";
