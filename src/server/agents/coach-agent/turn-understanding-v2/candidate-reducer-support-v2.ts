import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

import type { ClauseSignalsV2 } from "./signal-annotators-v2";
import type {
  BasisSource,
  ResponseDelivery,
  ResponseTarget,
  SignalEvidence,
  TurnClauseV2,
  TurnRequest,
} from "./turn-understanding-v2.types";

type CandidateFor<Request extends TurnRequest> = Request extends TurnRequest
  ? Omit<Request, "id" | "dependsOn"> & {
      readonly clauseIndex: number;
      readonly order: number;
      /** Internal identity hint; removed before publishing the request. */
      readonly semanticIdentity?: string;
      /** Internal explicit dependencies by candidate source order. */
      readonly dependsOnOrders?: readonly number[];
    }
  : never;

export type TurnRequestCandidate = CandidateFor<TurnRequest>;

export function finalizeCandidatesV2(
  candidates: readonly TurnRequestCandidate[],
  clauses: readonly TurnClauseV2[],
): TurnRequest[] {
  const merged = mergeCandidates(candidates, clauses).sort(
    (left, right) =>
      left.order - right.order || left.clauseIndex - right.clauseIndex,
  );
  const ids = merged.map((_, index) => `req${index}`);
  return merged.map((candidate, index) => {
    const clause = clauses[candidate.clauseIndex];
    const connectorDependencies =
      clause?.connectorBefore === "then"
        ? merged.flatMap((prior, priorIndex) =>
            prior.clauseIndex < candidate.clauseIndex
              ? [ids[priorIndex]]
              : [],
          )
        : [];
    const sameClauseDependencies = merged.flatMap((prior, priorIndex) =>
      priorIndex < index &&
      prior.clauseIndex === candidate.clauseIndex &&
      prior.order < candidate.order &&
      prior.kind === "respond" &&
      candidate.kind === "respond"
        ? [ids[priorIndex]]
        : [],
    );
    const explicitDependencies = merged.flatMap((prior, priorIndex) =>
      priorIndex < index && candidate.dependsOnOrders?.includes(prior.order)
        ? [ids[priorIndex]]
        : [],
    );
    const dependsOn = [
      ...new Set([
        ...connectorDependencies,
        ...sameClauseDependencies,
        ...explicitDependencies,
      ]),
    ];
    const request = { ...candidate } as Record<string, unknown>;
    delete request.clauseIndex;
    delete request.order;
    delete request.semanticIdentity;
    delete request.dependsOnOrders;
    return { ...request, id: ids[index], dependsOn } as unknown as TurnRequest;
  });
}

function mergeCandidates(
  candidates: readonly TurnRequestCandidate[],
  clauses: readonly TurnClauseV2[],
): TurnRequestCandidate[] {
  const merged = new Map<string, TurnRequestCandidate>();
  for (const candidate of candidates) {
    const clause = clauses[candidate.clauseIndex];
    const distinctAnchor =
      clause?.connectorBefore === "then" || clause?.connectorBefore === "and";
    const key = `${candidateSignature(candidate)}:${candidate.semanticIdentity ?? ""}${
      distinctAnchor ? `:anchor:${candidate.clauseIndex}` : ""
    }`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, candidate);
      continue;
    }
    merged.set(key, {
      ...previous,
      sourceClauseIds: [
        ...new Set([
          ...previous.sourceClauseIds,
          ...candidate.sourceClauseIds,
        ]),
      ],
      evidence: [...previous.evidence, ...candidate.evidence],
      order: Math.min(previous.order, candidate.order),
      clauseIndex: Math.min(previous.clauseIndex, candidate.clauseIndex),
    });
  }
  return [...merged.values()];
}

export function fallbackResponseV2(
  clauses: readonly TurnClauseV2[],
): TurnRequestCandidate {
  const clause = clauses[0] ?? {
    id: "c0",
    text: "",
    start: 0,
    end: 0,
  };
  return {
    kind: "respond",
    deliverable: "chat",
    target: "current",
    basis: ["current_evidence"],
    delivery: { depth: "normal", form: "prose" },
    sourceClauseIds: [clause.id],
    evidence: [],
    clauseIndex: 0,
    order: clause.start,
  };
}

