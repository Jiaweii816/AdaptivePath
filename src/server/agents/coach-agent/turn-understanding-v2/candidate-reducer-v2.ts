import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

import {
  fallbackResponseV2,
  finalizeCandidatesV2,
  type TurnRequestCandidate,
} from "./candidate-reducer-support-v2";
import {
  buildPersistCandidatesV2,
  correctionCancelsCandidateV2,
  deriveSemanticEffectUncertaintyV2,
  type SemanticEffectUncertaintyV2,
} from "./effect-candidate-reduction-v2";
import {
  buildExecuteCandidateV2,
  executeConflictsWithDenialV2,
  type WorkspaceFactsV2,
} from "./execute-candidate-v2";
import { addResponseCandidatesV2, uniqueEvidenceV2 } from "./response-candidates-v2";
import { annotateClauseSignalsV2 } from "./signal-annotators-v2";
import {
  applyScopedBasisV2,
  linkExplicitTransfersV2,
} from "./scoped-basis-v2";
import type {
  ClarificationReason,
  EffectDenial,
  TurnClauseV2,
  TurnRequest,
} from "./turn-understanding-v2.types";
import {
  applyOrderedDiagnosticSemanticsV2,
  applyWholeTurnDiagnosticDominanceV2,
  attachWholeTurnPresentationV2,
} from "./whole-turn-candidate-reduction-v2";

export type ReduceTurnCandidatesResult = {
  requests: TurnRequest[];
  clarificationReason?: ClarificationReason;
  persistDenials: EffectDenial[];
  semanticUncertainty?: SemanticEffectUncertaintyV2;
};

export function reduceTurnCandidatesV2(args: {
  message: string;
  clauses: readonly TurnClauseV2[];
  workspace: WorkspaceFactsV2;
  requestedActions: readonly RequestedAction[];
  executeDenials: readonly EffectDenial[];
}): ReduceTurnCandidatesResult {
  const candidates: TurnRequestCandidate[] = [];
  let clarificationReason: ClarificationReason | undefined;
  const globalSignals = args.clauses.map(annotateClauseSignalsV2);
  const hasRecallRequest = globalSignals.some(
    ({ basis }) =>
      basis.pastProblems.length > 0 || basis.pastMistakes.length > 0,
  );
  const preferenceScope =
    args.requestedActions.some(
      (action) =>
        action.toolName === "note_memory" && action.decision === "granted",
    ) &&
    /以后|之后|下次|从现在起|往后|默认|\b(?:from now on|going forward|next time|by default)\b/iu.test(
      args.message,
    );

  args.clauses.forEach((clause, clauseIndex) => {
    const signals = globalSignals[clauseIndex];
    addResponseCandidatesV2(candidates, {
      clause,
      clauseIndex,
      signals,
      hasRecallRequest,
      preferenceScope,
      message: args.message,
    });
    const executeResult = buildExecuteCandidateV2({
      clause,
      clauseIndex,
      signals,
      workspace: args.workspace,
    });
    if (executeResult.candidate) candidates.push(executeResult.candidate);
    clarificationReason ??= executeResult.clarificationReason;
  });

  attachProfileBasisModifiersV2(candidates);
  linkExplicitTransfersV2(candidates, args.message);
  applyScopedBasisV2(candidates, globalSignals, args.clauses, args.message);
  mergeTransferRequestsV2(candidates, args.message);
  applyScopedBasisV2(candidates, globalSignals, args.clauses, args.message);
  applyWholeTurnHistoryDominanceV2(candidates, args.message);

  applyOrderedDiagnosticSemanticsV2(candidates, args.clauses);
  applyWholeTurnDiagnosticDominanceV2(candidates, args.message);
  attachWholeTurnPresentationV2(candidates, args.clauses, globalSignals);

  const correctedExecuteIndexes = candidates.flatMap((candidate, index) =>
    candidate.kind === "execute" &&
    args.executeDenials.some((denial) =>
      correctionCancelsCandidateV2(args.message, candidate, denial),
    )
      ? [index]
      : [],
  );
  for (const index of correctedExecuteIndexes.reverse())
    candidates.splice(index, 1);

  const conflictingExecuteIndexes = candidates.flatMap((candidate, index) =>
    candidate.kind === "execute" &&
    executeConflictsWithDenialV2(candidate.target, args.executeDenials)
      ? [index]
      : [],
  );
  if (conflictingExecuteIndexes.length > 0) {
    for (const index of conflictingExecuteIndexes.reverse())
      candidates.splice(index, 1);
  }

  const persist = buildPersistCandidatesV2(
    args.message,
    args.clauses,
    args.requestedActions,
  );
  candidates.push(...persist.candidates);
  suppressPersistContentResponsesV2(candidates, persist.candidates);
  clarificationReason ??= persist.clarificationReason;

  if (candidates.length === 0 && !clarificationReason) {
    candidates.push(fallbackResponseV2(args.clauses));
  }
  return {
    requests: finalizeCandidatesV2(candidates, args.clauses),
    clarificationReason,
    persistDenials: persist.denials,
    semanticUncertainty: deriveSemanticEffectUncertaintyV2(
      args.message,
      candidates,
    ),
  };
}

