import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

import { reduceTurnCandidatesV2 } from "./candidate-reducer-v2";
import { applyDenialsToRequests } from "./apply-denials";
import { segmentClausesV2 } from "./clause-segmenter-v2";
import { computeTurnCoverage } from "./coverage/turn-coverage";
import { collectTurnEvidence } from "./evidence/collect-turn-evidence";
import { deriveCategoryDenials } from "./evidence/negation-scope";
import {
  annotateDiscourseV2,
  annotateEffectDenialsV2,
  deriveAffectV2,
  deriveDisclosureV2,
  deriveLanguageScopeV2,
} from "./signal-annotators-v2";
import type {
  ClarificationReason,
  EscalationReason,
  TurnClauseV2,
  TurnUnderstandingV2,
} from "./turn-understanding-v2.types";
import { assertTurnUnderstandingV2Invariants } from "./validate-invariants";

export type CompileTurnUnderstandingV2Options = {
  readonly workspace?: {
    readonly hasCurrentCode: boolean;
    readonly hasAssistantCandidate: boolean;
  };
  readonly requestedActions?: readonly RequestedAction[];
};

/**
 * Deterministically compiles language evidence into downstream decisions.
 * It never invokes a model and never treats sentence shape as an escalation signal.
 */
export function compileTurnUnderstandingV2(
  message: string,
  options: CompileTurnUnderstandingV2Options = {},
): TurnUnderstandingV2 {
  const clauses = clausesFor(message);
  const executeDenials = annotateEffectDenialsV2(clauses);
  const workspace = options.workspace ?? {
    hasCurrentCode: true,
    hasAssistantCandidate: false,
  };
  const reduced = reduceTurnCandidatesV2({
    message,
    clauses,
    workspace,
    requestedActions:
      options.requestedActions ?? resolveRequestedActions(message),
    executeDenials,
  });
  const effectDenials = [...executeDenials, ...reduced.persistDenials];
  const evidence = collectTurnEvidence(clauses);
  const categoryDenials = deriveCategoryDenials({
    clauses,
    evidence,
    effectDenials,
  });
  // Denial derivation uses ordinary evidence; coverage additionally counts
  // explicit Effect refusals as understood input.
  const coverageEvidence = collectTurnEvidence(clauses, { effectDenials: executeDenials });
  const effectTargetAmbiguous =
    reduced.clarificationReason === "effect_target_unresolved" ||
    reduced.clarificationReason === "side_effect_candidate_conflict" ||
    hasAmbiguousEffectReference(clauses, workspace);
  const coverage = computeTurnCoverage(message, coverageEvidence);
  const escalationReasons = escalationReasonsFor(
    coverage,
    effectTargetAmbiguous,
    reduced.semanticUncertainty !== undefined,
  );
  const understanding: TurnUnderstandingV2 = {
    schemaVersion: "v2",
    clauses,
    coverage,
    requests: applyDenialsToRequests(reduced.requests, categoryDenials),
    disclosure: deriveDisclosureV2(clauses),
    categoryDenials,
    effectDenials,
    languageScope: deriveLanguageScopeV2(clauses),
    affect: deriveAffectV2(clauses),
    discourse: annotateDiscourseV2(clauses),
    route: routeFor(escalationReasons, reduced.clarificationReason),
  };
  assertTurnUnderstandingV2Invariants(understanding);
  return understanding;
}

function hasAmbiguousEffectReference(
  clauses: readonly TurnClauseV2[],
  workspace: NonNullable<CompileTurnUnderstandingV2Options["workspace"]>,
): boolean {
  if (!workspace.hasCurrentCode || !workspace.hasAssistantCandidate) return false;
  return clauses.some(({ text }) =>
    /跑下|运行|\brun\b/iu.test(text) && /它|\bit\b/iu.test(text),
  );
}

function escalationReasonsFor(
  coverage: TurnUnderstandingV2["coverage"],
  effectTargetAmbiguous: boolean,
  semanticUncertainty: boolean,
): readonly EscalationReason[] {
  const reasons: EscalationReason[] = [];
  if (coverage.resolution === "unknown") reasons.push("low_coverage");
  if (effectTargetAmbiguous || semanticUncertainty) reasons.push("effect_ambiguity");
  return reasons;
}

function routeFor(
  escalationReasons: readonly EscalationReason[],
  clarificationReason: ClarificationReason | undefined,
): TurnUnderstandingV2["route"] {
  if (escalationReasons.length > 0) {
    return { kind: "model_assembled", escalationReasons };
  }
  if (clarificationReason) {
    return { kind: "clarify", escalationReasons: [], clarificationReason };
  }
  return { kind: "fast_path", escalationReasons: [] };
}

function clausesFor(message: string): TurnClauseV2[] {
  const clauses = addConditionalOutcomeDependencies(segmentClausesV2(message));
  return clauses.length > 0
    ? clauses
    : [{ id: "c0", text: "", start: 0, end: 0 }];
}

/** Conditional failure responses semantically follow the run despite sentence punctuation. */
function addConditionalOutcomeDependencies(
  clauses: readonly TurnClauseV2[],
): TurnClauseV2[] {
  return clauses.map((clause, index) => {
    const previous = clauses[index - 1]?.text ?? "";
    const failedOutcome =
      /^(?:如果|要是|假如).{0,32}(?:失败|没通过|不通过|报错)|^\s*if\b.{0,32}\b(?:fails?|failed|errors?|doesn['’]t pass)\b/iu.test(
        previous,
      );
    const responseAnchor =
      /^(?:解释|诊断|说明|告诉|总结|\s*(?:explain|diagnose|tell|summari[sz]e)\b)/iu.test(
        clause.text,
      );
    return failedOutcome && responseAnchor
      ? { ...clause, connectorBefore: "then" as const }
      : clause;
  });
}
