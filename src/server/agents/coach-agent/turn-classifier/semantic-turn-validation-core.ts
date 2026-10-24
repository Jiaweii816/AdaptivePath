import type {
  EffectDenial,
  SignalEvidence,
  TurnClauseV2,
  TurnRequest,
  TurnUnderstandingV2,
} from "../turn-understanding-v2/turn-understanding-v2.types";
import type { SemanticRouteInput } from "./semantic-turn-classifier.types";
import type {
  AuthorizedSemanticRequest,
  SemanticClassifierBackendFacts,
  SemanticValidationReason,
  SemanticValidationResult,
} from "./validate-semantic-turn-proposal";

export function validateSemanticRequests(
  requests: readonly AuthorizedSemanticRequest[],
  facts: SemanticClassifierBackendFacts,
  deterministic: SemanticRouteInput,
): SemanticValidationResult {
  const structuralError = validateStructure(requests, deterministic.clauses);
  if (structuralError) return { ok: false, reason: structuralError };
  for (const request of requests) {
    const reason = validateRequest(request, facts, deterministic);
    if (reason) return { ok: false, reason };
  }
  return { ok: true, understanding: materializeUnderstanding(requests, deterministic) };
}

function validateStructure(
  requests: readonly AuthorizedSemanticRequest[],
  clauses: readonly TurnClauseV2[],
): SemanticValidationReason | undefined {
  const clauseIds = new Set(clauses.map(({ id }) => id));
  const ids = new Map<string, number>();
  const semanticKeys = new Set<string>();
  for (const [index, request] of requests.entries()) {
    if (ids.has(request.id)) return "duplicate_request_id";
    ids.set(request.id, index);
    if (request.sourceClauseIds.some((id) => !clauseIds.has(id))) {
      return "unknown_source_clause";
    }
    const key = semanticRequestKey(request);
    if (semanticKeys.has(key)) return "duplicate_request";
    semanticKeys.add(key);
  }
  return validateDependencies(requests, ids);
}

function semanticRequestKey(request: AuthorizedSemanticRequest): string {
  if (request.kind === "execute") return `${request.kind}:${request.target}`;
  if (request.kind === "persist") {
    return `${request.kind}:${request.collection}:${request.content}`;
  }
  return [
    request.kind,
    request.deliverable,
    request.target,
    [...request.basis].sort().join(","),
    request.delivery.depth,
    request.delivery.form,
    request.delivery.count ?? "",
  ].join(":");
}

function validateDependencies(
  requests: readonly AuthorizedSemanticRequest[],
  ids: ReadonlyMap<string, number>,
): SemanticValidationReason | undefined {
  for (const [index, request] of requests.entries()) {
    if (new Set(request.dependsOn).size !== request.dependsOn.length) {
      return "duplicate_dependency";
    }
    for (const dependency of request.dependsOn) {
      const dependencyIndex = ids.get(dependency);
      if (dependencyIndex === undefined) return "unknown_dependency";
      if (dependency === request.id) return "self_dependency";
      if (dependencyIndex >= index) return "forward_dependency";
    }
  }
  return undefined;
}

function validateRequest(
  request: AuthorizedSemanticRequest,
  facts: SemanticClassifierBackendFacts,
  deterministic: SemanticRouteInput,
): SemanticValidationReason | undefined {
  if (request.kind === "execute") {
    return validateExecute(request, facts, deterministic.effectDenials);
  }
  if (request.kind === "persist") {
    return validatePersist(request, facts, deterministic.effectDenials);
  }
  if (new Set(request.basis).size !== request.basis.length) return "duplicate_basis";
  if (!request.basis.includes("current_evidence")) return "missing_current_evidence";
  if (!hasValidRespondAxes(request)) return "invalid_respond_axes";
  return request.delivery.depth === "full" && deterministic.disclosure.ceiling !== "full_code"
    ? "disclosure_ceiling_exceeded"
    : undefined;
}