function attachProfileBasisModifiersV2(candidates: TurnRequestCandidate[]) {
  const modifierIndexes = candidates.flatMap((candidate, index) =>
    candidate.kind === "respond" &&
    candidate.deliverable === "understand" &&
    candidate.evidence.length > 0 &&
    candidate.evidence.every(({ kind }) => kind === "learner_profile")
      ? [index]
      : [],
  );
  for (const modifierIndex of modifierIndexes.reverse()) {
    const modifier = candidates[modifierIndex];
    if (!modifier || modifier.kind !== "respond") continue;
    const targetIndex = candidates.findIndex(
      (candidate, index) =>
        index !== modifierIndex &&
        candidate.kind === "respond" &&
        (candidate.deliverable === "understand" ||
          candidate.deliverable === "solve"),
    );
    const target = candidates[targetIndex];
    if (!target || target.kind !== "respond") continue;
    candidates[targetIndex] = {
      ...target,
      basis: [...new Set([...target.basis, "learner_profile" as const])],
      sourceClauseIds: [
        ...new Set([...modifier.sourceClauseIds, ...target.sourceClauseIds]),
      ],
      evidence: uniqueEvidenceV2([...modifier.evidence, ...target.evidence]),
      order: Math.min(modifier.order, target.order),
    };
    candidates.splice(modifierIndex, 1);
  }
}

function mergeTransferRequestsV2(
  candidates: TurnRequestCandidate[],
  message: string,
) {
  if (!/结合|共同内核|有何不同|有什么不同|\bbased on\b/iu.test(message)) return;
  const understandIndexes = candidates.flatMap((candidate, index) =>
    candidate.kind === "respond" &&
    candidate.deliverable === "understand" &&
    candidate.basis.includes("past_problems")
      ? [index]
      : [],
  );
  if (understandIndexes.length === 0) return;
  const primaryIndex = understandIndexes[0];
  const primary = candidates[primaryIndex];
  if (!primary || primary.kind !== "respond") return;
  const merged = understandIndexes.flatMap((index) => {
    const candidate = candidates[index];
    return candidate?.kind === "respond" ? [candidate] : [];
  });
  const mergedOrder = Math.min(...merged.map(({ order }) => order));
  candidates[primaryIndex] = {
    ...primary,
    target: merged.some(({ target }) => target === "concept") ? "concept" : primary.target,
    basis: [...new Set(merged.flatMap(({ basis }) => basis))].filter(
      (source) => source !== "current_evidence" && source !== "concept_kb",
    ),
    sourceClauseIds: [...new Set(merged.flatMap(({ sourceClauseIds }) => sourceClauseIds))],
    evidence: uniqueEvidenceV2(merged.flatMap(({ evidence }) => evidence)),
    order: mergedOrder,
  };
  for (const index of understandIndexes.slice(1).reverse()) candidates.splice(index, 1);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate?.kind === "respond" && candidate.deliverable === "solve") {
      candidates[index] = {
        ...candidate,
        delivery: { ...candidate.delivery, depth: "hint" },
        dependsOnOrders: [mergedOrder],
      };
    }
  }
}

function applyWholeTurnHistoryDominanceV2(
  candidates: TurnRequestCandidate[],
  message: string,
) {
  const vagueApiHistoryQuestion =
    /(?:容器|这些|这类)\s*API/iu.test(message) &&
    /(?:之前|以前|过去|上次).{0,28}(?:记混|搞混|错过|犯过)|\b(?:previously|before|past).{0,36}(?:confus|mistak|mix)/iu.test(
      message,
    ) &&
    !/帮我回忆|提醒(?:我|下)?|用法|写法|语法|怎么(?:写|用)|如何(?:写|用)|\b(?:remind|syntax|usage|how to)\b/iu.test(
      message,
    );
  if (!vagueApiHistoryQuestion) return;
  const hasHistoryGoal = candidates.some(
    (candidate) =>
      candidate.kind === "respond" &&
      candidate.deliverable === "recall" &&
      candidate.basis.includes("past_mistakes"),
  );
  if (!hasHistoryGoal) return;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate?.kind !== "respond") continue;
    if (candidate.deliverable !== "recall" && candidate.target === "api") {
      candidates.splice(index, 1);
      continue;
    }
    if (candidate.deliverable === "recall") {
      candidates[index] = {
        ...candidate,
        target: "current",
        basis: candidate.basis.filter(
          (source) => source !== "api_kb" && source !== "concept_kb",
        ),
      };
    }
  }
}

function suppressPersistContentResponsesV2(
  candidates: TurnRequestCandidate[],
  persistCandidates: readonly TurnRequestCandidate[],
) {
  const persistClauses = new Set(
    persistCandidates.flatMap(({ sourceClauseIds }) => sourceClauseIds),
  );
  const firstPersistOrder = Math.min(
    ...persistCandidates.map(({ order }) => order),
  );
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const sharesOnlyPersistClauses =
      candidate?.sourceClauseIds.every((clauseId) =>
        persistClauses.has(clauseId),
      ) ?? false;
    const hasEarlierKnowledgeQuestion =
      candidate?.kind === "respond" &&
      candidate.evidence.some(
        (item) =>
          item.start < firstPersistOrder &&
          (item.kind === "api_reference" || item.kind === "concept_target"),
      );
    if (
      candidate?.kind === "respond" &&
      (candidate.order >= firstPersistOrder ||
        (sharesOnlyPersistClauses && !hasEarlierKnowledgeQuestion)) &&
      candidate.evidence.every((item) =>
        ["concept_target", "api_reference", "active_problem_target"].includes(item.kind),
      )
    ) {
      candidates.splice(index, 1);
    }
  }
}
