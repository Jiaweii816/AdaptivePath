import { firstEvidenceOffsetV2, type TurnRequestCandidate } from "./candidate-reducer-support-v2";
import type { ClauseSignalsV2 } from "./signal-annotators-v2";
import type {
  ClarificationReason,
  EffectDenial,
  SignalEvidence,
  TurnClauseV2,
} from "./turn-understanding-v2.types";

export type WorkspaceFactsV2 = {
  readonly hasCurrentCode: boolean;
  readonly hasAssistantCandidate: boolean;
};

export function buildExecuteCandidateV2(args: {
  clause: TurnClauseV2;
  clauseIndex: number;
  signals: ClauseSignalsV2;
  workspace: WorkspaceFactsV2;
}): {
  candidate?: TurnRequestCandidate;
  clarificationReason?: ClarificationReason;
} {
  const evidence = [
    ...args.signals.effect.execute,
    ...args.signals.effect.observedOutput,
  ];
  if (evidence.length === 0) return {};

  const targeted = targetsInPositiveScope(args.signals, evidence);
  const explicitCandidate = targeted.candidate.length > 0;
  const explicitCurrent = targeted.current.length > 0;
  let target: "current" | "candidate" | undefined;
  let clarificationReason: ClarificationReason | undefined;

  if (explicitCandidate && explicitCurrent) {
    clarificationReason = "side_effect_candidate_conflict";
  } else if (explicitCandidate) {
    // The tool contract requires the Coach to supply a complete candidate.
    // A prior assistant candidate is therefore useful referent context, not a
    // prerequisite unless the learner explicitly refers to earlier output.
    if (
      !args.workspace.hasAssistantCandidate &&
      refersToPriorAssistantCandidate(targeted.candidate)
    ) {
      clarificationReason = "backend_target_missing";
    } else {
      target = "candidate";
    }
  } else if (explicitCurrent) {
    if (args.workspace.hasCurrentCode) target = "current";
    else clarificationReason = "backend_target_missing";
  } else if (
    args.workspace.hasCurrentCode !== args.workspace.hasAssistantCandidate
  ) {
    target = args.workspace.hasCurrentCode ? "current" : "candidate";
  } else if (!args.workspace.hasCurrentCode) {
    clarificationReason = "backend_target_missing";
  } else {
    clarificationReason = "effect_target_unresolved";
  }

  if (!target) return { clarificationReason };
  return {
    candidate: {
      kind: "execute",
      target,
      authorization: "explicit_grant",
      sourceClauseIds: [args.clause.id],
      evidence: [
        ...evidence,
        ...targeted.current,
        ...targeted.candidate,
      ],
      clauseIndex: args.clauseIndex,
      order: firstEvidenceOffsetV2(evidence, args.clause.start),
    },
  };
}

function refersToPriorAssistantCandidate(
  evidence: readonly SignalEvidence[],
) {
  return evidence.some(({ span }) =>
    /刚才|上面|之前|前面|上一轮|先前|earlier|previous|above|last turn/iu.test(
      span,
    ),
  );
}

export function executeConflictsWithDenialV2(
  target: "current" | "candidate",
  denials: readonly EffectDenial[],
) {
  return denials.some((denial) => {
    const deniedTarget = denialTarget(denial.evidence);
    return deniedTarget === undefined || deniedTarget === target;
  });
}

function targetsInPositiveScope(
  signals: ClauseSignalsV2,
  evidence: readonly SignalEvidence[],
) {
  const start = Math.min(...evidence.map((item) => item.start));
  const end = Math.max(...evidence.map((item) => item.end)) + 48;
  const inScope = (item: SignalEvidence) =>
    item.start >= start && item.start <= end;
  return {
    current: signals.target.current.filter(inScope),
    candidate: signals.target.candidate.filter(inScope),
  };
}

function denialTarget(evidence: readonly SignalEvidence[]) {
  const text = evidence.map((item) => item.span).join(" ");
  const current =
    /(?:我的)?当前代码|现在的代码|这份代码|我的代码|\b(?:current|my|this)\s+(?:code|implementation)\b/iu.test(
      text,
    );
  const candidate =
    /你的代码|你(?:刚才|上面)?给的候选代码|候选代码|你的改法|这个改法|\b(?:your|assistant|candidate)\s+(?:code|implementation|edit|change)\b/iu.test(
      text,
    );
  if (current === candidate) return undefined;
  return current ? "current" : "candidate";
}
