import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  codeRunResultSchema,
  codeRunnerLanguageSchema,
  type CodeRunResult,
} from "@/types/code-runner";
import {
  evidenceVerdictSchema,
  type EvidenceVerdict,
} from "@/types/evidence";
import type { CoachProblemContext } from "@/server/agents/coach-agent/coach-agent.types";
import {
  aggregatePayloadState,
  collectReplayIneligibleReasons,
  runtimeTraceExportSchema,
  type RuntimeTraceExport,
  type TraceReplayIneligibleReason,
} from "@/server/observability/runtime-trace-export";

export const DEFAULT_REVIEW_REPLAY_FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/run-evidence/review-v1",
);

const reviewReplayCaseMetadataSchema = z
  .object({
    id: z.string().min(1),
    problem: z.object({
      leetcodeId: z.number().int().positive(),
      slug: z.string().min(1),
      title: z.string().min(1),
      methodName: z.string().min(1).optional(),
      tags: z.array(z.string()),
    }),
    language: codeRunnerLanguageSchema,
    scenario: z.string().min(1),
    bugPattern: z.string().min(1),
    userCode: z.string().min(1),
    selectedTestIds: z.array(z.string()),
    expectedCoachFocus: z.array(z.string()),
  })
  .passthrough();

const reviewReplayFixtureSchema = z
  .object({
    fixtureVersion: z.enum(["review-v1", "review-v1.1"]),
    case: reviewReplayCaseMetadataSchema,
    codeRunResult: codeRunResultSchema,
    evidenceVerdict: evidenceVerdictSchema,
  })
  .superRefine((fixture, context) => {
    if (fixture.codeRunResult.status !== fixture.evidenceVerdict.status) {
      context.addIssue({
        code: "custom",
        path: ["evidenceVerdict", "status"],
        message: "EvidenceVerdict status must match CodeRunResult status.",
      });
    }

    const runProvenance = fixture.codeRunResult.failureProvenance;
    const verdictProvenance = fixture.evidenceVerdict.provenance;

    if (
      runProvenance &&
      verdictProvenance &&
      runProvenance !== verdictProvenance
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceVerdict", "provenance"],
        message:
          "EvidenceVerdict provenance must match CodeRunResult failureProvenance.",
      });
    }
  });

export type ReviewReplayCaseMetadata = z.infer<
  typeof reviewReplayCaseMetadataSchema
>;

export type ReviewReplayCase = {
  fixtureFile: string;
  fixtureVersion: "review-v1" | "review-v1.1";
  case: ReviewReplayCaseMetadata;
  id: string;
  problem: CoachProblemContext;
  language: ReviewReplayCaseMetadata["language"];
  code: string;
  userQuestion: string;
  userState: string;
  injectedBugLabel: string;
  runResult: CodeRunResult;
  evidenceVerdict: EvidenceVerdict;
};

export type TraceReplayRunEvidence = {
  traceRunId: string;
  eventId: string;
  runResult: CodeRunResult;
  evidenceVerdict?: EvidenceVerdict;
};

/** A replay refusal is intentionally machine-readable and never generic. */
export class TraceReplayRefusalError extends Error {
  readonly reasons: TraceReplayIneligibleReason[];

  constructor(reasons: TraceReplayIneligibleReason[]) {
    super(
      `Runtime trace is not replay eligible: ${reasons
        .map((reason) => `${reason.code}: ${reason.message}`)
        .join("; ")}`,
    );
    this.name = "TraceReplayRefusalError";
    this.reasons = reasons;
  }
}

/**
 * Validates the normalized export envelope and refuses every analysis-only
 * artifact before any provider/runner replay is attempted.
 */
export function assertRuntimeTraceReplayEligible(
  artifact: unknown,
): RuntimeTraceExport {
  const parsed = runtimeTraceExportSchema.parse(artifact);
  const computedPayloadState = aggregatePayloadState(parsed.events);
  const computedReasons = collectReplayIneligibleReasons({
    runs: parsed.runs,
    events: parsed.events,
    payloadState: computedPayloadState,
  });
  const declaredReason =
    !parsed.replayEligible ||
    parsed.payloadState !== "full" ||
    parsed.traceCompleteness !== "complete"
      ? [{
          code: reasonCodeForEnvelope(parsed),
          message: "The runtime trace export is marked analysis-only.",
        } satisfies TraceReplayIneligibleReason]
      : [];
  const reasons = deduplicateReplayReasons([
    ...parsed.replayIneligibleReasons,
    ...computedReasons,
    ...declaredReason,
  ]);
  if (reasons.length > 0) {
    throw new TraceReplayRefusalError(reasons);
  }
  return parsed;
}

