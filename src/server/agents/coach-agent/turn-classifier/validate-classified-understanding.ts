import type { DurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";

import type {
  Operation,
  OperationTarget,
  TurnClause,
  TurnUnderstanding,
} from "../turn-understanding/turn-understanding.types";
import type { ClassifierOutput } from "./classifier-output.schema";
import {
  hasHintTargetMismatch,
  hasValidFamilyTarget,
  hasValidOperationTopic,
  normalizedDeliveryMode,
} from "./classified-operation-semantics";

export type ExecutionTarget = "current_user_code" | "assistant_candidate";

export type BackendFacts = Readonly<{
  workspaceLanguage?: string;
  hasCurrentCode: boolean;
  /** A pre-loop, same-revision assistant-candidate referent is available. */
  hasAssistantCandidate: boolean;
  deniedExecutionTargets: readonly ExecutionTarget[];
  /** Execute targets explicitly granted by deterministic turn evidence. */
  grantedExecutionTargets: readonly ExecutionTarget[];
  grantedDurableTools: readonly DurableWriteToolName[];
}>;

export type ValidationReason =
  | "invalid_family_target"
  | "invalid_operation_topic"
  | "missing_current_code"
  | "missing_assistant_candidate"
  | "unsupported_execution_language"
  | "execute_denied_by_user"
  | "execute_not_explicitly_authorized"
  | "persist_not_authorized_by_ledger"
  | "granted_persist_missing_from_output"
  | "duplicate_operation"
  | "duplicate_dependency"
  | "dangling_dependency"
  | "self_dependency"
  | "forward_dependency"
  | "dependency_without_then_clause"
  | "hint_target_mismatch"
  | "missing_source_clause_evidence";

export type ClassifiedUnderstandingValidation =
  | { ok: true; understanding: TurnUnderstanding }
  | { ok: false; reason: ValidationReason };

const PERSIST_TARGET_TOOL = {
  preference: "note_memory",
  knowledge_handbook: "save_knowledge_note",
  mistake_book: "save_mistake_book_entry",
} as const satisfies Record<string, DurableWriteToolName>;

const PERSIST_TOOL_TARGET = {
  note_memory: "preference",
  save_knowledge_note: "knowledge_handbook",
  save_mistake_book_entry: "mistake_book",
} as const satisfies Record<DurableWriteToolName, OperationTarget>;

export function validateClassifiedUnderstanding(
  output: ClassifierOutput,
  facts: BackendFacts,
  deterministic: TurnUnderstanding,
): ClassifiedUnderstandingValidation {
  const semantics = validateOperationSemantics(output, facts);
  if (semantics) return { ok: false, reason: semantics };
  if (hasHintTargetMismatch(output, deterministic)) {
    return { ok: false, reason: "hint_target_mismatch" };
  }
  const sources = mapSourceClauses(output, deterministic);
  if (sources.some((clause) => clause.text.length === 0)) {
    return { ok: false, reason: "missing_source_clause_evidence" };
  }
  const dependencies = validateDependencies(output, sources);
  if (dependencies) return { ok: false, reason: dependencies };

  const operations = buildOperations(output, sources);
  const unresolvedOperationIds = operations
    .filter(({ resolution }) => resolution === "ambiguous")
    .map(({ id }) => id);
  return {
    ok: true,
    understanding: {
      ...deterministic,
      operations,
      modifiers: {
        ...deterministic.modifiers,
        deliveryMode: normalizedDeliveryMode(deterministic),
        affect: output.modifiers.affect,
      },
      ambiguity: {
        blocksSideEffect: operations.some(
          ({ family, resolution }) =>
            resolution === "ambiguous" &&
            (family === "execute" || family === "persist"),
        ),
        unresolvedOperationIds,
      },
    },
  };
}

function validateOperationSemantics(
  output: ClassifierOutput,
  facts: BackendFacts,
): ValidationReason | undefined {
  const seen = new Set<string>();
  const granted = new Set(facts.grantedDurableTools);
  const denied = new Set(facts.deniedExecutionTargets);
  const grantedExecution = new Set(facts.grantedExecutionTargets);
  for (const operation of output.operations) {
    const semanticError = validateOneOperation(
      operation,
      facts,
      granted,
      denied,
      grantedExecution,
    );
    if (semanticError) return semanticError;
    const key = `${operation.family}:${operation.target}`;
    if (seen.has(key)) return "duplicate_operation";
    seen.add(key);
  }
  return missingGrantedPersist(output, granted)
    ? "granted_persist_missing_from_output"
    : undefined;
}

function validateOneOperation(
  operation: ClassifierOutput["operations"][number],
  facts: BackendFacts,
  granted: ReadonlySet<DurableWriteToolName>,
  denied: ReadonlySet<ExecutionTarget>,
  grantedExecution: ReadonlySet<ExecutionTarget>,
): ValidationReason | undefined {
  if (!hasValidFamilyTarget(operation)) {
    return "invalid_family_target";
  }
  if (!hasValidOperationTopic(operation)) return "invalid_operation_topic";
  if (operation.target === "current_user_code" && !facts.hasCurrentCode) {
    return "missing_current_code";
  }
  if (
    operation.target === "assistant_candidate" &&
    !facts.hasAssistantCandidate
  ) {
    return "missing_assistant_candidate";
  }
  if (rejectsNonPythonCodeOperation(operation, facts.workspaceLanguage)) {
    return "unsupported_execution_language";
  }
  if (operation.family === "execute") {
    const target = operation.target as ExecutionTarget;
    if (denied.has(target)) {
      return "execute_denied_by_user";
    }
    if (!grantedExecution.has(target)) {
      return "execute_not_explicitly_authorized";
    }
  }
  if (operation.family === "persist") {
    const tool =
      PERSIST_TARGET_TOOL[
        operation.target as keyof typeof PERSIST_TARGET_TOOL
      ];
    if (!tool || !granted.has(tool)) return "persist_not_authorized_by_ledger";
  }
  return undefined;
}

function rejectsNonPythonCodeOperation(
  operation: ClassifierOutput["operations"][number],
  workspaceLanguage: string | undefined,
): boolean {
  const targetsCode =
    operation.target === "current_user_code" ||
    operation.target === "assistant_candidate";
  if (!targetsCode) return false;
  if (operation.family === "execute") return workspaceLanguage !== "Python";
  return (
    (operation.family === "diagnose" || operation.family === "optimize") &&
    workspaceLanguage !== undefined &&
    workspaceLanguage !== "Python"
  );
}

function missingGrantedPersist(
  output: ClassifierOutput,
  granted: ReadonlySet<DurableWriteToolName>,
): boolean {
  const persistedTargets = new Set(
    output.operations
      .filter(({ family }) => family === "persist")
      .map(({ target }) => target),
  );
  return [...granted].some(
    (tool) => !persistedTargets.has(PERSIST_TOOL_TARGET[tool]),
  );
}

function mapSourceClauses(
  output: ClassifierOutput,
  deterministic: TurnUnderstanding,
): TurnClause[] {
  const clauses = deterministic.clauses.length
    ? deterministic.clauses
    : [{ id: "c0", text: "" }];
  const used = new Set<string>();
  return output.operations.map((operation, index) => {
    const match = deterministic.operations.find(
      (candidate) =>
        !used.has(candidate.id) &&
        candidate.family === operation.family &&
        candidate.target === operation.target,
    );
    if (match) {
      used.add(match.id);
      return clauses.find(({ id }) => id === match.sourceClauseId) ?? clauses[0];
    }
    return clauses[Math.min(index, clauses.length - 1)];
  });
}

function validateDependencies(
  output: ClassifierOutput,
  sources: readonly TurnClause[],
): ValidationReason | undefined {
  for (const [index, operation] of output.operations.entries()) {
    const unique = new Set(operation.dependsOn);
    if (unique.size !== operation.dependsOn.length) {
      return "duplicate_dependency";
    }
    for (const dependency of operation.dependsOn) {
      const dependencyIndex = canonicalDependencyIndex(dependency);
      if (dependencyIndex === undefined || dependencyIndex >= output.operations.length) {
        return "dangling_dependency";
      }
      if (dependencyIndex === index) return "self_dependency";
      if (dependencyIndex > index) return "forward_dependency";
    }
    if (operation.dependsOn.length > 0 && sources[index]?.connectorBefore !== "then") {
      return "dependency_without_then_clause";
    }
  }
  return undefined;
}

function canonicalDependencyIndex(dependency: string): number | undefined {
  const match = /^op(0|[1-9]\d*)$/.exec(dependency);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function buildOperations(
  output: ClassifierOutput,
  sources: readonly TurnClause[],
): Operation[] {
  return output.operations.map((operation, index) => ({
    ...operation,
    id: `op${index}`,
    sourceClauseId: sources[index].id,
    orderHint: index,
    evidence: [
      {
        kind: "llm_classifier",
        span: sources[index].text,
        strength: "soft",
        polarity: "positive",
      },
    ],
    resolution:
      operation.family === "execute" || operation.family === "persist"
        ? "explicit"
        : operation.target === "contextual_referent" ||
            operation.target === "unspecified"
          ? "ambiguous"
          : "contextual",
  }));
}
