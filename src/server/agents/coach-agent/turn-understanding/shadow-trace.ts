import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";
import {
  appendTraceEventBestEffort,
  type TraceContext,
} from "@/server/llm/trace-context";

import type { ChatTurnPlan } from "../coach-agent.types";
import type {
  ResolverFallbackReason,
  TurnUnderstandingProvenance,
} from "../turn-classifier/resolve-turn-understanding";
import type {
  Operation,
  SignalEvidence,
  TurnUnderstanding,
} from "./turn-understanding.types";

export const SHADOW_TURN_PARSER_VERSION = "intent-p1-shadow-v1";
const MAX_ITEMS = 32;
const MAX_EVIDENCE_PER_ITEM = 16;
const MAX_SPAN_CHARS = 512;
const MAX_SIGNATURE_CHARS = 2048;

type ShadowTraceArgs = {
  understanding: TurnUnderstanding;
  legacyPlan: ChatTurnPlan;
  requestedActions: readonly RequestedAction[];
  provenance?: TurnUnderstandingProvenance;
  fallbackReason?: ResolverFallbackReason | string;
  classifierActuallyCalled?: boolean;
};

type ShadowCaptureArgs = ShadowTraceArgs;

function boundText(value: string): string {
  if (value.length <= MAX_SPAN_CHARS) return value;
  return `${value.slice(0, MAX_SPAN_CHARS)}…`;
}

function boundEvidence(evidence: readonly SignalEvidence[]) {
  return evidence.slice(0, MAX_EVIDENCE_PER_ITEM).map((item) => ({
    ...item,
    span: boundText(item.span),
  }));
}

function boundOperations(operations: readonly Operation[]) {
  return operations.slice(0, MAX_ITEMS).map((operation) => ({
    id: operation.id,
    family: operation.family,
    target: operation.target,
    topic: operation.topic,
    sourceClauseId: operation.sourceClauseId,
    orderHint: operation.orderHint,
    dependsOn: operation.dependsOn.slice(0, MAX_ITEMS),
    evidence: boundEvidence(operation.evidence),
    resolution: operation.resolution,
  }));
}

function boundRequestedActions(actions: readonly RequestedAction[]) {
  return actions.slice(0, MAX_ITEMS).map((action) => ({
    toolName: action.toolName,
    order: action.order,
    decision: action.decision,
    evidence: action.evidence.slice(0, MAX_EVIDENCE_PER_ITEM).map((item) => ({
      clause: boundText(item.clause),
      matchedTarget: item.matchedTarget
        ? boundText(item.matchedTarget)
        : null,
      matchedAction: item.matchedAction
        ? boundText(item.matchedAction)
        : null,
      requestPatternId: item.requestPatternId,
      exclusionId: item.exclusionId,
    })),
  }));
}

function signature(parts: string[]): string {
  const value = parts.join("|") || "none";
  return value.length <= MAX_SIGNATURE_CHARS
    ? value
    : `${value.slice(0, MAX_SIGNATURE_CHARS)}…`;
}

function traceMetadata(args: ShadowTraceArgs) {
  const { understanding, requestedActions } = args;
  const provenance = resolveProvenance(args);
  const classifierActuallyCalled = args.classifierActuallyCalled ?? false;
  const sideEffects = understanding.operations.filter(({ family }) =>
    family === "execute" || family === "persist",
  );
  return {
    parserVersion: SHADOW_TURN_PARSER_VERSION,
    route: understanding.route,
    legacyIntent: understanding.legacyPrimaryIntent ?? "none",
    operationSignature: signature(
      understanding.operations.map(({ family, target, resolution }) =>
        `${family}:${target}:${resolution}`,
      ),
    ),
    sideEffectSignature: signature(
      sideEffects.map(({ family, target, resolution }) =>
        `${family}:${target}:${resolution}`,
      ),
    ),
    hasDiscourse: understanding.discourseMarkers.length > 0,
    hasNegation: understanding.negationSignals.length > 0,
    unsupportedLanguage:
      understanding.unsupportedScope.languageMention ?? "none",
    requestedActionSignature: signature(
      requestedActions.map(({ toolName, decision }) =>
        `${toolName}:${decision}`,
      ),
    ),
    clauseCount: understanding.clauses.length,
    operationCount: understanding.operations.length,
    codeDisclosure: understanding.modifiers.codeDisclosure.level,
    affect: understanding.modifiers.affect,
    deliveryMode: understanding.modifiers.deliveryMode,
    requestedArtifact: understanding.modifiers.requestedArtifact,
    blocksSideEffect: understanding.ambiguity.blocksSideEffect,
    unresolvedOperationCount:
      understanding.ambiguity.unresolvedOperationIds.length,
    discourseKindSignature: signature(
      understanding.discourseMarkers.map(({ kind }) => kind),
    ),
    provenance,
    fallbackReason: args.fallbackReason ?? "none",
    classifierActuallyCalled,
    classifierAttempted: classifierActuallyCalled,
    deterministic: provenance !== "llm_validated",
    role: "consumed_with_legacy_comparison",
  };
}

