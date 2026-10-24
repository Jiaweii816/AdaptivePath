import {
  deliveryForV2,
  type TurnRequestCandidate,
} from "./candidate-reducer-support-v2";
import {
  hasInlineCodeGroundingV2,
  maskProtectedProseV2,
} from "./protected-prose-v2";
import { uniqueEvidenceV2 } from "./response-candidates-v2";
import type { ClauseSignalsV2 } from "./signal-annotators-v2";
import type { TurnClauseV2 } from "./turn-understanding-v2.types";

export function applyWholeTurnDiagnosticDominanceV2(
  candidates: TurnRequestCandidate[],
  message: string,
) {
  if (!hasInlineCodeGroundingV2(message)) return;
  const diagnosticIndex = candidates.findIndex(
    (candidate) =>
      candidate.kind === "respond" && candidate.deliverable === "fix",
  );
  if (diagnosticIndex < 0) return;
  const diagnostic = candidates[diagnosticIndex];
  if (!diagnostic || diagnostic.kind !== "respond") return;
  candidates[diagnosticIndex] = {
    ...diagnostic,
    target: "current",
  };
}

export function applyOrderedDiagnosticSemanticsV2(
  candidates: TurnRequestCandidate[],
  clauses: readonly TurnClauseV2[],
) {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate?.kind !== "respond" || candidate.deliverable !== "understand") continue;
    const clause = clauses[candidate.clauseIndex];
    if (clause?.connectorBefore !== "then") continue;
    const followsExecute = candidates.some(
      (prior) => prior.kind === "execute" && prior.order < candidate.order,
    );
    if (!followsExecute || !isDiagnosticFollowupV2(candidate, clause, clauses)) continue;
    const diagnostic = candidates.find(
      (prior) => prior.kind === "respond" && prior.deliverable === "fix" &&
        prior.order <= candidate.order,
    );
    if (!diagnostic) continue;
    candidates[index] = {
      ...candidate,
      dependsOnOrders: [...new Set([...(candidate.dependsOnOrders ?? []), diagnostic.order])],
    };
  }
}

function isDiagnosticFollowupV2(
  candidate: Extract<TurnRequestCandidate, { kind: "respond" }>,
  clause: TurnClauseV2 | undefined,
  clauses: readonly TurnClauseV2[],
) {
  const whyFailure = /(?:为什么.{0,32}(?:没|没有|不|失败|错误|跳过|卡住)|\bwhy\b.{0,40}\b(?:fail|skip|wrong|not|doesn['’]t|isn['’]t)\b)/iu.test(
    maskProtectedProseV2(clause?.text ?? ""),
  );
  return whyFailure || isFailedOutcomeConditionV2(clauses[candidate.clauseIndex - 1]?.text ?? "");
}