function validateExecute(
  request: Extract<AuthorizedSemanticRequest, { kind: "execute" }>,
  facts: SemanticClassifierBackendFacts,
  denials: readonly EffectDenial[],
): SemanticValidationReason | undefined {
  if (request.target === "current" && !facts.hasCurrentCode) return "missing_current_code";
  if (request.target === "candidate" && !facts.hasAssistantCandidate) {
    return "missing_assistant_candidate";
  }
  if (facts.workspaceLanguage?.toLowerCase() !== "python") {
    return "unsupported_execution_language";
  }
  if (denials.some(({ effect }) => effect === "execute") ||
      facts.deniedExecutionTargets?.includes(request.target)) {
    return "execute_denied_by_user";
  }
  if (request.authorization === "model_proposed") return undefined;
  return hasGrant(request, facts.executionGrants)
    ? undefined
    : "execute_not_explicitly_authorized";
}

function validatePersist(
  request: Extract<AuthorizedSemanticRequest, { kind: "persist" }>,
  facts: SemanticClassifierBackendFacts,
  denials: readonly EffectDenial[],
): SemanticValidationReason | undefined {
  if (denials.some(({ effect }) => effect === "persist") ||
      facts.deniedPersistCollections?.includes(request.collection)) {
    return "persist_denied_by_user";
  }
  const grants = facts.persistGrants.filter((grant) =>
    grant.target === request.collection &&
    grant.sourceClauseIds.some((id) => request.sourceClauseIds.includes(id)));
  if (grants.length === 0) return "persist_not_authorized_by_ledger";
  if (grants.every(({ content }) => content === undefined)) {
    return "persist_content_unavailable";
  }
  return grants.some(({ content }) => content === request.content)
    ? undefined
    : "persist_content_not_verbatim";
}

function hasGrant<TTarget extends string>(
  request: { target: TTarget; sourceClauseIds: readonly string[] },
  grants: readonly { target: TTarget; sourceClauseIds: readonly string[] }[],
): boolean {
  return grants.some((grant) => grant.target === request.target &&
    grant.sourceClauseIds.some((id) => request.sourceClauseIds.includes(id)));
}

function hasValidRespondAxes(
  request: Extract<AuthorizedSemanticRequest, { kind: "respond" }>,
): boolean {
  if (request.deliverable === "recommend") return request.basis.includes("practice_catalog");
  if (request.deliverable === "recall") {
    return request.basis.some((basis) =>
      basis === "past_problems" || basis === "past_mistakes" || basis === "learner_profile");
  }
  return request.deliverable !== "fix" && request.deliverable !== "improve" ||
    request.target === "current";
}

function materializeUnderstanding(
  requests: readonly AuthorizedSemanticRequest[],
  deterministic: SemanticRouteInput,
): TurnUnderstandingV2 {
  return {
    ...withoutRoute(deterministic),
    requests: requests.map((request) => materializeRequest(request, deterministic.clauses)),
    route: { kind: "fast_path", escalationReasons: [] },
  };
}

function materializeRequest(
  request: AuthorizedSemanticRequest,
  clauses: readonly TurnClauseV2[],
): TurnRequest {
  const evidence = buildEvidence(request.sourceClauseIds, clauses);
  if (request.kind === "execute") {
    return { ...request, authorization: request.authorization === "model_proposed"
      ? "model_proposed" : "explicit_grant", evidence };
  }
  if (request.kind === "persist") {
    return { ...request, authorization: "ledger_granted", evidence };
  }
  return { ...request, evidence };
}

function buildEvidence(
  sourceClauseIds: readonly string[],
  clauses: readonly TurnClauseV2[],
): SignalEvidence[] {
  const wanted = new Set(sourceClauseIds);
  return clauses.filter(({ id }) => wanted.has(id)).map((clause) => ({
    kind: "llm_classifier", span: clause.text, strength: "soft", polarity: "positive",
    start: clause.start, end: clause.end, sourceClauseId: clause.id,
  }));
}

function withoutRoute(deterministic: SemanticRouteInput): Omit<SemanticRouteInput, "route"> {
  return {
    schemaVersion: deterministic.schemaVersion,
    clauses: deterministic.clauses,
    coverage: deterministic.coverage,
    requests: deterministic.requests,
    disclosure: deterministic.disclosure,
    categoryDenials: deterministic.categoryDenials,
    effectDenials: deterministic.effectDenials,
    languageScope: deterministic.languageScope,
    affect: deterministic.affect,
    discourse: deterministic.discourse,
  };
}
