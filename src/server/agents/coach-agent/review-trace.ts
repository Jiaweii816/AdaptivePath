import type { TraceContext, TraceStep } from "@/server/llm/trace-context";
import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import type { CodeRunResult, CodeRunnerLanguage } from "@/types/code-runner";
import type { CoachDiagnosis, CoachReviewDegradation } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";

export async function appendReviewInputResolvedTrace(args: {
  traceContext: TraceContext;
  durationMs: number;
  problem: { id: string; slug: string; title: string };
  language: CodeRunnerLanguage;
  codeHash: string;
  executionFingerprint: string;
  selectedTestCaseIds: string[];
  responseLanguage: "zh" | "en";
  userState?: string;
  userQuestion?: string;
}) {
  await appendTraceEventBestEffort(args.traceContext, {
    stage: "input_resolve",
    kind: "user_input",
    title: "Input & problem resolution",
    status: "succeeded",
    durationMs: args.durationMs,
    details: {
      input: {
        problemId: args.problem.id,
        problemSlug: args.problem.slug,
        language: args.language,
        codeHash: args.codeHash,
        executionFingerprint: args.executionFingerprint,
        selectedTestCaseIds: args.selectedTestCaseIds,
        userState: args.userState,
        userQuestion: args.userQuestion,
      },
      output: {
        resolvedProblem: args.problem,
        responseLanguage: args.responseLanguage,
      },
      metadata: {
        operation: "review_input_resolve",
        selectedTestCount: args.selectedTestCaseIds.length,
      },
    },
  });
}

export async function appendReviewMemoryContextTrace(args: {
  traceContext: TraceContext;
  step?: TraceStep;
  durationMs: number;
  context: {
    strengths: unknown[];
    weaknesses: unknown[];
    episodes: unknown[];
    kbEntries: unknown[];
    unresolvedConfusions: unknown[];
    teachingStrategies: unknown[];
  };
}) {
  await appendTraceEventBestEffort(args.traceContext, {
    step: args.step,
    stage: "context_memory",
    kind: "memory",
    title: "Coach memory context assembled",
    status: "succeeded",
    durationMs: args.durationMs,
    details: {
      retrieval: {
        strengths: args.context.strengths,
        weaknesses: args.context.weaknesses,
        episodes: args.context.episodes,
        kbEntries: args.context.kbEntries,
        unresolvedConfusions: args.context.unresolvedConfusions,
        teachingStrategies: args.context.teachingStrategies,
      },
      metadata: {
        operation: "build_coach_memory_context",
        strengthCount: args.context.strengths.length,
        weaknessCount: args.context.weaknesses.length,
        episodeCount: args.context.episodes.length,
        kbEntryCount: args.context.kbEntries.length,
      },
    },
  });
}

export async function appendReviewRunnerTrace(args: {
  traceContext: TraceContext;
  step?: TraceStep;
  phase: "primary" | "local_fallback";
  fallbackFromProvider?: string;
  executionKind: "review" | "visible_run";
  language: CodeRunnerLanguage;
  code: string;
  codeHash: string;
  executionFingerprint: string;
  problem: { slug: string; methodName?: string | null; isDemoSupported?: boolean };
  tests: Array<{ id: string; label: string; input: unknown; expected: unknown; source?: string }>;
  durationMs: number;
  result?: CodeRunResult;
  evidenceVerdict?: EvidenceVerdict;
  error?: unknown;
}) {
  const status = args.error
    ? "failed"
    : args.result?.status === "runner_error"
      ? "failed"
      : args.result
        ? "succeeded"
        : "degraded";

  await appendTraceEventBestEffort(args.traceContext, {
    step: args.step,
    stage: "execution_evidence",
    kind: "runner",
    title:
      args.phase === "primary"
        ? "Code execution · primary"
        : "Code execution · local fallback",
    status,
    durationMs: args.durationMs,
    details: {
      input: {
        phase: args.phase,
        fallbackFromProvider: args.fallbackFromProvider,
        executionKind: args.executionKind,
        language: args.language,
        code: args.code,
        codeHash: args.codeHash,
        executionFingerprint: args.executionFingerprint,
        problemSlug: args.problem.slug,
        methodName: args.problem.methodName,
        demoAdapterBound: args.problem.isDemoSupported === true,
        tests: args.tests,
      },
      output: args.error
        ? { error: normalizeError(args.error) }
        : {
            providerUsed: readProviderUsed(args.result),
            rawProviderStatus: readRawProviderStatus(args.result),
            normalizedEvidence: args.result,
            evidenceVerdict: args.evidenceVerdict,
            stdout: args.result?.stdout,
            stderr: args.result?.stderr,
          },
      metadata: {
        operation: "run_code_with_tests",
        phase: args.phase,
        fallbackFromProvider: args.fallbackFromProvider ?? null,
        executionKind: args.executionKind,
        provider: readProviderUsed(args.result) ?? "unavailable",
        resultStatus: args.result?.status ?? "threw",
        testCount: args.tests.length,
      },
    },
  });
}

