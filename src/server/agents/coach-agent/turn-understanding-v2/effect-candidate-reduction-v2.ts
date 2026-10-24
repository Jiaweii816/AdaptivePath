import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

import {
  locateRequestedActionEvidenceV2,
  persistCollectionV2,
  type TurnRequestCandidate,
} from "./candidate-reducer-support-v2";
import { maskProtectedProseV2 } from "./protected-prose-v2";
import type {
  ClarificationReason,
  EffectDenial,
  TurnClauseV2,
} from "./turn-understanding-v2.types";

export type SemanticEffectUncertaintyV2 = {
  readonly reason: "alternative_effect_structure" | "hypothetical_effect_scope";
  readonly uncertainEffects: readonly ("execute" | "persist")[];
};

export function correctionCancelsCandidateV2(
  message: string,
  candidate: TurnRequestCandidate,
  denial: EffectDenial,
) {
  const denialStart = Math.min(...denial.evidence.map(({ start }) => start));
  if (!Number.isFinite(denialStart) || denialStart <= candidate.order)
    return false;
  const bridge = maskProtectedProseV2(
    message.slice(candidate.order, denialStart),
  );
  return /算了|等等|改一下|改口|其实不|还是不|\b(?:actually|wait|scratch that|on second thought|no[,\s]|never mind)\b/iu.test(
    bridge,
  );
}

/**
 * Escalates only semantic alternatives or hypothetical side effects. Sentence
 * count and punctuation are intentionally absent from this decision.
 */
export function deriveSemanticEffectUncertaintyV2(
  message: string,
  candidates: readonly TurnRequestCandidate[],
): SemanticEffectUncertaintyV2 | undefined {
  const prose = maskProtectedProseV2(message);
  const candidateEffects = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.kind === "execute" || candidate.kind === "persist"
          ? [candidate.kind]
          : [],
      ),
    ),
  ];
  if (candidateEffects.length === 0) return undefined;

  const hypotheticalEffects = [
    ...new Set(
      candidates.flatMap((candidate) =>
        (candidate.kind === "execute" || candidate.kind === "persist") &&
        effectCandidateIsHypothetical(prose, candidate)
          ? [candidate.kind]
          : [],
      ),
    ),
  ];
  if (hypotheticalEffects.length > 0) {
    return {
      reason: "hypothetical_effect_scope",
      uncertainEffects: hypotheticalEffects,
    };
  }
  const alternative = /(?:还是|或者|或是)|\b(?:or|either)\b/iu;
  const distinctPersistTargets = new Set(
    candidates.flatMap((candidate) =>
      candidate.kind === "persist" ? [candidate.collection] : [],
    ),
  );
  if (
    alternative.test(prose) &&
    (candidateEffects.includes("execute") || distinctPersistTargets.size > 1)
  ) {
    return {
      reason: "alternative_effect_structure",
      uncertainEffects: candidateEffects,
    };
  }
  return undefined;
}

/** A later response condition must not retroactively make an earlier effect hypothetical. */
function effectCandidateIsHypothetical(
  prose: string,
  candidate: TurnRequestCandidate,
) {
  const actionStart = candidate.evidence.reduce(
    (minimum, evidence) => Math.min(minimum, evidence.start),
    candidate.order,
  );
  const priorProse = prose.slice(0, actionStart);
  const lastBoundary = Math.max(
    priorProse.lastIndexOf("。"),
    priorProse.lastIndexOf("."),
    priorProse.lastIndexOf("!"),
    priorProse.lastIndexOf("！"),
    priorProse.lastIndexOf("?"),
    priorProse.lastIndexOf("？"),
    priorProse.lastIndexOf(";"),
    priorProse.lastIndexOf("；"),
    priorProse.lastIndexOf("\n"),
    priorProse.lastIndexOf("\r"),
  );
  const localPrefix = priorProse.slice(lastBoundary + 1);
  return /(?:如果|要是|假如|也许|可能)|\b(?:if|maybe|perhaps|possibly)\b/iu.test(
    localPrefix,
  );
}

export function buildPersistCandidatesV2(
  message: string,
  clauses: readonly TurnClauseV2[],
  actions: readonly RequestedAction[],
) {
  const candidates: TurnRequestCandidate[] = [];
  const denials: EffectDenial[] = [];
  let clarificationReason: ClarificationReason | undefined;
  for (const action of actions) {
    const collection = persistCollectionV2(action.toolName);
    if (!collection) continue;
    const located = locateRequestedActionEvidenceV2(message, clauses, action);
    if (action.decision === "granted") {
      candidates.push({
        kind: "persist",
        collection,
        content: persistContent(message, clauses, located.clauseIndex),
        authorization: "ledger_granted",
        sourceClauseIds: located.clauseIds,
        evidence: located.evidence,
        clauseIndex: located.clauseIndex,
        order: action.order,
      });
    } else if (action.decision === "needs_confirmation") {
      clarificationReason ??= "effect_authorization_unresolved";
    } else {
      denials.push({
        effect: "persist",
        sourceClauseIds: located.clauseIds,
        evidence: located.evidence,
      });
    }
  }
  return { candidates, denials, clarificationReason };
}

function persistContent(
  message: string,
  clauses: readonly TurnClauseV2[],
  clauseIndex: number,
) {
  const start = clauses[clauseIndex]?.start ?? 0;
  const nextBoundaryOffset = clauses
    .slice(clauseIndex + 1)
    .findIndex((clause) => clause.connectorBefore !== undefined);
  const nextBoundaryIndex =
    nextBoundaryOffset < 0 ? -1 : clauseIndex + 1 + nextBoundaryOffset;
  const end =
    nextBoundaryIndex < 0
      ? message.length
      : (clauses[nextBoundaryIndex - 1]?.end ?? clauses[nextBoundaryIndex]!.start);
  return message.slice(start, end).replace(/[，,、\s]+$/u, "").trim();
}
