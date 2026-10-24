import {
  appendTraceEventBestEffort,
  type TraceContext,
} from "@/server/llm/trace-context";

import type { TurnUnderstanding } from "../turn-understanding/turn-understanding.types";
import { classifierOutputSchema } from "./classifier-output.schema";
import {
  TurnClassifierError,
  type TurnClassifierErrorCode,
} from "./openai-turn-classifier";
import type {
  ClassifierContext,
  TurnClassifier,
} from "./turn-classifier.types";
import {
  validateClassifiedUnderstanding,
  type BackendFacts,
  type ValidationReason,
} from "./validate-classified-understanding";

export type TurnUnderstandingProvenance =
  | "deterministic_fast"
  | "deterministic_unconfigured"
  | "llm_validated"
  | "deterministic_fallback";

export type ResolverFallbackReason =
  | "classifier_factory_error"
  | "classifier_context_error"
  | "classifier_timeout"
  | "classifier_provider_error"
  | "classifier_empty_response"
  | "classifier_invalid_json"
  | "classifier_schema_rejected"
  | "classifier_output_schema_rejected"
  | "resolver_unknown_error"
  | `validator_${ValidationReason}`;

export type ResolvedTurnUnderstanding = {
  understanding: TurnUnderstanding;
  provenance: TurnUnderstandingProvenance;
  classifierActuallyCalled: boolean;
  fallbackReason?: ResolverFallbackReason;
};

export type ResolverGuardTrace = {
  traceContext?: TraceContext;
  status: "succeeded" | "degraded";
  provenance: "llm_validated" | "deterministic_fallback";
  validatorOutcome: "accepted" | "rejected" | "not_run";
  fallbackReason?: ResolverFallbackReason;
  validatorReason?: ValidationReason;
  classifierActuallyCalled: boolean;
};

export type ResolverGuardTraceWriter = (
  trace: ResolverGuardTrace,
) => Promise<void>;

type ClassifierFactory = () =>
  | TurnClassifier
  | undefined
  | Promise<TurnClassifier | undefined>;
type ClassifierContextLoader = () =>
  | Omit<ClassifierContext, "traceContext">
  | Promise<Omit<ClassifierContext, "traceContext">>;
type BackendFactsLoader = (
  context: Omit<ClassifierContext, "traceContext">,
) => BackendFacts | Promise<BackendFacts>;

type ResolveTurnUnderstandingBaseArgs = {
  deterministic: TurnUnderstanding;
  classifierFactory: ClassifierFactory;
  loadClassifierContext: ClassifierContextLoader;
  traceContext?: TraceContext;
  guardTraceWriter?: ResolverGuardTraceWriter;
};

type BackendFactSource =
  | { facts: BackendFacts; loadBackendFacts?: BackendFactsLoader }
  | { facts?: BackendFacts; loadBackendFacts: BackendFactsLoader };

export type ResolveTurnUnderstandingArgs =
  ResolveTurnUnderstandingBaseArgs & BackendFactSource;

export async function resolveTurnUnderstanding(
  args: ResolveTurnUnderstandingArgs,
): Promise<ResolvedTurnUnderstanding> {
  if (args.deterministic.route === "fast_path") {
    return deterministicResult(args.deterministic, "deterministic_fast");
  }
  return resolveSlowPath(args);
}

async function resolveSlowPath(
  args: ResolveTurnUnderstandingArgs,
): Promise<ResolvedTurnUnderstanding> {
  let classifier: TurnClassifier | undefined;
  try {
    classifier = await args.classifierFactory();
  } catch {
    return fallback(args, "classifier_factory_error", undefined, false);
  }
  if (!classifier) {
    return deterministicResult(
      args.deterministic,
      "deterministic_unconfigured",
    );
  }

  const context = await loadContext(args);
  if (!context.ok) {
    return fallback(args, "classifier_context_error", undefined, false);
  }
  const facts = await loadFacts(args, context.value);
  if (!facts.ok) {
    return fallback(args, "classifier_context_error", undefined, false);
  }
  try {
    return await classifyAndValidate(args, classifier, context.value, facts.value);
  } catch {
    return fallback(args, "resolver_unknown_error", undefined, true);
  }
}

