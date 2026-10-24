import {
  basisForV2,
  deliveryForV2,
  firstEvidenceOffsetV2,
  responseTargetV2,
  type TurnRequestCandidate,
} from "./candidate-reducer-support-v2";
import type { ClauseSignalsV2 } from "./signal-annotators-v2";
import type {
  BasisSource,
  Deliverable,
  SignalEvidence,
  TurnClauseV2,
} from "./turn-understanding-v2.types";

export type ResponseCandidateArgsV2 = {
  clause: TurnClauseV2;
  clauseIndex: number;
  signals: ClauseSignalsV2;
  hasRecallRequest: boolean;
  preferenceScope: boolean;
  message: string;
};

type ResponseOverridesV2 = {
  target?: ReturnType<typeof responseTargetV2>;
  basis?: readonly BasisSource[];
};

export function addPriorityResponseCandidatesV2(
  output: TurnRequestCandidate[],
  args: ResponseCandidateArgsV2,
) {
  const candidates: readonly [Deliverable, readonly SignalEvidence[]][] = [
    ["fix", args.signals.deliverable.failure],
    ["improve", args.signals.deliverable.improve],
    ["recommend", args.signals.deliverable.recommend],
  ];
  for (const [deliverable, evidence] of candidates) {
    if (evidence.length > 0) appendResponseCandidateV2(output, args, deliverable, evidence);
  }
}

export function addOrdinaryResponseCandidatesV2(
  output: TurnRequestCandidate[],
  args: ResponseCandidateArgsV2,
  allowTerminalHistory: boolean,
) {
  const { signals } = args;
  const explicitSolve = solveEvidenceV2(signals);
  const explicitUnderstand = signals.deliverable.understand;
  if (allowTerminalHistory && isTerminalHistoryResponseV2(args, explicitSolve, explicitUnderstand)) {
    appendResponseCandidateV2(output, args, "recall", historyEvidenceV2(signals));
    return;
  }
  addExplicitResponseCandidatesV2(output, args, explicitSolve, explicitUnderstand);
}

function addExplicitResponseCandidatesV2(
  output: TurnRequestCandidate[],
  args: ResponseCandidateArgsV2,
  explicitSolve: readonly SignalEvidence[],
  explicitUnderstand: readonly SignalEvidence[],
) {
  const compoundConcept = explicitSolve.length > 0 && explicitUnderstand.length > 0 &&
    args.signals.target.concept.length > 0;
  const basis = basisForV2(args.signals);
  const overrides = compoundConcept
    ? { basis: basis.filter((source) => source !== "concept_kb") }
    : undefined;
  if (explicitSolve.length > 0)
    appendResponseCandidateV2(output, args, "solve", explicitSolve, {
      ...overrides,
      ...(compoundConcept ? { target: "current" } : {}),
    });
  if (explicitUnderstand.length > 0)
    appendResponseCandidateV2(output, args, "understand", explicitUnderstand, {
      ...overrides,
      ...(compoundConcept ? { target: "concept" } : {}),
    });
  if (explicitSolve.length === 0 && explicitUnderstand.length === 0)
    addImplicitResponseCandidateV2(output, args);
}

function addImplicitResponseCandidateV2(
  output: TurnRequestCandidate[],
  args: ResponseCandidateArgsV2,
) {
  const { signals } = args;
  if (signals.target.api.length > 0 || signals.target.concept.length > 0) {
    appendResponseCandidateV2(output, args, "understand", [
      ...signals.target.api,
      ...signals.target.concept,
    ]);
  } else if (historyEvidenceV2(signals).length > 0) {
    appendResponseCandidateV2(output, args, "understand", historyEvidenceV2(signals));
  }
}

function appendResponseCandidateV2(
  output: TurnRequestCandidate[],
  args: ResponseCandidateArgsV2,
  deliverable: Deliverable,
  primary: readonly SignalEvidence[],
  overrides?: ResponseOverridesV2,
) {
  output.push({
    kind: "respond",
    deliverable,
    target: overrides?.target ?? responseTargetV2(args.signals),
    basis: overrides?.basis ?? basisForV2(args.signals),
    delivery: deliveryForV2(args.signals, args.clause.text),
    sourceClauseIds: [args.clause.id],
    evidence: responseEvidenceV2(args.signals, primary),
    clauseIndex: args.clauseIndex,
    order: firstEvidenceOffsetV2(primary, args.clause.start),
  });
}

function isTerminalHistoryResponseV2(
  args: ResponseCandidateArgsV2,
  explicitSolve: readonly SignalEvidence[],
  explicitUnderstand: readonly SignalEvidence[],
) {
  const history = historyEvidenceV2(args.signals);
  return history.length > 0 && explicitSolve.length === 0 && explicitUnderstand.length === 0 &&
    (isTerminalHistoryRequest(args.clause.text) || isHistoricalSelfQuestion(args.clause.text)) &&
    !(responseTargetV2(args.signals) === "api" && hasExplicitApiReminderRequest(args.clause.text));
}

function responseEvidenceV2(signals: ClauseSignalsV2, primary: readonly SignalEvidence[]) {
  return uniqueEvidenceV2([
    ...primary,
    ...signals.target.current,
    ...signals.target.concept,
    ...signals.target.api,
    ...signals.target.candidate,
    ...historyEvidenceV2(signals),
    ...signals.basis.apiKnowledge,
    ...signals.delivery.hint,
    ...signals.delivery.full,
    ...signals.delivery.pseudocode,
    ...signals.delivery.patch,
    ...signals.delivery.trace,
    ...signals.delivery.count,
  ]);
}

function historyEvidenceV2(signals: ClauseSignalsV2) {
  return [
    ...signals.basis.pastProblems,
    ...signals.basis.pastMistakes,
    ...signals.basis.learnerProfile,
  ];
}

function solveEvidenceV2(signals: ClauseSignalsV2) {
  return [
    ...signals.deliverable.solve,
    ...signals.delivery.hint,
    ...signals.delivery.full,
    ...signals.delivery.pseudocode,
    ...signals.delivery.patch,
  ];
}

function isTerminalHistoryRequest(text: string) {
  return /(?:查|找|回忆|看看|列出|告诉我|报告).{0,24}(?:我|我的|以前|之前|过去|强项|弱项|画像|错|题)|你(?:知道|了解|记得).{0,12}我|\b(?:show|tell|report|recall|find|search|what do you know).{0,32}\b(?:my|me|past|history|profile|mistakes?|problems?|strengths?|weaknesses?)\b/iu.test(
    text,
  );
}

function hasExplicitApiReminderRequest(text: string) {
  return /帮我回忆|提醒(?:我|下)?|用法|写法|语法|怎么(?:写|用)|如何(?:写|用)|\b(?:remind|syntax|usage|how to)\b/iu.test(
    text,
  );
}

function isHistoricalSelfQuestion(text: string) {
  return /(?:我)?(?:之前|以前|过去|上次)?.{0,20}(?:是不是|是否|有没有).{0,20}(?:记混|搞混|犯错|错过|栽过|踩坑)|\b(?:did|have) i\b.{0,40}\b(?:before|previously|in the past)\b/iu.test(
    text,
  );
}

export function uniqueEvidenceV2(evidence: readonly SignalEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.kind}:${item.start}:${item.end}:${item.polarity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
