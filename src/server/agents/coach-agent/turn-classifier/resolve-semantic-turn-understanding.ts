import {
  appendTraceEventBestEffort,
  type TraceContext,
} from "@/server/llm/trace-context";

import type { TurnUnderstandingV2 } from "../turn-understanding-v2/turn-understanding-v2.types";
import {
  SemanticClassifierError,
  type SemanticClassifierErrorCode,
} from "./openai-semantic-turn-classifier";
import { semanticClassifierOutputSchema } from "./semantic-classifier-output.schema";
import type {
  SemanticClassifierContext,
  SemanticRouteInput,
  SemanticTurnClassifier,
} from "./semantic-turn-classifier.types";
import {
  validateSemanticTurnProposal,
  type SemanticClassifierBackendFacts,
  type SemanticValidationReason,
} from "./validate-semantic-turn-proposal";

export type SemanticResolverFallbackReason =
  | "classifier_unconfigured"
  | "classifier_factory_error"
  | "classifier_context_error"
  | "classifier_timeout"
  | "classifier_provider_error"
  | "classifier_empty_response"
  | "classifier_invalid_json"
  | "classifier_schema_rejected"
  | "classifier_output_schema_rejected"
  | `validator_${SemanticValidationReason}`;

export type SemanticResolutionProvenance =
  "deterministic_nonsemantic" | "llm_validated" | "semantic_fallback";

export type ResolvedSemanticTurnUnderstanding = Readonly<{
  understanding: TurnUnderstandingV2;
  provenance: SemanticResolutionProvenance;
  classifierActuallyCalled: boolean;
  effectsBlocked: boolean;
  fallbackReason?: SemanticResolverFallbackReason;
}>;

export type SemanticResolverTrace = Readonly<{
  traceContext?: TraceContext;
  status: "succeeded" | "degraded";
  provenance: "llm_validated" | "semantic_fallback";
  classifierActuallyCalled: boolean;
  effectsBlocked: boolean;
  fallbackReason?: SemanticResolverFallbackReason;
  validatorReason?: SemanticValidationReason;
}>;

type Lazy<T> = () => T | Promise<T>;

export type ResolveSemanticTurnUnderstandingArgs = Readonly<{
  deterministic: SemanticRouteInput;
  classifierFactory?: Lazy<SemanticTurnClassifier | undefined>;
  loadClassifierContext?: Lazy<
    Omit<SemanticClassifierContext, "traceContext" | "deterministic">
  >;
  backendFacts?: SemanticClassifierBackendFacts;
  loadBackendFacts?: Lazy<SemanticClassifierBackendFacts>;
  traceContext?: TraceContext;
  guardTraceWriter?: (trace: SemanticResolverTrace) => Promise<void>;
}>;

export async function resolveSemanticTurnUnderstanding(
  args: ResolveSemanticTurnUnderstandingArgs,
): Promise<ResolvedSemanticTurnUnderstanding> {
  if (args.deterministic.route.kind !== "semantic_slow_path") {
    return {
      understanding: args.deterministic as TurnUnderstandingV2,
      provenance: "deterministic_nonsemantic",
      classifierActuallyCalled: false,
      effectsBlocked: false,
    };
  }
  return resolveSelectedSlowPath(args);
}

async function resolveSelectedSlowPath(
  args: ResolveSemanticTurnUnderstandingArgs,
): Promise<ResolvedSemanticTurnUnderstanding> {
  const classifier = await loadClassifier(args);
  if (!classifier.ok) return fallback(args, classifier.reason, false);
  const inputs = await loadInputs(args);
  if (!inputs) return fallback(args, "classifier_context_error", false);
  try {
    const raw: unknown = await classifier.value.classify({
      ...inputs.context,
      deterministic: args.deterministic,
      traceContext: args.traceContext,
    });
    return validateOutput(args, raw, inputs.facts);
  } catch (error) {
    return fallback(args, failureReason(error), true);
  }
}

async function loadClassifier(
  args: ResolveSemanticTurnUnderstandingArgs,
): Promise<
  | { ok: true; value: SemanticTurnClassifier }
  | { ok: false; reason: SemanticResolverFallbackReason }
> {
  if (!args.classifierFactory) {
    return { ok: false, reason: "classifier_unconfigured" };
  }
  try {
    const classifier = await args.classifierFactory();
    return classifier
      ? { ok: true, value: classifier }
      : { ok: false, reason: "classifier_unconfigured" };
  } catch {
    return { ok: false, reason: "classifier_factory_error" };
  }
}

async function loadInputs(args: ResolveSemanticTurnUnderstandingArgs) {
  if (!args.loadClassifierContext) return undefined;
  try {
    const context = await args.loadClassifierContext();
    const facts = args.loadBackendFacts
      ? await args.loadBackendFacts()
      : args.backendFacts;
    return facts ? { context, facts } : undefined;
  } catch {
    return undefined;
  }
}

