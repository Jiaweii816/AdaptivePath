import type { CodeRunTestCase, CodeRunnerLanguage } from "@/types/code-runner";
import type {
  CoachReviewContext,
  CoachUserContext,
  CurrentCodeAuthoritativeRunStatus,
  CurrentWorkspaceContext,
  InternalRunEvidenceEnvelope,
} from "./coach-agent.types";
import type { EvidenceAlignment } from "./evidence-alignment";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";
import type { SessionPlan } from "@/server/memory/memory.types";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
} from "@/server/code/code-hash";

export const CHAT_CURRENT_CODE_PROMPT_LIMIT = 12_000;

type BuildCurrentWorkspaceContextArgs = {
  problem: {
    slug: string;
    title: string;
    leetcodeNumber: number | null;
    tags: string[];
    methodName: string;
  };
  language?: CodeRunnerLanguage;
  code?: string;
  selectedTests: CodeRunTestCase[];
  latestAuthoritativeRunEvidence?: CurrentWorkspaceContext["latestAuthoritativeRunEvidence"];
  latestRunAlignment?: EvidenceAlignment;
  resumedWorkingRunEvidence?: InternalRunEvidenceEnvelope;
  resumedWorkingRunAlignment?: EvidenceAlignment;
  latestReviewContext?: CoachReviewContext;
  memory: CoachMemoryBrief;
  user: CoachUserContext;
  sessionPlan?: SessionPlan;
};

export function buildCurrentWorkspaceContext(
  args: BuildCurrentWorkspaceContextArgs,
): CurrentWorkspaceContext {
  const currentCode = args.code ?? "";
  const currentCodeHash =
    args.language && args.code !== undefined
      ? hashCodeForRun({ language: args.language, code: currentCode })
      : undefined;
  const currentExecutionFingerprint =
    args.language && args.code !== undefined
      ? fingerprintCodeForExecution({
          language: args.language,
          code: currentCode,
        })
      : undefined;
  const codeState = detectCurrentCodeState(currentCode);
  const currentCodeAuthoritativeRunStatus =
    describeCurrentCodeAuthoritativeRunStatus({
      hasAuthoritativeRun: Boolean(args.latestAuthoritativeRunEvidence),
      currentCodeHash,
      currentExecutionFingerprint,
      authoritativeRunCodeHash:
        args.latestAuthoritativeRunEvidence?.codeHash ?? null,
      authoritativeRunExecutionFingerprint:
        args.latestAuthoritativeRunEvidence?.executionFingerprint ?? null,
    });

  return {
    problem: args.problem,
    language: args.language,
    currentCode,
    currentCodeHash,
    currentExecutionFingerprint,
    currentCodeLength: currentCode.length,
    currentCodeLineCount: countLines(currentCode),
    currentCodeTruncated:
      currentCode.length > CHAT_CURRENT_CODE_PROMPT_LIMIT,
    codeState,
    currentCodeSummary: summarizeCurrentCode(currentCode, codeState),
    selectedTests: args.selectedTests.map((test) => ({
      id: test.id,
      label: test.label,
      source: test.source ?? "visible",
      input: test.input,
      expected: test.expected,
    })),
    latestAuthoritativeRunEvidence: args.latestAuthoritativeRunEvidence,
    currentTurnRunObservations: [],
    currentCodeAuthoritativeRunStatus,
    latestRunAlignment: args.latestRunAlignment ?? "none",
    resumedWorkingRunEvidence: args.resumedWorkingRunEvidence,
    resumedWorkingRunAlignment: args.resumedWorkingRunAlignment ?? "none",
    latestReviewContext: args.latestReviewContext,
    strengthFallback: buildStrengthFallback({
      codeState,
      problem: args.problem,
      memory: args.memory,
      user: args.user,
      sessionPlan: args.sessionPlan,
    }),
  };
}

export function buildWorkspaceMetadata(context: CurrentWorkspaceContext) {
  return {
    currentCodeHash: context.currentCodeHash ?? null,
    currentExecutionFingerprint: context.currentExecutionFingerprint ?? null,
    codeLength: context.currentCodeLength,
    codeLineCount: context.currentCodeLineCount,
    codeState: context.codeState,
    currentCodeTruncated: context.currentCodeTruncated,
    latestAuthoritativeRunSource:
      context.latestAuthoritativeRunEvidence?.storageSource ?? null,
    latestAuthoritativeRunEvidenceId:
      context.latestAuthoritativeRunEvidence?.id ?? null,
    latestAuthoritativeRunStatus:
      context.latestAuthoritativeRunEvidence?.result.status ?? null,
    latestAuthoritativeRunCodeHash:
      context.latestAuthoritativeRunEvidence?.codeHash ?? null,
    latestAuthoritativeRunExecutionFingerprint:
      context.latestAuthoritativeRunEvidence?.executionFingerprint ?? null,
    latestAuthoritativeRunEvidenceClass:
      context.latestAuthoritativeRunEvidence?.evidenceVerdict?.evidenceClass ??
      null,
    currentCodeAuthoritativeRunStatus:
      context.currentCodeAuthoritativeRunStatus,
    latestRunAlignment: context.latestRunAlignment,
    resumedWorkingRunAlignment: context.resumedWorkingRunAlignment,
    currentTurnRunObservations: context.currentTurnRunObservations.map(
      (observation) => ({
        id: observation.id,
        storageSource: observation.storageSource,
        subject: observation.subject,
        scope: observation.scope,
        status: observation.result.status,
        codeHash: observation.codeHash ?? null,
        executionFingerprint: observation.executionFingerprint ?? null,
      }),
    ),
    selectedTests: context.selectedTests.map((test) => ({
      id: test.id,
      label: test.label,
      source: test.source,
    })),
    strengthFallback: context.strengthFallback
      ? {
          source: context.strengthFallback.source,
          tag: context.strengthFallback.tag,
          text: context.strengthFallback.text,
        }
      : null,
  };
}

