import type { TurnRequestCandidate } from "./candidate-reducer-support-v2";
import type { ClauseSignalsV2 } from "./signal-annotators-v2";
import type { BasisSource, TurnClauseV2 } from "./turn-understanding-v2.types";

const TRANSFER_CONNECTOR = /结合|共同内核|基于|根据|\bbased on\b/iu;

/** Basis stays local unless an explicit transfer depends on an upstream request. */
export function applyScopedBasisV2(
  candidates: TurnRequestCandidate[],
  signals: readonly ClauseSignalsV2[],
  clauses: readonly TurnClauseV2[],
  message: string,
) {
  if (!TRANSFER_CONNECTOR.test(message)) return;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate?.kind !== "respond") continue;
    const inherited = transferBasisForV2(candidate, candidates, signals, clauses);
    candidates[index] = {
      ...candidate,
      basis: [...new Set([...candidate.basis, ...inherited])],
    };
  }
}

export function linkExplicitTransfersV2(
  candidates: TurnRequestCandidate[],
  message: string,
) {
  if (!TRANSFER_CONNECTOR.test(message)) return;
  for (const source of candidates) {
    if (!isPastProblemSourceV2(source)) continue;
    const target = candidates.find(
      (candidate) =>
        candidate.kind === "respond" &&
        candidate.clauseIndex > source.clauseIndex &&
        !(candidate.dependsOnOrders ?? []).includes(source.order),
    );
    if (!target) continue;
    const index = candidates.indexOf(target);
    candidates[index] = {
      ...target,
      dependsOnOrders: [...new Set([...(target.dependsOnOrders ?? []), source.order])],
    };
  }
}

function isPastProblemSourceV2(candidate: TurnRequestCandidate): boolean {
  return candidate.kind === "respond" && candidate.basis.includes("past_problems");
}

function localBasisForV2(
  candidate: TurnRequestCandidate,
  signals: readonly ClauseSignalsV2[],
  clauses: readonly TurnClauseV2[],
): BasisSource[] {
  return candidate.sourceClauseIds.flatMap((clauseId) => {
    const index = clauses.findIndex((clause) => clause.id === clauseId);
    const signal = signals[index];
    return signal ? basisFromSignalsV2(signal) : [];
  });
}

function basisFromSignalsV2(signals: ClauseSignalsV2): BasisSource[] {
  const basis: BasisSource[] = [];
  if (signals.basis.pastProblems.length > 0) basis.push("past_problems");
  if (signals.basis.pastMistakes.length > 0) basis.push("past_mistakes");
  if (signals.basis.learnerProfile.length > 0) basis.push("learner_profile");
  if (signals.target.api.length > 0 || signals.basis.apiKnowledge.length > 0)
    basis.push("api_kb");
  if (signals.target.concept.length > 0 && signals.target.current.length === 0)
    basis.push("concept_kb");
  return basis;
}

function transferBasisForV2(
  candidate: TurnRequestCandidate,
  candidates: readonly TurnRequestCandidate[],
  signals: readonly ClauseSignalsV2[],
  clauses: readonly TurnClauseV2[],
): BasisSource[] {
  return hasPastProblemUpstreamV2(candidate, candidates, signals, clauses)
    ? ["past_problems"]
    : [];
}

function hasPastProblemUpstreamV2(
  candidate: TurnRequestCandidate,
  candidates: readonly TurnRequestCandidate[],
  signals: readonly ClauseSignalsV2[],
  clauses: readonly TurnClauseV2[],
): boolean {
  const pending = [...(candidate.dependsOnOrders ?? [])];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const order = pending.pop();
    if (order === undefined || visited.has(order)) continue;
    visited.add(order);
    const upstream = candidates.find((item) => item.order === order);
    if (!upstream) continue;
    if (localBasisForV2(upstream, signals, clauses).includes("past_problems"))
      return true;
    pending.push(...(upstream.dependsOnOrders ?? []));
  }
  return false;
}
