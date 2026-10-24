import type { HistoryRecallScope } from "../history-recall-scope-guard";
import type {
  RespondTurnRequest,
  TurnRequest,
  TurnUnderstandingV2,
} from "./turn-understanding-v2.types";

function hasHistoryBasis(request: TurnRequest): request is RespondTurnRequest {
  return (
    request.kind === "respond" &&
    request.basis.some(
      (basis) => basis === "past_problems" || basis === "past_mistakes",
    )
  );
}

function isCanonicalHistoryRecall(request: TurnRequest) {
  return hasHistoryBasis(request) && request.deliverable === "recall";
}

/** History claims are guarded from the canonical history subject, not a label. */
export function deriveHistoryRecallScopeV2(
  understanding: Pick<TurnUnderstandingV2, "requests">,
): HistoryRecallScope {
  const hasHistory = understanding.requests.some(hasHistoryBasis);
  if (!hasHistory) return "none";
  return understanding.requests.every(isCanonicalHistoryRecall)
    ? "recall_only"
    : "compound";
}