export function describeCurrentCodeAuthoritativeRunStatus(args: {
  hasAuthoritativeRun: boolean;
  currentCodeHash?: string;
  currentExecutionFingerprint?: string;
  authoritativeRunCodeHash?: string | null;
  authoritativeRunExecutionFingerprint?: string | null;
}): CurrentCodeAuthoritativeRunStatus {
  if (!args.hasAuthoritativeRun) {
    return "no_authoritative_run_yet";
  }

  if (
    args.currentExecutionFingerprint &&
    args.authoritativeRunExecutionFingerprint
  ) {
    return args.currentExecutionFingerprint ===
      args.authoritativeRunExecutionFingerprint
      ? "authoritative_run_matches_current_code"
      : "current_code_changed_since_authoritative_run";
  }

  if (args.currentCodeHash && args.authoritativeRunCodeHash) {
    return args.currentCodeHash === args.authoritativeRunCodeHash
      ? "authoritative_run_matches_current_code"
      : "current_code_changed_since_authoritative_run";
  }

  return "unknown_current_code_status";
}

export function detectCurrentCodeState(
  code: string,
): CurrentWorkspaceContext["codeState"] {
  const trimmed = code.trim();

  if (!trimmed) {
    return "missing";
  }

  const meaningfulLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("#") &&
        !line.startsWith("//") &&
        !/^class\s+Solution\b/.test(line) &&
        !/^(public:|private:|protected:|\{|\}|};?)$/.test(line) &&
        !/^def\s+\w+\(/.test(line) &&
        !/^\w+\s+\w+\(/.test(line),
    );

  if (
    meaningfulLines.length <= 2 &&
    meaningfulLines.some((line) => /^pass;?$/.test(line))
  ) {
    return "starter_or_placeholder";
  }

  const hasOnlyDummyReturn =
    meaningfulLines.length <= 3 &&
    meaningfulLines.some((line) =>
      /^return\s+(None|nullptr|null|0|-1|false|true|\[\]|\{\}|""|'')\s*;?$/.test(
        line,
      ),
    );

  if (hasOnlyDummyReturn) {
    return "dummy_return";
  }

  if (/TODO|your code here|write your code/i.test(trimmed)) {
    return "starter_or_placeholder";
  }

  return "formed";
}

function summarizeCurrentCode(
  code: string,
  codeState: CurrentWorkspaceContext["codeState"],
) {
  const lines = code.split(/\r?\n/);
  const nonEmptyLineCount = lines.filter((line) => line.trim()).length;
  const visibleLines = lines
    .map((line, index) => ({ index: index + 1, text: line.trim() }))
    .filter((line) => line.text)
    .slice(0, 8)
    .map((line) => `${line.index}: ${line.text}`);

  return [
    `state=${codeState}`,
    `nonEmptyLines=${nonEmptyLineCount}`,
    visibleLines.length > 0
      ? `firstNonEmptyLines=${visibleLines.join(" | ")}`
      : "firstNonEmptyLines=none",
  ].join("; ");
}

function buildStrengthFallback(args: {
  codeState: CurrentWorkspaceContext["codeState"];
  problem: BuildCurrentWorkspaceContextArgs["problem"];
  memory: CoachMemoryBrief;
  user: CoachUserContext;
  sessionPlan?: SessionPlan;
}): CurrentWorkspaceContext["strengthFallback"] {
  if (args.codeState === "formed") {
    return undefined;
  }

  if (args.sessionPlan?.openingMove) {
    return {
      source: "session_plan",
      text: args.sessionPlan.openingMove.text,
    };
  }

  const focusCue = args.sessionPlan?.focusCues[0];
  if (focusCue) {
    return {
      source: "session_plan",
      text: focusCue.cue,
    };
  }

  if (args.memory.teachingStrategy) {
    return {
      source: "validated_strategy",
      text: args.memory.teachingStrategy,
    };
  }

  const memoryStrength = args.memory.teachableMemories.find(
    (memory) => memory.kind === "successful_transfer",
  );
  if (memoryStrength) {
    const source =
      memoryStrength.learnerSignalBasis === "self_reported"
        ? "profile_strength"
        : "l2_strength";
    return {
      source,
      text: `Start from this selected learner cue: ${memoryStrength.cue} (source: ${memoryStrength.sourceLabel}).`,
    };
  }

  const profileStrength = findRelevantProfileStrength({
    strengths: args.user.strongPatterns,
    problemTags: args.problem.tags,
  });
  if (profileStrength) {
    return {
      source: "profile_strength",
      tag: profileStrength.tag,
      text: `Start from the learner's familiar pattern: ${profileStrength.label}.`,
    };
  }

  return {
    source: "problem_first_principles",
    text: `Start from ${args.problem.title}'s input/output contract and write the most direct visible-test version first.`,
  };
}

function countLines(value: string) {
  if (!value) {
    return 0;
  }

  return value.split(/\r?\n/).length;
}

function findRelevantProfileStrength(args: {
  strengths: string[];
  problemTags: string[];
}) {
  const normalizedProblemTags = args.problemTags.map(normalizeLooseConcept);
  const strength = args.strengths.find((candidate) =>
    normalizedProblemTags.includes(normalizeLooseConcept(candidate)),
  );

  return strength
    ? { tag: normalizeLooseConcept(strength), label: strength }
    : undefined;
}

function normalizeLooseConcept(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
