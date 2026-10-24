import type {
  SignalEvidence,
  TurnClauseV2,
  TurnUnderstandingV2,
} from "./turn-understanding-v2.types";

export type TurnUnderstandingV2InvariantCode =
  | "duplicate_clause_id"
  | "duplicate_request_id"
  | "unknown_source_clause"
  | "unknown_dependency"
  | "self_dependency"
  | "forward_dependency"
  | "invalid_execute_authorization"
  | "invalid_persist_authorization"
  | "invalid_delivery_count"
  | "empty_persist_content"
  | "invalid_span"
  | "evidence_outside_clause";

export type TurnUnderstandingV2InvariantIssue = {
  readonly code: TurnUnderstandingV2InvariantCode;
  readonly path: string;
};

function validSpan(span: {
  start: number;
  end: number;
  text?: string;
  span?: string;
}): boolean {
  const text = span.text ?? span.span ?? "";
  return (
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end >= span.start &&
    span.end - span.start === text.length
  );
}

function validateEvidence(
  evidence: readonly SignalEvidence[],
  clausesById: ReadonlyMap<string, TurnClauseV2>,
  path: string,
  issues: TurnUnderstandingV2InvariantIssue[],
): void {
  evidence.forEach((item, index) => {
    const evidencePath = `${path}[${index}]`;
    if (!validSpan(item)) {
      issues.push({ code: "invalid_span", path: evidencePath });
    }
    if (!item.sourceClauseId) return;
    const clause = clausesById.get(item.sourceClauseId);
    if (!clause) {
      issues.push({ code: "unknown_source_clause", path: evidencePath });
      return;
    }
    if (item.start < clause.start || item.end > clause.end) {
      issues.push({ code: "evidence_outside_clause", path: evidencePath });
    }
  });
}

function buildClauseIndex(
  understanding: TurnUnderstandingV2,
  issues: TurnUnderstandingV2InvariantIssue[],
): Map<string, TurnClauseV2> {
  const clauses = new Map<string, TurnClauseV2>();
  understanding.clauses.forEach((clause, index) => {
    const path = `clauses[${index}]`;
    if (clauses.has(clause.id)) {
      issues.push({ code: "duplicate_clause_id", path: `${path}.id` });
    } else {
      clauses.set(clause.id, clause);
    }
    if (!validSpan(clause)) {
      issues.push({ code: "invalid_span", path });
    }
  });
  return clauses;
}

export function validateTurnUnderstandingV2Invariants(
  understanding: TurnUnderstandingV2,
): TurnUnderstandingV2InvariantIssue[] {
  const issues: TurnUnderstandingV2InvariantIssue[] = [];
  const clausesById = buildClauseIndex(understanding, issues);
  const requestIndexes = new Map<string, number>();

  understanding.requests.forEach((request, index) => {
    if (requestIndexes.has(request.id)) {
      issues.push({
        code: "duplicate_request_id",
        path: `requests[${index}].id`,
      });
    } else {
      requestIndexes.set(request.id, index);
    }
  });

  understanding.requests.forEach((request, index) => {
    const path = `requests[${index}]`;
    request.sourceClauseIds.forEach((clauseId, sourceIndex) => {
      if (!clausesById.has(clauseId)) {
        issues.push({
          code: "unknown_source_clause",
          path: `${path}.sourceClauseIds[${sourceIndex}]`,
        });
      }
    });
    request.dependsOn.forEach((dependencyId, dependencyIndex) => {
      const dependencyPath = `${path}.dependsOn[${dependencyIndex}]`;
      if (dependencyId === request.id) {
        issues.push({ code: "self_dependency", path: dependencyPath });
        return;
      }
      const targetIndex = requestIndexes.get(dependencyId);
      if (targetIndex === undefined) {
        issues.push({ code: "unknown_dependency", path: dependencyPath });
      } else if (targetIndex >= index) {
        issues.push({ code: "forward_dependency", path: dependencyPath });
      }
    });
    if (
      request.kind === "execute" &&
      request.authorization !== "explicit_grant"
    ) {
      issues.push({
        code: "invalid_execute_authorization",
        path: `${path}.authorization`,
      });
    }
    if (
      request.kind === "persist" &&
      request.authorization !== "ledger_granted"
    ) {
      issues.push({
        code: "invalid_persist_authorization",
        path: `${path}.authorization`,
      });
    }
    if (
      request.kind === "respond" &&
      request.delivery.count !== undefined &&
      (!Number.isInteger(request.delivery.count) || request.delivery.count < 1)
    ) {
      issues.push({
        code: "invalid_delivery_count",
        path: `${path}.delivery.count`,
      });
    }
    if (request.kind === "persist" && request.content.trim().length === 0) {
      issues.push({ code: "empty_persist_content", path: `${path}.content` });
    }
    validateEvidence(request.evidence, clausesById, `${path}.evidence`, issues);
  });

  understanding.effectDenials.forEach((denial, index) => {
    denial.sourceClauseIds.forEach((clauseId, sourceIndex) => {
      if (!clausesById.has(clauseId)) {
        issues.push({
          code: "unknown_source_clause",
          path: `effectDenials[${index}].sourceClauseIds[${sourceIndex}]`,
        });
      }
    });
    validateEvidence(
      denial.evidence,
      clausesById,
      `effectDenials[${index}].evidence`,
      issues,
    );
  });
  validateEvidence(
    [
      ...understanding.discourse.repeatSignals,
      ...understanding.discourse.continuationSignals,
      ...understanding.discourse.referentSignals,
      ...(understanding.languageScope.unsupportedLanguage
        ? [understanding.languageScope.unsupportedLanguage]
        : []),
    ],
    clausesById,
    "signals",
    issues,
  );

  return issues;
}

export function assertTurnUnderstandingV2Invariants(
  understanding: TurnUnderstandingV2,
): void {
  const issues = validateTurnUnderstandingV2Invariants(understanding);
  if (issues.length > 0) {
    throw new Error(
      `Invalid TurnUnderstandingV2: ${issues
        .map(({ code, path }) => `${code}@${path}`)
        .join(", ")}`,
    );
  }
}