async function loadFacts(
  args: ResolveTurnUnderstandingArgs,
  context: Omit<ClassifierContext, "traceContext">,
): Promise<{ ok: true; value: BackendFacts } | { ok: false }> {
  try {
    const facts = args.loadBackendFacts
      ? await args.loadBackendFacts(context)
      : args.facts;
    return facts ? { ok: true, value: facts } : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function loadContext(
  args: ResolveTurnUnderstandingArgs,
): Promise<
  | { ok: true; value: Omit<ClassifierContext, "traceContext"> }
  | { ok: false }
> {
  try {
    return { ok: true, value: await args.loadClassifierContext() };
  } catch {
    return { ok: false };
  }
}

async function classifyAndValidate(
  args: ResolveTurnUnderstandingArgs,
  classifier: TurnClassifier,
  context: Omit<ClassifierContext, "traceContext">,
  facts: BackendFacts,
): Promise<ResolvedTurnUnderstanding> {
  let raw: unknown;
  try {
    raw = await classifier.classify({ ...context, traceContext: args.traceContext });
  } catch (error) {
    return fallback(args, classifierFailureReason(error), undefined, true);
  }
  const parsed = classifierOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return fallback(
      args,
      "classifier_output_schema_rejected",
      undefined,
      true,
    );
  }
  const validated = validateClassifiedUnderstanding(
    parsed.data,
    facts,
    args.deterministic,
  );
  if (!validated.ok) {
    return fallback(
      args,
      `validator_${validated.reason}`,
      validated.reason,
      true,
    );
  }
  return accepted(args, validated.understanding);
}

async function accepted(
  args: ResolveTurnUnderstandingArgs,
  understanding: TurnUnderstanding,
): Promise<ResolvedTurnUnderstanding> {
  await writeGuardBestEffort(args, {
    traceContext: args.traceContext,
    status: "succeeded",
    provenance: "llm_validated",
    validatorOutcome: "accepted",
    classifierActuallyCalled: true,
  });
  return {
    understanding,
    provenance: "llm_validated",
    classifierActuallyCalled: true,
  };
}

async function fallback(
  args: ResolveTurnUnderstandingArgs,
  fallbackReason: ResolverFallbackReason,
  validatorReason?: ValidationReason,
  classifierActuallyCalled = false,
): Promise<ResolvedTurnUnderstanding> {
  await writeGuardBestEffort(args, {
    traceContext: args.traceContext,
    status: "degraded",
    provenance: "deterministic_fallback",
    validatorOutcome: validatorReason ? "rejected" : "not_run",
    fallbackReason,
    validatorReason,
    classifierActuallyCalled,
  });
  return {
    understanding: args.deterministic,
    provenance: "deterministic_fallback",
    classifierActuallyCalled,
    fallbackReason,
  };
}

function deterministicResult(
  understanding: TurnUnderstanding,
  provenance: "deterministic_fast" | "deterministic_unconfigured",
): ResolvedTurnUnderstanding {
  return { understanding, provenance, classifierActuallyCalled: false };
}

const FAILURE_REASON_BY_CODE = {
  timeout: "classifier_timeout",
  provider: "classifier_provider_error",
  empty_response: "classifier_empty_response",
  invalid_json: "classifier_invalid_json",
  schema_rejected: "classifier_schema_rejected",
} as const satisfies Record<TurnClassifierErrorCode, ResolverFallbackReason>;

function classifierFailureReason(error: unknown): ResolverFallbackReason {
  return error instanceof TurnClassifierError
    ? FAILURE_REASON_BY_CODE[error.code]
    : "resolver_unknown_error";
}

async function writeGuardBestEffort(
  args: ResolveTurnUnderstandingArgs,
  trace: ResolverGuardTrace,
): Promise<void> {
  try {
    await (args.guardTraceWriter ?? appendResolverGuardTrace)(trace);
  } catch {
    // Observability cannot change the chosen understanding or fallback result.
  }
}

async function appendResolverGuardTrace(
  trace: ResolverGuardTrace,
): Promise<void> {
  if (!trace.traceContext) return;
  await appendTraceEventBestEffort(trace.traceContext, {
    stage: "turn_classifier_validation",
    kind: "guard",
    title:
      trace.provenance === "llm_validated"
        ? "Turn classifier output accepted by validator"
        : "Turn classifier fell back to deterministic understanding",
    status: trace.status,
    details: {
      output: {
        provenance: trace.provenance,
        validatorOutcome: trace.validatorOutcome,
        fallbackReason: trace.fallbackReason,
        validatorReason: trace.validatorReason,
        classifierActuallyCalled: trace.classifierActuallyCalled,
      },
      metadata: {
        source: "coach_agent:resolve_turn_understanding",
        deterministicFallback:
          trace.provenance === "deterministic_fallback",
        classifierActuallyCalled: trace.classifierActuallyCalled,
      },
    },
  });
}