function buildTraceOutput(args: ShadowTraceArgs) {
  const { understanding, legacyPlan, requestedActions } = args;
  return {
    parserVersion: SHADOW_TURN_PARSER_VERSION,
    route: understanding.route,
    resolution: {
      provenance: resolveProvenance(args),
      fallbackReason: args.fallbackReason,
      classifierActuallyCalled: args.classifierActuallyCalled ?? false,
    },
    clauses: understanding.clauses.slice(0, MAX_ITEMS).map((clause) => ({
      ...clause,
      text: boundText(clause.text),
    })),
    operations: boundOperations(understanding.operations),
    modifiers: understanding.modifiers,
    discourseMarkers: boundEvidence(understanding.discourseMarkers),
    negationSignals: boundEvidence(understanding.negationSignals),
    learnerStateSignals: boundEvidence(understanding.learnerStateSignals),
    unsupportedScope: understanding.unsupportedScope,
    ambiguity: understanding.ambiguity,
    legacyPrimaryIntent: understanding.legacyPrimaryIntent,
    legacySnapshot: {
      primaryIntent: legacyPlan.primaryIntent,
      confidence: legacyPlan.confidence,
      codeDisclosure: legacyPlan.codeDisclosure,
      signals: legacyPlan.signals,
      contextNeeds: legacyPlan.contextNeeds,
      toolCapabilities: legacyPlan.toolCapabilities,
    },
    requestedActions: boundRequestedActions(requestedActions),
    bounds: {
      maxItems: MAX_ITEMS,
      maxEvidencePerItem: MAX_EVIDENCE_PER_ITEM,
      maxSpanChars: MAX_SPAN_CHARS,
      clauseCount: understanding.clauses.length,
      operationCount: understanding.operations.length,
      requestedActionCount: requestedActions.length,
    },
  };
}

function resolveProvenance(args: ShadowTraceArgs): TurnUnderstandingProvenance {
  return (
    args.provenance ??
    (args.understanding.route === "fast_path"
      ? "deterministic_fast"
      : "deterministic_unconfigured")
  );
}

export async function appendShadowTurnUnderstandingTrace(
  traceContext: TraceContext,
  args: ShadowTraceArgs,
): Promise<void> {
  await appendTraceEventBestEffort(traceContext, {
    stage: "shadow_turn_understanding",
    kind: "guard",
    title: "Consumed structured turn understanding with legacy comparison",
    status: "succeeded",
    details: {
      output: buildTraceOutput(args),
      metadata: traceMetadata(args),
    },
  });
}

async function appendShadowFailureTrace(
  traceContext: TraceContext,
  args: ShadowTraceArgs & { phase: "append"; error: unknown },
): Promise<void> {
  await appendTraceEventBestEffort(traceContext, {
    stage: "shadow_turn_understanding",
    kind: "guard",
    title: "Consumed turn-understanding trace failed open",
    status: "failed",
    details: {
      metadata: {
        parserVersion: SHADOW_TURN_PARSER_VERSION,
        phase: args.phase,
        errorName:
          args.error instanceof Error ? args.error.name : typeof args.error,
        provenance: resolveProvenance(args),
        deterministic: resolveProvenance(args) !== "llm_validated",
        role: "consumed_with_legacy_comparison",
        failOpen: true,
      },
    },
  });
}

type ShadowDependencies = {
  append: typeof appendShadowTurnUnderstandingTrace;
  appendFailure: typeof appendShadowFailureTrace;
};

const DEFAULT_DEPENDENCIES: ShadowDependencies = {
  append: appendShadowTurnUnderstandingTrace,
  appendFailure: appendShadowFailureTrace,
};

export async function captureShadowTurnUnderstandingBestEffort(
  traceContext: TraceContext,
  args: ShadowCaptureArgs,
  dependencies: ShadowDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  try {
    await dependencies.append(traceContext, args);
  } catch (error) {
    try {
      await dependencies.appendFailure(traceContext, {
        ...args,
        phase: "append",
        error,
      });
    } catch {
      // Observability must never alter the learner-visible Chat path.
    }
  }
}