export async function appendReviewGuardTrace(args: {
  traceContext: TraceContext;
  step?: TraceStep;
  durationMs: number;
  providerResult: { coachReply: string; diagnosis: CoachDiagnosis; degraded?: CoachReviewDegradation };
  visibleResult: { coachReply: string; diagnosis: CoachDiagnosis; degraded?: CoachReviewDegradation };
  evidenceVerdict: EvidenceVerdict;
  selfCheckChanged: boolean;
}) {
  const replyChanged =
    args.providerResult.coachReply !== args.visibleResult.coachReply;
  const diagnosisChanged =
    JSON.stringify(args.providerResult.diagnosis) !==
    JSON.stringify(args.visibleResult.diagnosis);
  const changed = replyChanged || diagnosisChanged || args.selfCheckChanged;

  await appendTraceEventBestEffort(args.traceContext, {
    step: args.step,
    stage: "guard_visible_reply",
    kind: "guard",
    title: "Review output guard & visible reply",
    status: args.visibleResult.degraded ? "degraded" : "succeeded",
    durationMs: args.durationMs,
    details: {
      input: {
        parsedProviderOutput: args.providerResult,
      },
      output: {
        visibleAfterGuard: args.visibleResult,
      },
      stateDelta: {
        replyChanged,
        diagnosisChanged,
        selfCheckChanged: args.selfCheckChanged,
      },
      metadata: {
        operation: "review_output_guard",
        guard: "evidence_alignment_and_self_check",
        changed,
        evidenceClass: args.evidenceVerdict.evidenceClass,
        degraded: Boolean(args.visibleResult.degraded),
      },
    },
  });
}

export async function appendReviewArbitrationRequestTrace(args: {
  traceContext: TraceContext;
  eligible: boolean;
  reason?: "memory_skipped" | "not_eligible" | "no_candidate";
  candidates: unknown[];
}) {
  await appendTraceEventBestEffort(args.traceContext, {
    stage: "after_reply_memory",
    kind: "memory",
    title: "L2 fact candidate arbitration",
    status: args.eligible ? "succeeded" : "skipped",
    details: {
      input: {
        source: "review_diagnosis",
        candidates: args.candidates,
      },
      output: args.eligible
        ? { decision: "pending_transaction" }
        : { decision: "skipped", reason: args.reason },
      metadata: {
        operation: "arbitration",
        source: "review_diagnosis",
        decision: args.eligible ? "pending" : "skipped",
        opcode: "reinforce",
        reason: args.reason ?? null,
        candidateCount: args.candidates.length,
      },
    },
  });
}