/**
 * Extracts the most recent normalized Review runner result from an eligible
 * export. This keeps replay backed by captured evidence rather than invoking
 * Piston/LeetCode or guessing from a trace skeleton.
 */
export function loadReplayRunEvidenceFromTraceExport(
  artifact: unknown,
): TraceReplayRunEvidence {
  const traceExport = assertRuntimeTraceReplayEligible(artifact);
  const runnerEvents = traceExport.events.filter(
    (event) => event.scope.path === "review" && event.scope.kind === "runner",
  );

  for (const event of runnerEvents.slice().reverse()) {
    const output = asRecord(event.details?.output);
    const candidate = output?.normalizedEvidence ?? event.details?.output;
    const parsedResult = codeRunResultSchema.safeParse(candidate);
    if (!parsedResult.success) continue;

    const parsedVerdict = evidenceVerdictSchema.safeParse(output?.evidenceVerdict);
    return {
      traceRunId: event.identity.traceRunId,
      eventId: event.identity.eventId,
      runResult: parsedResult.data,
      evidenceVerdict: parsedVerdict.success ? parsedVerdict.data : undefined,
    };
  }

  const hasRunnerOutput = runnerEvents.some(
    (event) => event.details?.output !== undefined,
  );
  throw new TraceReplayRefusalError([
    {
      code: hasRunnerOutput ? "run_evidence_invalid" : "run_evidence_missing",
      message: hasRunnerOutput
        ? "Review runner payload does not contain a valid normalized CodeRunResult."
        : "Review runner payload is missing normalized run evidence.",
      fields: ["details.output.normalizedEvidence"],
    },
  ]);
}

export function loadReviewReplayCases(options?: {
  fixtureDir?: string;
}): ReviewReplayCase[] {
  const fixtureDir = options?.fixtureDir ?? DEFAULT_REVIEW_REPLAY_FIXTURE_DIR;

  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fixtureFile) => loadReviewReplayCase(path.join(fixtureDir, fixtureFile), fixtureFile));
}

function loadReviewReplayCase(
  fixturePath: string,
  fixtureFile: string,
): ReviewReplayCase {
  let rawFixture: unknown;

  try {
    rawFixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read review replay fixture ${fixturePath}: ${reason}`);
  }

  const parsed = reviewReplayFixtureSchema.safeParse(rawFixture);

  if (!parsed.success) {
    throw new Error(
      `Invalid review replay fixture ${fixturePath}: ${parsed.error.message}`,
    );
  }

  return {
    fixtureFile,
    fixtureVersion: parsed.data.fixtureVersion,
    case: parsed.data.case,
    id: parsed.data.case.id,
    problem: {
      slug: parsed.data.case.problem.slug,
      title: parsed.data.case.problem.title,
      leetcodeNumber: parsed.data.case.problem.leetcodeId,
      tags: parsed.data.case.problem.tags,
      methodName:
        parsed.data.case.problem.methodName ??
        methodNameForSlug(parsed.data.case.problem.slug),
      statementMarkdown: parsed.data.case.scenario,
    },
    language: parsed.data.case.language,
    code: parsed.data.case.userCode,
    userQuestion: "请帮我定位这次 Review 失败的最小根因。",
    userState: parsed.data.case.scenario,
    injectedBugLabel: `${parsed.data.case.bugPattern}: ${parsed.data.case.scenario}`,
    runResult: parsed.data.codeRunResult,
    evidenceVerdict: parsed.data.evidenceVerdict,
  };
}

function methodNameForSlug(slug: string) {
  switch (slug) {
    case "two-sum":
      return "twoSum";
    case "search-insert-position":
      return "searchInsert";
    case "longest-substring-without-repeating-characters":
      return "lengthOfLongestSubstring";
    default:
      return "solve";
  }
}

function reasonCodeForEnvelope(
  traceExport: RuntimeTraceExport,
): TraceReplayIneligibleReason["code"] {
  if (traceExport.traceCompleteness === "degraded") return "trace_degraded";
  if (traceExport.traceCompleteness === "incomplete") return "trace_incomplete";
  if (traceExport.payloadState === "summary_only") return "payload_summary_only";
  if (traceExport.payloadState === "partially_pruned") {
    return "payload_partially_pruned";
  }
  if (traceExport.payloadState === "pruned") return "payload_pruned";
  return "required_payload_missing";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function deduplicateReplayReasons(reasons: TraceReplayIneligibleReason[]) {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = JSON.stringify(reason);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
