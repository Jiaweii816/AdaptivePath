import type { DurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";

import type { SemanticClassifierBackendFacts } from "../../turn-classifier/validate-semantic-turn-proposal";
import type { ModelAssemblerOutput } from "./model-assembler.types";

type ModelRequest = ModelAssemblerOutput["requests"][number];
type ExecuteRequest = Extract<ModelRequest, { kind: "execute" }> & {
  readonly authorization: "explicit_grant" | "model_proposed";
};
type PersistRequest = Extract<ModelRequest, { kind: "persist" }> & {
  readonly authorization: "ledger_granted";
};

export type AuthorizedModelRequest =
  | Extract<ModelRequest, { kind: "respond" }>
  | ExecuteRequest
  | PersistRequest;

export type GradedAuthorizationResult = Readonly<{
  requests: readonly AuthorizedModelRequest[];
  pendingPersists: readonly DurableWriteToolName[];
}>;

const PERSIST_TOOL_BY_COLLECTION = {
  preference: "note_memory",
  knowledge_handbook: "save_knowledge_note",
  mistake_book: "save_mistake_book_entry",
} as const satisfies Record<
  Extract<ModelRequest, { kind: "persist" }>['collection'],
  DurableWriteToolName
>;

/** Applies the v3 reversibility tiers before the shared semantic validator. */
export function applyGradedAuthorization(
  output: ModelAssemblerOutput,
  facts: SemanticClassifierBackendFacts,
): GradedAuthorizationResult {
  const pendingPersists: DurableWriteToolName[] = [];
  const requests: AuthorizedModelRequest[] = [];
  for (const request of output.requests) {
    if (conflictsWithDenial(request, output, facts)) continue;
    if (request.kind === "respond") requests.push(request);
    else if (request.kind === "execute") requests.push(...authorizeExecute(request, facts));
    else requests.push(...authorizePersist(request, facts, pendingPersists));
  }
  return { requests, pendingPersists };
}

function authorizeExecute(
  request: Extract<ModelRequest, { kind: "execute" }>,
  facts: SemanticClassifierBackendFacts,
): ExecuteRequest[] {
  if (!workspaceTargetExists(request.target, facts)) return [];
  const authorization = hasGrant(request, facts.executionGrants)
    ? "explicit_grant"
    : "model_proposed";
  return [{ ...request, authorization }];
}

function authorizePersist(
  request: Extract<ModelRequest, { kind: "persist" }>,
  facts: SemanticClassifierBackendFacts,
  pendingPersists: DurableWriteToolName[],
): PersistRequest[] {
  if (hasVerbatimPersistGrant(request, facts)) {
    return [{ ...request, authorization: "ledger_granted" }];
  }
  addPending(pendingPersists, PERSIST_TOOL_BY_COLLECTION[request.collection]);
  return [];
}

function conflictsWithDenial(
  request: ModelRequest,
  output: ModelAssemblerOutput,
  facts: SemanticClassifierBackendFacts,
): boolean {
  const denials = [...output.denials, ...(facts.categoryDenials ?? [])];
  if (denials.some((denial) => denialConflicts(request, denial))) {
    return true;
  }
  return request.kind === "execute"
    ? facts.deniedExecutionTargets?.includes(request.target) === true
    : request.kind === "persist"
      ? facts.deniedPersistCollections?.includes(request.collection) === true
      : false;
}

function denialConflicts(
  request: ModelRequest,
  denial: Pick<ModelAssemblerOutput["denials"][number], "category" | "value">,
): boolean {
  if (denial.category === "effect") return denial.value === request.kind;
  if (denial.category === "target" && request.kind !== "persist") {
    return request.target === denial.value;
  }
  if (request.kind !== "respond") return false;
  if (denial.category === "deliverable") return request.deliverable === denial.value;
  if (denial.category === "basis") return request.basis.includes(denial.value as never);
  return request.delivery.depth === denial.value || request.delivery.form === denial.value;
}

function workspaceTargetExists(
  target: Extract<ModelRequest, { kind: "execute" }>['target'],
  facts: SemanticClassifierBackendFacts,
): boolean {
  return target === "current" ? facts.hasCurrentCode : facts.hasAssistantCandidate;
}

function hasGrant<TTarget extends string>(
  request: { target: TTarget; sourceClauseIds: readonly string[] },
  grants: readonly { target: TTarget; sourceClauseIds: readonly string[] }[],
): boolean {
  return grants.some(
    (grant) =>
      grant.target === request.target &&
      grant.sourceClauseIds.some((id) => request.sourceClauseIds.includes(id)),
  );
}

function hasVerbatimPersistGrant(
  request: Extract<ModelRequest, { kind: "persist" }>,
  facts: SemanticClassifierBackendFacts,
): boolean {
  return facts.persistGrants.some(
    (grant) =>
      grant.target === request.collection &&
      grant.content === request.content &&
      grant.sourceClauseIds.some((id) => request.sourceClauseIds.includes(id)),
  );
}

function addPending(
  pendingPersists: DurableWriteToolName[],
  toolName: DurableWriteToolName,
) {
  if (!pendingPersists.includes(toolName)) pendingPersists.push(toolName);
}
