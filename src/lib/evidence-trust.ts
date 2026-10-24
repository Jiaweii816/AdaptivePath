import type { CodeRunResult, CodeRunStatus } from "@/types/code-runner";
import {
  evidenceVerdictSchema,
  type EvidenceClass,
  type EvidenceReplyMode,
  type EvidenceVerdict,
  type FailureProvenance,
} from "@/types/evidence";

export type EvidenceConsumer =
  | "review"
  | "chat_run"
  | "mock_interview"
  | "practice_run"
  | "planner"
  | "history";

export type EvidenceClassificationContext = {
  consumer: EvidenceConsumer;
  providerUsed?: string;
  localFallback?: boolean;
  fallbackFromProvider?: string;
};

const USER_INPUT_STATUSES = new Set<CodeRunStatus>([
  "empty_code",
  "no_tests",
  "unsupported_language",
]);

const VERDICT_STATUSES = new Set<CodeRunStatus>([
  "passed_visible_tests",
  "failed",
  "compile_error",
  "syntax_error",
  "runtime_error",
  "timeout",
]);

const SERVICE_PROVENANCE = new Set<FailureProvenance>([
  "judge_service",
  "sandbox_service",
  "adapter",
  "network",
]);

const LOCAL_VISIBLE_PROVIDERS = new Set([
  "piston",
  "piston_fallback",
  "local_hot150",
  "lc_run",
  "remote_unavailable_local_fallback",
]);

export function classifyExecutionEvidence(
  runResult: Pick<CodeRunResult, "status" | "failureProvenance">,
  context: EvidenceClassificationContext,
): EvidenceVerdict {
  const status = runResult.status;
  const provenance = runResult.failureProvenance;
  const providerUsed = context.providerUsed;
  const evidenceClass = classifyEvidenceClass({
    status,
    provenance,
    providerUsed,
    localVisible:
      context.localFallback === true ||
      (providerUsed !== undefined && LOCAL_VISIBLE_PROVIDERS.has(providerUsed)),
  });
  const replyMode = replyModeFor(evidenceClass, status);
  const capabilities = capabilitiesFor(evidenceClass, status, context.consumer);

  return evidenceVerdictSchema.parse({
    evidenceClass,
    replyMode,
    capabilities,
    status,
    provenance,
    providerUsed,
    fallbackFromProvider: context.fallbackFromProvider,
    scopeLabel: scopeLabelFor(evidenceClass),
    modelInstruction: modelInstructionFor(evidenceClass),
  });
}

export function isEvidenceUnavailable(verdict: Pick<EvidenceVerdict, "evidenceClass">) {
  return verdict.evidenceClass === "evidence_unavailable";
}

export function isNonVerdict(verdict: Pick<EvidenceVerdict, "capabilities">) {
  return !verdict.capabilities.canVerdict;
}

export function canWriteStrengthCandidate(
  verdict: Pick<EvidenceVerdict, "capabilities" | "evidenceClass" | "status">,
) {
  return (
    verdict.capabilities.canVerdict &&
    verdict.status === "passed_visible_tests" &&
    (verdict.evidenceClass === "verdict_bearing" ||
      verdict.evidenceClass === "local_only")
  );
}