async function validateOutput(
  args: ResolveSemanticTurnUnderstandingArgs,
  raw: unknown,
  facts: SemanticClassifierBackendFacts,
): Promise<ResolvedSemanticTurnUnderstanding> {
  const parsed = semanticClassifierOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return fallback(args, "classifier_output_schema_rejected", true);
  }
  const validated = validateSemanticTurnProposal(
    parsed.data,
    facts,
    args.deterministic,
  );
  if (!validated.ok) {
    return fallback(
      args,
      `validator_${validated.reason}`,
      true,
      validated.reason,
    );
  }
  await writeGuardBestEffort(args, {
    traceContext: args.traceContext,
    status: "succeeded",
    provenance: "llm_validated",
    classifierActuallyCalled: true,
    effectsBlocked: false,
  });
  return {
    understanding: validated.understanding,
    provenance: "llm_validated",
    classifierActuallyCalled: true,
    effectsBlocked: false,
  };
}

async function fallback(
  args: ResolveSemanticTurnUnderstandingArgs,
  fallbackReason: SemanticResolverFallbackReason,
  classifierActuallyCalled: boolean,
  validatorReason?: SemanticValidationReason,
): Promise<ResolvedSemanticTurnUnderstanding> {
  const effectsBlocked = hasUnresolvedEffects(
    args.deterministic,
    validatorReason,
  );
  const understanding = failClosedUnderstanding(
    args.deterministic,
    effectsBlocked,
  );
  await writeGuardBestEffort(args, {
    traceContext: args.traceContext,
    status: "degraded",
    provenance: "semantic_fallback",
    classifierActuallyCalled,
    effectsBlocked,
    fallbackReason,
    validatorReason,
  });
  return {
    understanding,
    provenance: "semantic_fallback",
    classifierActuallyCalled,
    effectsBlocked,
    fallbackReason,
  };
}

function failClosedUnderstanding(
  deterministic: SemanticRouteInput,
  effectsBlocked: boolean,
): TurnUnderstandingV2 {
  const safeRequests = deterministic.requests.filter(
    ({ kind }) => kind === "respond",
  );
  return {
    schemaVersion: "v2",
    clauses: deterministic.clauses,
    coverage: deterministic.coverage,
    requests: safeRequests,
    disclosure: deterministic.disclosure,
    categoryDenials: deterministic.categoryDenials,
    effectDenials: deterministic.effectDenials,
    languageScope: deterministic.languageScope,
    affect: deterministic.affect,
    discourse: deterministic.discourse,
    route: effectsBlocked
      ? {
          kind: "clarify",
          escalationReasons: [],
          clarificationReason: "effect_target_unresolved",
        }
      : { kind: "fast_path", escalationReasons: [] },
  };
}

function hasUnresolvedEffects(
  deterministic: SemanticRouteInput,
  validatorReason?: SemanticValidationReason,
): boolean {
  if (
    deterministic.requests.some(
      ({ kind }) => kind === "execute" || kind === "persist",
    )
  ) {
    return true;
  }
  if (
    deterministic.route.kind === "semantic_slow_path" &&
    (deterministic.route.uncertainEffects?.length ?? 0) > 0
  ) {
    return true;
  }
  return (
    validatorReason?.startsWith("execute_") === true ||
    validatorReason?.startsWith("persist_") === true
  );
}

const FAILURE_REASON_BY_CODE = {
  timeout: "classifier_timeout",
  provider: "classifier_provider_error",
  empty_response: "classifier_empty_response",
  invalid_json: "classifier_invalid_json",
  schema_rejected: "classifier_schema_rejected",
} as const satisfies Record<
  SemanticClassifierErrorCode,
  SemanticResolverFallbackReason
>;

function failureReason(error: unknown): SemanticResolverFallbackReason {
  return error instanceof SemanticClassifierError
    ? FAILURE_REASON_BY_CODE[error.code]
    : "classifier_provider_error";
}

async function writeGuardBestEffort(
  args: ResolveSemanticTurnUnderstandingArgs,
  trace: SemanticResolverTrace,
): Promise<void> {
  try {
    await (args.guardTraceWriter ?? appendGuardTrace)(trace);
  } catch {
    // Observability cannot alter a validated or fail-closed decision.
  }
}

async function appendGuardTrace(trace: SemanticResolverTrace): Promise<void> {
  if (!trace.traceContext) return;
  await appendTraceEventBestEffort(trace.traceContext, {
    stage: "turn_semantic_classifier_validation",
    kind: "guard",
    title:
      trace.provenance === "llm_validated"
        ? "Semantic turn proposal accepted"
        : "Semantic turn proposal used a safe fallback",
    status: trace.status,
    details: {
      output: {
        provenance: trace.provenance,
        classifierActuallyCalled: trace.classifierActuallyCalled,
        effectsBlocked: trace.effectsBlocked,
        fallbackReason: trace.fallbackReason,
        validatorReason: trace.validatorReason,
      },
      metadata: { source: "coach_agent:resolve_semantic_turn_understanding" },
    },
  });
}
