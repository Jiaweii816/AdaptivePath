import type { TurnUnderstandingV2 } from "../turn-understanding-v2/turn-understanding-v2.types";
import type { CategoryDenial } from "../turn-understanding-v2/evidence/intent-evidence.types";
import type {
  SemanticClassifierOutput,
  SemanticRequestProposal,
} from "./semantic-classifier-output.schema";
import {
  applyGradedAuthorization,
} from "../turn-understanding-v2/assembler/graded-authorization";
import type { ModelAssemblerOutput } from "../turn-understanding-v2/assembler/model-assembler.types";
import type { SemanticRouteInput } from "./semantic-turn-classifier.types";
import { validateSemanticRequests } from "./semantic-turn-validation-core";

export const MIN_SEMANTIC_CLASSIFIER_CONFIDENCE = 0.7;

type ExecuteTarget = Extract<
  SemanticRequestProposal,
  { kind: "execute" }
>["target"];
type PersistCollection = Extract<
  SemanticRequestProposal,
  { kind: "persist" }
>["collection"];

export type SemanticAuthorityGrant<TTarget extends string> = Readonly<{
  target: TTarget;
  /** Clause ids containing backend-verified positive authorization evidence. */
  sourceClauseIds: readonly string[];
  /** Verbatim learner text owned by the deterministic requested-action ledger. */
  content?: string;
}>;

export type SemanticClassifierBackendFacts = Readonly<{
  workspaceLanguage?: string;
  hasCurrentCode: boolean;
  hasAssistantCandidate: boolean;
  executionGrants: readonly SemanticAuthorityGrant<ExecuteTarget>[];
  persistGrants: readonly SemanticAuthorityGrant<PersistCollection>[];
  deniedExecutionTargets?: readonly ExecuteTarget[];
  deniedPersistCollections?: readonly PersistCollection[];
  /** Deterministic denials veto model expansions across every category axis. */
  categoryDenials?: readonly CategoryDenial[];
}>;

export type SemanticValidationReason =
  | "classifier_abstained"
  | "confidence_below_threshold"
  | "duplicate_request_id"
  | "duplicate_request"
  | "unknown_source_clause"
  | "duplicate_dependency"
  | "unknown_dependency"
  | "self_dependency"
  | "forward_dependency"
  | "missing_current_code"
  | "missing_assistant_candidate"
  | "unsupported_execution_language"
  | "invalid_respond_axes"
  | "missing_current_evidence"
  | "duplicate_basis"
  | "disclosure_ceiling_exceeded"
  | "execute_denied_by_user"
  | "execute_not_explicitly_authorized"
  | "persist_denied_by_user"
  | "persist_not_authorized_by_ledger"
  | "persist_content_unavailable"
  | "persist_content_not_verbatim";

export type SemanticValidationResult =
  | { ok: true; understanding: TurnUnderstandingV2 }
  | { ok: false; reason: SemanticValidationReason };

export type ModelAssemblyValidationResult = SemanticValidationResult & {
  readonly pendingPersists: readonly import("@/server/tools/chat-tools/durable-write-types").DurableWriteToolName[];
};

export type AuthorizedSemanticRequest = SemanticRequestProposal & {
  readonly authorization?: "explicit_grant" | "model_proposed" | "ledger_granted";
};

export function validateSemanticTurnProposal(
  output: SemanticClassifierOutput,
  facts: SemanticClassifierBackendFacts,
  deterministic: SemanticRouteInput,
): SemanticValidationResult {
  if (output.certainty.status === "ambiguous") {
    return { ok: false, reason: "classifier_abstained" };
  }
  if (output.certainty.confidence < MIN_SEMANTIC_CLASSIFIER_CONFIDENCE) {
    return { ok: false, reason: "confidence_below_threshold" };
  }
  return validateSemanticRequests(output.requests, facts, deterministic);
}

/** Validates model output only after its reversibility tier has been applied. */
export function validateModelAssemblyProposal(
  output: ModelAssemblerOutput,
  facts: SemanticClassifierBackendFacts,
  deterministic: SemanticRouteInput,
): ModelAssemblyValidationResult {
  const authorized = applyGradedAuthorization(output, facts);
  return {
    ...validateSemanticRequests(authorized.requests, facts, deterministic),
    pendingPersists: authorized.pendingPersists,
  };
}