export async function appendReviewPersistenceTrace(args: {
  traceContext: TraceContext;
  durationMs: number;
  status: "succeeded" | "failed";
  ids?: Record<string, string | null | undefined>;
  error?: unknown;
}) {
  await appendTraceEventBestEffort(args.traceContext, {
    stage: "persistence",
    kind: "persistence",
    title: "Persist Review outcome",
    status: args.status,
    durationMs: args.durationMs,
    details: {
      output:
        args.status === "succeeded"
          ? { identifiers: args.ids }
          : { error: normalizeError(args.error) },
      metadata: {
        operation: "review_persistence_transaction",
        durable: args.status === "succeeded",
      },
    },
  });
}

export async function appendReviewArbitrationResultTrace(args: {
  traceContext: TraceContext;
  eligible: boolean;
  candidates: unknown[];
  before: unknown[];
  updated: unknown[];
  rejected: unknown[];
  reason?: string;
}) {
  await appendTraceEventBestEffort(args.traceContext, {
    stage: "after_reply_memory",
    kind: "memory",
    title: "L2 arbitration result",
    status: args.eligible ? "succeeded" : "skipped",
    details: {
      input: { candidates: args.candidates },
      output: {
        accepted: args.updated,
        rejected: args.rejected,
        reason: args.reason,
      },
      memoryDelta: {
        before: args.before,
        after: args.updated,
        durableRowIds: readIds(args.updated),
      },
      metadata: {
        operation:
          args.eligible && args.updated.length > 0
            ? "durable_fact_change"
            : "arbitration_result",
        source: "review_diagnosis",
        decision: args.eligible ? "arbitrated" : "skipped",
        opcode: "reinforce",
        acceptedCount: args.updated.length,
        rejectedCount: args.rejected.length,
        reason: args.reason ?? null,
      },
    },
  });
}

export async function appendReviewBackgroundIntentTrace(args: {
  traceContext: TraceContext;
  kind:
    | "chat_consolidation"
    | "assisted_repair_consolidation"
    | "reflection"
    | "embed_backfill";
  triggerReason: string;
  originatingReviewAttemptId?: string;
}) {
  await appendTraceEventBestEffort(args.traceContext, {
    stage: "after_reply_memory",
    kind: "background_job",
    title: `Background intent · ${args.kind}`,
    status: "succeeded",
    details: {
      input: {
        kind: args.kind,
        triggerReason: args.triggerReason,
        originatingReviewAttemptId: args.originatingReviewAttemptId,
      },
      output: {
        intentRecorded: true,
        durableJobRecord: false,
      },
      metadata: {
        operation: "background_job_intent",
        intentOnly: true,
        jobKind: args.kind,
        triggerReason: args.triggerReason,
      },
    },
  });
}

export async function appendReviewUnhandledErrorTrace(args: {
  traceContext: TraceContext;
  error: unknown;
  durationMs: number;
}) {
  await appendTraceEventBestEffort(args.traceContext, {
    stage: "review_failure",
    kind: "error",
    title: "Review pipeline failed",
    status: "failed",
    durationMs: args.durationMs,
    details: {
      output: { error: normalizeError(args.error) },
      metadata: {
        operation: "review_pipeline",
        errorKind: readErrorName(args.error),
      },
    },
  });
}

function readProviderUsed(result: CodeRunResult | undefined) {
  const raw = asRecord(result?.rawResult);
  return typeof raw.providerUsed === "string" ? raw.providerUsed : undefined;
}

function readRawProviderStatus(result: CodeRunResult | undefined) {
  const raw = asRecord(result?.rawResult);
  for (const key of ["status", "state", "status_code", "status_msg"]) {
    if (raw[key] !== undefined) return raw[key];
  }
  return result?.status;
}

function normalizeError(error: unknown) {
  const record = asRecord(error);
  return {
    name: readErrorName(error),
    message:
      error instanceof Error
        ? error.message
        : typeof record.message === "string"
          ? record.message
          : String(error),
    code: typeof record.code === "string" ? record.code : undefined,
    status:
      typeof record.status === "number" && Number.isFinite(record.status)
        ? record.status
        : undefined,
  };
}

function readErrorName(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

function readIds(values: unknown[]) {
  return values
    .map((value) => asRecord(value).id)
    .filter((value): value is string => typeof value === "string");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
