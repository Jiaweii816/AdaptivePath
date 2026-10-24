import {
  addOrdinaryResponseCandidatesV2,
  addPriorityResponseCandidatesV2,
  type ResponseCandidateArgsV2,
  uniqueEvidenceV2,
} from "./response-candidate-assembly-v2";
import type { TurnRequestCandidate } from "./candidate-reducer-support-v2";

const COMPOUND_DEPENDENCY_ORDER_OFFSET = 0.5;

/** Assemble each deliverable without allowing priority to erase another axis. */
export function addResponseCandidatesV2(
  output: TurnRequestCandidate[],
  args: ResponseCandidateArgsV2,
) {
  if (isPreferenceOnlyDeliveryV2(args)) return;
  const hasPriority = hasPriorityDeliverableV2(args);
  addPriorityResponseCandidatesV2(output, args);
  if (retainsOrdinaryDeliverablesV2(args))
    addOrdinaryResponseCandidatesV2(output, args, !hasPriority);
  prioritizeCompoundExplanationV2(output, args);
}

function isPreferenceOnlyDeliveryV2(args: ResponseCandidateArgsV2) {
  return args.preferenceScope && /^(?:解释|回答|回复).{0,8}(?:短|简短|简洁|详细|长)(?:一?点)?[。.!！]?$/u.test(
    args.clause.text,
  );
}

function hasPriorityDeliverableV2(args: ResponseCandidateArgsV2) {
  const { deliverable } = args.signals;
  return deliverable.failure.length > 0 || deliverable.improve.length > 0 ||
    deliverable.recommend.length > 0;
}

function retainsOrdinaryDeliverablesV2(args: ResponseCandidateArgsV2) {
  const { deliverable } = args.signals;
  return deliverable.failure.length === 0 && deliverable.improve.length === 0 ||
    deliverable.recommend.length > 0;
}

function prioritizeCompoundExplanationV2(
  candidates: TurnRequestCandidate[],
  args: ResponseCandidateArgsV2,
) {
  const explanation = findClauseResponseV2(candidates, args, "understand");
  const recommendation = findClauseResponseV2(candidates, args, "recommend");
  if (!explanation || !recommendation) return;
  candidates[recommendation.index] = {
    ...recommendation.candidate,
    order: explanation.candidate.order + COMPOUND_DEPENDENCY_ORDER_OFFSET,
    dependsOnOrders: [
      ...new Set([
        ...(recommendation.candidate.dependsOnOrders ?? []),
        explanation.candidate.order,
      ]),
    ],
  };
}

function findClauseResponseV2(
  candidates: readonly TurnRequestCandidate[],
  args: ResponseCandidateArgsV2,
  deliverable: "recommend" | "understand",
) {
  const index = candidates.findIndex(
    (candidate) => candidate.kind === "respond" &&
      candidate.deliverable === deliverable &&
      candidate.sourceClauseIds.includes(args.clause.id),
  );
  const candidate = candidates[index];
  return candidate?.kind === "respond" ? { index, candidate } : undefined;
}

export { uniqueEvidenceV2 };