function isFailedOutcomeConditionV2(text: string) {
  return /^(?:如果|要是|假如).{0,32}(?:失败|没通过|不通过|报错)|^\s*if\b.{0,32}\b(?:fails?|failed|errors?|doesn['’]t pass)\b/iu.test(
    maskProtectedProseV2(text),
  );
}

export function attachWholeTurnPresentationV2(
  candidates: TurnRequestCandidate[],
  clauses: readonly TurnClauseV2[],
  signals: readonly ClauseSignalsV2[],
) {
  const modifierClauseIndexes = clauses.flatMap((clause, index) =>
    isPresentationOnlyFragment(clause.text) &&
    clause.connectorBefore !== "then" &&
    clause.connectorBefore !== "and"
      ? [index]
      : [],
  );
  if (modifierClauseIndexes.length === 0) return;

  for (const clauseIndex of modifierClauseIndexes) {
    const responseIndexes = candidates.flatMap((candidate, index) =>
      candidate.kind === "respond" ? [index] : [],
    );
    const syntheticIndexes = responseIndexes.filter(
      (index) => candidates[index]?.clauseIndex === clauseIndex,
    );
    const externalIndexes = responseIndexes.filter(
      (index) => candidates[index]?.clauseIndex !== clauseIndex,
    );
    if (externalIndexes.length === 0) continue;

    // A presentation fragment constrains another semantic response; it is not
    // a second request merely because punctuation gave it a separate span.
    for (const index of syntheticIndexes.reverse()) candidates.splice(index, 1);
    const targetIndex = candidates.reduce<number | undefined>(
      (best, candidate, index) => {
        if (
          candidate.kind !== "respond" ||
          candidate.clauseIndex === clauseIndex
        )
          return best;
        if (best === undefined) return index;
        const currentDistance = Math.abs(candidate.clauseIndex - clauseIndex);
        const bestDistance = Math.abs(
          (candidates[best]?.clauseIndex ?? 0) - clauseIndex,
        );
        return currentDistance < bestDistance ||
          (currentDistance === bestDistance &&
            candidate.clauseIndex < clauseIndex)
          ? index
          : best;
      },
      undefined,
    );
    if (targetIndex === undefined) continue;
    const target = candidates[targetIndex];
    if (!target || target.kind !== "respond") continue;
    const modifier = deliveryForV2(
      signals[clauseIndex],
      clauses[clauseIndex]?.text ?? "",
    );
    const constrained = {
      ...target,
      delivery: {
        depth: signals[clauseIndex]?.delivery.hint.length
          ? ("hint" as const)
          : signals[clauseIndex]?.delivery.full.length
            ? ("full" as const)
            : target.delivery.depth,
        form:
          modifier.form !== "prose"
            ? modifier.form
            : target.delivery.form,
        ...(modifier.count
          ? { count: modifier.count }
          : target.delivery.count
            ? { count: target.delivery.count }
            : {}),
      },
      sourceClauseIds: [
        ...new Set([
          ...target.sourceClauseIds,
          clauses[clauseIndex]?.id ?? "c0",
        ]),
      ],
      evidence: [
        ...target.evidence,
        ...signals[clauseIndex].delivery.hint,
        ...signals[clauseIndex].delivery.pseudocode,
        ...signals[clauseIndex].delivery.patch,
        ...signals[clauseIndex].delivery.full,
        ...signals[clauseIndex].delivery.trace,
        ...signals[clauseIndex].delivery.count,
      ],
    };
    candidates[targetIndex] = constrained;
    for (let index = 0; index < candidates.length; index += 1) {
      const peer = candidates[index];
      if (
        index === targetIndex ||
        peer?.kind !== "respond" ||
        peer.deliverable !== constrained.deliverable ||
        peer.target !== constrained.target ||
        clauses[peer.clauseIndex]?.connectorBefore === "then" ||
        clauses[peer.clauseIndex]?.connectorBefore === "and"
      ) {
        continue;
      }
      candidates[index] = {
        ...peer,
        delivery: constrained.delivery,
        sourceClauseIds: [
          ...new Set([
            ...peer.sourceClauseIds,
            clauses[clauseIndex]?.id ?? "c0",
          ]),
        ],
        evidence: uniqueEvidenceV2([
          ...peer.evidence,
          ...signals[clauseIndex].delivery.hint,
          ...signals[clauseIndex].delivery.pseudocode,
          ...signals[clauseIndex].delivery.patch,
          ...signals[clauseIndex].delivery.full,
          ...signals[clauseIndex].delivery.trace,
          ...signals[clauseIndex].delivery.count,
        ]),
      };
    }
  }
}

function isPresentationOnlyFragment(text: string) {
  const prose = maskProtectedProseV2(text).trim();
  return (
    /^(?:(?:just|only|as|in|with|make it|use|keep it to)\s+)*(?:(?:one|two|three|\d+)\s+)?(?:small\s+)?(?:hints?|examples?|points?|steps?|pseudocode|pseudo-code|patch|full code|complete code)(?:\s+(?:only|please))?[.!！。]?$/iu.test(
      prose,
    ) ||
    /^(?:只\s*)?(?:(?:给|给我|用)\s*)?(?:稍微\s*)?(?:一|两|二|三|\d+)?\s*(?:个|条)?\s*(?:提示|暗示|伪代码|补丁|完整代码|完整实现)(?:一下|就行|即可)?[.!！。]?$/u.test(
      prose,
    )
  );
}
