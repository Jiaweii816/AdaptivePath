import {
  annotateClauseSignalsV2,
  collectNegatedDeliverySignalsV2,
} from "../signal-annotators-v2";
import type {
  EffectDenial,
  SignalEvidence,
  TurnClauseV2,
} from "../turn-understanding-v2.types";
import type { EvidenceCategory, IntentEvidence } from "./intent-evidence.types";

type SignalGroup = "deliverable" | "target" | "basis" | "delivery" | "effect";
type SignalBuckets = Record<string, readonly SignalEvidence[]>;
type SignalValue = readonly [EvidenceCategory, string];
type UnnumberedEvidence = Omit<IntentEvidence, "id">;

/** Maps the nested ClauseSignalsV2 shape onto canonical category values. */
const SIGNAL_VALUE_MAP: Readonly<Record<SignalGroup, Readonly<Record<string, SignalValue>>>> = {
  deliverable: {
    solve: ["deliverable", "solve"],
    failure: ["deliverable", "fix"],
    improve: ["deliverable", "improve"],
    understand: ["deliverable", "understand"],
    recommend: ["deliverable", "recommend"],
  },
  target: {
    current: ["target", "current"],
    concept: ["target", "concept"],
    api: ["target", "api"],
    candidate: ["target", "candidate"],
  },
  basis: {
    pastProblems: ["basis", "past_problems"],
    pastMistakes: ["basis", "past_mistakes"],
    learnerProfile: ["basis", "learner_profile"],
    apiKnowledge: ["basis", "api_kb"],
  },
  delivery: {
    hint: ["delivery", "hint"],
    full: ["delivery", "full"],
    pseudocode: ["delivery", "pseudocode"],
    patch: ["delivery", "patch"],
    trace: ["delivery", "trace"],
    count: ["delivery", "count"],
  },
  effect: {
    execute: ["effect", "execute"],
    observedOutput: ["effect", "execute"],
  },
};

export function collectTurnEvidence(
  clauses: readonly TurnClauseV2[],
  options: { readonly effectDenials?: readonly EffectDenial[] } = {},
): IntentEvidence[] {
  const fromSignals = clauses.flatMap((clause) =>
    [
      ...flattenClauseSignals(clause, annotateClauseSignalsV2(clause)),
      ...flattenNegatedDeliverySignals(clause),
    ],
  );
  const fromDenials = (options.effectDenials ?? []).flatMap((denial) =>
    denial.evidence.map((item) => ({
      clauseId: item.sourceClauseId ?? denial.sourceClauseIds[0] ?? "c0",
      start: item.start,
      end: item.end,
      category: "effect" as const,
      value: denial.effect,
      polarity: "deny" as const,
      strength: item.strength,
      patternKind: item.kind,
    })),
  );
  return [...fromSignals, ...fromDenials]
    .sort(compareEvidenceSpans)
    .map((item, index) => ({ ...item, id: `ev${index}` }));
}

function flattenNegatedDeliverySignals(
  clause: TurnClauseV2,
): UnnumberedEvidence[] {
  const signals = collectNegatedDeliverySignalsV2(clause);
  return [
    ...signals.hint.map((item) => toIntentEvidence(item, clause, ["delivery", "hint"])),
    ...signals.full.map((item) => toIntentEvidence(item, clause, ["delivery", "full"])),
  ];
}

function flattenClauseSignals(
  clause: TurnClauseV2,
  signals: Record<SignalGroup, SignalBuckets>,
): UnnumberedEvidence[] {
  return (Object.entries(signals) as [SignalGroup, SignalBuckets][]).flatMap(
    ([group, buckets]) => flattenSignalBuckets(clause, group, buckets),
  );
}

function flattenSignalBuckets(
  clause: TurnClauseV2,
  group: SignalGroup,
  buckets: SignalBuckets,
): UnnumberedEvidence[] {
  return Object.entries(buckets).flatMap(([bucket, evidence]) => {
    const mapped = SIGNAL_VALUE_MAP[group][bucket];
    return mapped ? evidence.map((item) => toIntentEvidence(item, clause, mapped)) : [];
  });
}

function toIntentEvidence(
  item: SignalEvidence,
  clause: TurnClauseV2,
  [category, value]: SignalValue,
): UnnumberedEvidence {
  return {
    clauseId: item.sourceClauseId ?? clause.id,
    start: item.start,
    end: item.end,
    category,
    value,
    polarity: item.polarity === "negative" ? "deny" : "assert",
    strength: item.strength,
    patternKind: item.kind,
  };
}

function compareEvidenceSpans(
  left: UnnumberedEvidence,
  right: UnnumberedEvidence,
): number {
  return left.start - right.start || left.end - right.end;
}
