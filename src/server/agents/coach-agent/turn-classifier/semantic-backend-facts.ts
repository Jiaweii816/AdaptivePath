import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

import {
  locateRequestedActionEvidenceV2,
  persistCollectionV2,
} from "../turn-understanding-v2/candidate-reducer-support-v2";
import { annotateClauseSignalsV2 } from "../turn-understanding-v2/signal-annotators-v2";
import type { TurnUnderstandingV2 } from "../turn-understanding-v2/turn-understanding-v2.types";
import type {
  SemanticAuthorityGrant,
  SemanticClassifierBackendFacts,
} from "./validate-semantic-turn-proposal";

type PersistCollection = NonNullable<ReturnType<typeof persistCollectionV2>>;

export function buildSemanticBackendFacts(args: {
  message: string;
  deterministic: TurnUnderstandingV2;
  requestedActions: readonly RequestedAction[];
  language?: string;
  hasCurrentCode: boolean;
  hasAssistantCandidate: boolean;
}): SemanticClassifierBackendFacts {
  return {
    workspaceLanguage: args.language,
    hasCurrentCode: args.hasCurrentCode,
    hasAssistantCandidate: args.hasAssistantCandidate,
    executionGrants: executionGrants(args),
    persistGrants: persistGrants(args),
    deniedExecutionTargets: deniedExecutionTargets(args.deterministic),
    deniedPersistCollections: deniedPersistCollections(args),
    categoryDenials: args.deterministic.categoryDenials,
  };
}

function executionGrants(args: {
  deterministic: TurnUnderstandingV2;
  hasCurrentCode: boolean;
  hasAssistantCandidate: boolean;
}) {
  const grants: SemanticAuthorityGrant<"current" | "candidate">[] = [];
  for (const clause of args.deterministic.clauses) {
    if (isExecutionDenied(clause.id, args.deterministic)) continue;
    const signals = annotateClauseSignalsV2(clause);
    if (!signals.effect.execute.length && !signals.effect.observedOutput.length) continue;
    const current = signals.target.current.length > 0;
    const candidate = signals.target.candidate.length > 0;
    if ((current || !candidate) && args.hasCurrentCode) {
      grants.push({ target: "current", sourceClauseIds: [clause.id] });
    }
    if ((candidate || !current) && args.hasAssistantCandidate) {
      grants.push({ target: "candidate", sourceClauseIds: [clause.id] });
    }
  }
  return grants;
}

function isExecutionDenied(clauseId: string, understanding: TurnUnderstandingV2) {
  return understanding.effectDenials.some((denial) =>
    denial.effect === "execute" && denial.sourceClauseIds.includes(clauseId));
}

function persistGrants(args: {
  message: string;
  deterministic: TurnUnderstandingV2;
  requestedActions: readonly RequestedAction[];
}) {
  const grants: SemanticAuthorityGrant<PersistCollection>[] = [];
  for (const action of args.requestedActions) {
    if (action.decision !== "granted") continue;
    const collection = persistCollectionV2(action.toolName);
    if (!collection) continue;
    for (const evidence of action.evidence) {
      const located = locateRequestedActionEvidenceV2(
        args.message, args.deterministic.clauses, { ...action, evidence: [evidence] });
      grants.push({
        target: collection,
        sourceClauseIds: located.clauseIds,
        ...(located.content?.trim() ? { content: located.content } : {}),
      });
    }
  }
  return grants;
}

function deniedPersistCollections(args: { requestedActions: readonly RequestedAction[] }) {
  return args.requestedActions.flatMap((action) => {
    const collection = persistCollectionV2(action.toolName);
    return action.decision === "denied" && collection ? [collection] : [];
  });
}

function deniedExecutionTargets(understanding: TurnUnderstandingV2) {
  return understanding.effectDenials.some(({ effect }) => effect === "execute")
    ? (["current", "candidate"] as const)
    : [];
}