export function deliveryForV2(
  signals: ClauseSignalsV2,
  text: string,
): ResponseDelivery {
  const form =
    signals.delivery.trace.length > 0
      ? "trace"
      : signals.delivery.pseudocode.length > 0
          ? "pseudocode"
          : signals.delivery.patch.length > 0 || signals.delivery.full.length > 0
            ? "patch"
            : "prose";
  const count = text.match(
    /(?:\b(\d+)\b|\b(one|two|three)\b|([一两二三]))\s*(?:个|条|道)?\s*(?:同类|类似|相似)?\s*(?:提示|题|例子|要点|步骤|hints?|problems?|examples?|points?|steps?)/iu,
  );
  const token = count?.[1] ?? count?.[2] ?? count?.[3];
  const named: Record<string, number> = {
    一: 1,
    两: 2,
    二: 2,
    三: 3,
    one: 1,
    two: 2,
    three: 3,
  };
  const requestedCount = token
    ? (named[token] ?? Number.parseInt(token, 10))
    : undefined;
  return {
    depth:
      signals.delivery.full.length > 0
        ? "full"
        : signals.delivery.hint.length > 0
          ? "hint"
          : "normal",
    form,
    ...(requestedCount && requestedCount > 0 ? { count: requestedCount } : {}),
  };
}

export function responseTargetV2(
  signals: ClauseSignalsV2,
): ResponseTarget {
  if (signals.target.current.length > 0) return "current";
  if (signals.target.api.length > 0) return "api";
  if (signals.target.concept.length > 0) return "concept";
  return "current";
}

export function basisForV2(signals: ClauseSignalsV2): BasisSource[] {
  const basis: BasisSource[] = ["current_evidence"];
  if (signals.basis.pastProblems.length > 0) basis.push("past_problems");
  if (signals.basis.pastMistakes.length > 0) basis.push("past_mistakes");
  if (signals.basis.learnerProfile.length > 0) basis.push("learner_profile");
  if (
    signals.target.concept.length > 0 &&
    signals.target.current.length === 0
  ) {
    basis.push("concept_kb");
  }
  if (signals.target.api.length > 0) basis.push("api_kb");
  if (signals.basis.apiKnowledge.length > 0) basis.push("api_kb");
  if (signals.deliverable.recommend.length > 0) basis.push("practice_catalog");
  return [...new Set(basis)];
}

export function persistCollectionV2(
  toolName: RequestedAction["toolName"],
): Extract<TurnRequest, { kind: "persist" }>["collection"] | undefined {
  if (toolName === "note_memory") return "preference";
  if (toolName === "save_knowledge_note") return "knowledge_handbook";
  if (toolName === "save_mistake_book_entry") return "mistake_book";
  return undefined;
}

export function locateRequestedActionEvidenceV2(
  message: string,
  clauses: readonly TurnClauseV2[],
  action: RequestedAction,
) {
  const source = action.evidence[0]?.clause ?? message;
  const start = Math.max(0, message.indexOf(source));
  const clauseIndex = Math.max(
    0,
    clauses.findIndex(
      (clause) => start >= clause.start && start < clause.end,
    ),
  );
  const clause = clauses[clauseIndex] ?? {
    id: "c0",
    text: message,
    start: 0,
    end: message.length,
  };
  const sourceFitsClause =
    start >= clause.start && start + source.length <= clause.end;
  const span = sourceFitsClause ? source : clause.text;
  const spanStart = sourceFitsClause ? start : clause.start;
  return {
    clauseIndex,
    clauseIds: [clause.id],
    content: clause.text,
    evidence: [
      {
        kind: "ledger_decision",
        span,
        start: spanStart,
        end: spanStart + span.length,
        sourceClauseId: clause.id,
        strength: "hard" as const,
        polarity:
          action.decision === "denied"
            ? "negative" as const
            : "positive" as const,
      },
    ],
  };
}

function candidateSignature(candidate: TurnRequestCandidate) {
  return candidate.kind === "respond"
    ? `${candidate.kind}:${candidate.deliverable}:${candidate.target}:${candidate.delivery.depth}:${candidate.delivery.form}:${[...candidate.basis].sort().join(",")}`
    : candidate.kind === "execute"
      ? `${candidate.kind}:${candidate.target}`
      : `${candidate.kind}:${candidate.collection}:${candidate.content}`;
}

export function firstEvidenceOffsetV2(
  evidence: readonly SignalEvidence[],
  fallback: number,
) {
  const offset = evidence.reduce(
    (minimum, item) => Math.min(minimum, item.start),
    Number.POSITIVE_INFINITY,
  );
  return Number.isFinite(offset) ? offset : fallback;
}

export function hasConversationReferenceV2(text: string) {
  return /这个|那个|这段|那段|刚才|上面|它|再次|再解释|再说|\b(?:that|it|again|the above)\b/iu.test(
    text,
  );
}