export function readEvidenceVerdict(value: unknown): EvidenceVerdict | undefined {
  const parsed = evidenceVerdictSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const NON_VERDICT_CLAIM_PATTERNS = [
  /your code (is )?(wrong|incorrect|fails?)/i,
  /\bwrong answer\b/i,
  /\bfailed because\b/i,
  /\bfailure reason\b/i,
  /\bfix (this|the) logic\b/i,
  /\b(code|solution).{0,24}\bpasses?\b/i,
  /你的代码(是)?(错|错误|不对)/,
  /代码(会|将)?(错|错误|失败)/,
  /失败原因是/,
  /这个用例没过/,
  /会导致错误答案/,
  /通过了/,
];

export function findNonVerdictClaims(markdown: string) {
  return NON_VERDICT_CLAIM_PATTERNS
    .filter((pattern) => pattern.test(markdown))
    .map((pattern) => pattern.toString());
}

export function shouldReplaceNonVerdictReply(args: {
  verdict?: EvidenceVerdict;
  markdown: string;
}) {
  if (!args.verdict || args.verdict.capabilities.canVerdict) {
    return false;
  }

  return findNonVerdictClaims(args.markdown).length > 0;
}

export function buildNonVerdictSafetyReply(
  language: "zh" | "en",
  verdict?: EvidenceVerdict,
) {
  if (language === "en") {
    return [
      "I cannot make a correctness judgment from this run because execution evidence was not available.",
      verdict?.modelInstruction ??
        "Retry the execution or run visible tests before treating this as pass/fail evidence.",
    ].join("\n\n");
  }

  return [
    "这次运行没有可用于判定正确性的执行证据，所以我不能说代码通过或失败。",
    verdict?.modelInstruction ??
      "请先重试执行，或运行可见测试，再把结果当作通过/失败依据。",
  ].join("\n\n");
}

function classifyEvidenceClass(args: {
  status: CodeRunStatus;
  provenance?: FailureProvenance;
  providerUsed?: string;
  localVisible: boolean;
}): EvidenceClass {
  if (USER_INPUT_STATUSES.has(args.status)) {
    return "user_input";
  }

  if (args.status === "runner_error") {
    return "evidence_unavailable";
  }

  // The deterministic mock runner is an automation fixture, not learner
  // execution evidence. Never let a live learner origin turn mock output into
  // a correctness claim or durable learning signal.
  if (args.providerUsed === "mock") {
    return "evidence_unavailable";
  }

  if (
    args.provenance &&
    SERVICE_PROVENANCE.has(args.provenance) &&
    args.status !== "passed_visible_tests"
  ) {
    return "evidence_unavailable";
  }

  if (args.localVisible && VERDICT_STATUSES.has(args.status)) {
    return "local_only";
  }

  if (VERDICT_STATUSES.has(args.status)) {
    return "verdict_bearing";
  }

  return "evidence_unavailable";
}

function replyModeFor(
  evidenceClass: EvidenceClass,
  status: CodeRunStatus,
): EvidenceReplyMode {
  if (evidenceClass === "evidence_unavailable") {
    return "unavailable";
  }

  if (evidenceClass === "user_input") {
    return "user_input_fix";
  }

  if (evidenceClass === "local_only") {
    return "local_fallback";
  }

  return status === "passed_visible_tests" ? "success" : "diagnostic";
}

function capabilitiesFor(
  evidenceClass: EvidenceClass,
  status: CodeRunStatus,
  consumer: EvidenceConsumer,
) {
  const learningFlow = consumer === "review" || consumer === "mock_interview";

  if (evidenceClass === "verdict_bearing") {
    const failed = status !== "passed_visible_tests";

    return {
      canVerdict: true,
      canWriteMistakeMemory: learningFlow && failed,
      canWriteEpisode: learningFlow,
      canSignalPlanner: true,
      canUseFailureSalience: learningFlow && failed,
    };
  }

  if (evidenceClass === "local_only") {
    const failed = status !== "passed_visible_tests";

    return {
      canVerdict: true,
      canWriteMistakeMemory: learningFlow && failed,
      canWriteEpisode: learningFlow,
      canSignalPlanner: status === "passed_visible_tests",
      canUseFailureSalience: learningFlow && failed,
    };
  }

  return {
    canVerdict: false,
    canWriteMistakeMemory: false,
    canWriteEpisode: false,
    canSignalPlanner: false,
    canUseFailureSalience: false,
  };
}

function scopeLabelFor(evidenceClass: EvidenceClass) {
  switch (evidenceClass) {
    case "verdict_bearing":
      return "execution evidence";
    case "local_only":
      return "local visible-test evidence";
    case "user_input":
      return "not enough runnable input";
    case "evidence_unavailable":
      return "execution evidence unavailable";
  }
}

function modelInstructionFor(evidenceClass: EvidenceClass) {
  switch (evidenceClass) {
    case "verdict_bearing":
      return "You may reason from this execution evidence, without claiming hidden-test acceptance.";
    case "local_only":
      return "This is aligned local visible-test evidence for the current revision and selected cases. Diagnose only what these visible tests show. A failed Review may propose evidence-scoped learner mistake candidates and the Review may create an Episode, but never claim official acceptance or hidden-test coverage.";
    case "user_input":
      return "Do not assert code correctness. Explain what runnable input is missing or unsupported, and ask for the smallest next runnable step.";
    case "evidence_unavailable":
      return "Do not assert that the code passed or failed. State that execution evidence is unavailable and suggest retrying or running visible tests.";
  }
}
