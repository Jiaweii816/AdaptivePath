import type { PrismaClient } from "@prisma/client";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
  hashSelectedTestSuite,
} from "@/server/code/code-hash";
import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";
import { runCodeWithTests } from "@/server/tools/code-runner/run-code-with-tests";
import type { CodeRunnerProvider } from "@/server/tools/code-runner/code-runner.types";
import type {
  CodeRunResult,
  CodeRunTestCase,
  CodeRunTestResult,
  CodeRunnerLanguage,
} from "@/types/code-runner";
import type { EvidenceVerdict } from "@/types/evidence";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import {
  type ChatToolArgs,
  type ChatToolResult,
} from "./chat-tool-contracts";

type RunCodeContext = {
  prisma: PrismaClient;
  userId: string;
  memoryOrigin: MemoryOrigin;
  chatSessionId: string;
  toolCallId: string;
  userMessageSequence?: number;
  problem: {
    id: string;
    slug: string;
    title: string;
    leetcodeNumber: number | null;
    methodName: string;
    inputContractJson: string;
    outputContractJson: string;
    isDemoSupported: boolean;
    localRunStatus: string;
    localRunStatusMessage: string | null;
    comparisonStrategy: string;
    comparisonConfigJson: string;
    contractKind: string;
  };
  problemTags: string[];
  workspace?: {
    code?: string;
    language?: CodeRunnerLanguage;
    codeHash?: string;
    executionFingerprint?: string;
    selectedTests?: CodeRunTestCase[];
  };
  codeRunnerProvider?: CodeRunnerProvider;
};

type RunCodeArgsWithTests = Pick<
  ChatToolArgs<"run_current_code">,
  "tests" | "dataInput"
>;

type ProposedRepairRejectionReason =
  | "current_editor_unavailable"
  | "language_mismatch"
  | "candidate_is_not_a_repair"
  | "repair_delta_not_locatable";

type RunCodeOriginMetadata = {
  codeOrigin: "user_current_editor" | "assistant_candidate";
  evidenceKind: "current_editor_run" | "candidate_run";
  currentCodeHash: string | null;
  executedCodeHash: string;
  executionFingerprint: string;
  matchesCurrentCode: boolean;
  userMessageSequence?: number;
  candidateDescription?: string;
};

type RunCodeEvidenceBoundary = {
  producer: "assistant_tool";
  subject: "current_user_code" | "assistant_candidate";
  authority: "advisory";
  scope: {
    kind: "selected_suite" | "specific_examples" | "runner_defined";
    totalCount?: number;
  };
  oracle: "stored_expected" | "provided_expected" | "runner";
};

export async function runCurrentCodeChatTool(
  args: ChatToolArgs<"run_current_code">,
  context: RunCodeContext,
): Promise<ChatToolResult<"run_current_code">> {
  const resolvedCode = context.workspace?.code;
  const resolvedLanguage = context.workspace?.language;

  if (!resolvedCode?.trim() || !resolvedLanguage) {
    throw new Error(
      "run_current_code requires current editor code and language.",
    );
  }

  const executedCodeHash =
    context.workspace?.codeHash ??
    hashCodeForRun({ language: resolvedLanguage, code: resolvedCode });
  const executionFingerprint =
    context.workspace?.executionFingerprint ??
    fingerprintCodeForExecution({
      language: resolvedLanguage,
      code: resolvedCode,
    });

  return runChatCodeWithTests({
    context,
    toolArgs: args,
    code: resolvedCode,
    language: resolvedLanguage,
    source: "chat_current_tool",
    attachLatestReviewAttempt: true,
    metadata: {
      codeOrigin: "user_current_editor",
      evidenceKind: "current_editor_run",
      currentCodeHash: executedCodeHash,
      executedCodeHash,
      executionFingerprint,
      matchesCurrentCode: true,
      userMessageSequence: context.userMessageSequence,
    },
  });
}

export async function runVerifyProposedRepairChatTool(
  args: ChatToolArgs<"verify_proposed_repair">,
  context: RunCodeContext,
): Promise<ChatToolResult<"verify_proposed_repair">> {
  const rejection = validateProposedRepair(args, context);
  if (rejection) return rejection;

  const currentCodeHash =
    context.workspace?.codeHash ??
    (context.workspace?.code && context.workspace.language
      ? hashCodeForRun({
          language: context.workspace.language,
          code: context.workspace.code,
        })
      : null);
  const executedCodeHash = hashCodeForRun({
    language: args.language,
    code: args.candidateCode,
  });
  const executionFingerprint = fingerprintCodeForExecution({
    language: args.language,
    code: args.candidateCode,
  });

  const result = await runChatCodeWithTests({
    context,
    toolArgs: args,
    code: args.candidateCode,
    language: args.language,
    source: "chat_candidate_tool",
    attachLatestReviewAttempt: false,
    metadata: {
      codeOrigin: "assistant_candidate",
      evidenceKind: "candidate_run",
      currentCodeHash,
      executedCodeHash,
      executionFingerprint,
      matchesCurrentCode:
        currentCodeHash !== null && executedCodeHash === currentCodeHash,
      userMessageSequence: context.userMessageSequence,
      candidateDescription: args.repair.diagnosis,
    },
  });
  return {
    ...result,
    repairValidated: true,
    repairSummary: args.repair.diagnosis,
  };
}

function validateProposedRepair(
  args: ChatToolArgs<"verify_proposed_repair">,
  context: RunCodeContext,
): ChatToolResult<"verify_proposed_repair"> | undefined {
  const currentCode = context.workspace?.code;
  const currentLanguage = context.workspace?.language;
  if (!currentCode?.trim() || !currentLanguage) {
    return proposedRepairRejection(
      "current_editor_unavailable",
      "The current editor code is unavailable, so a proposed repair cannot be compared or verified.",
    );
  }
  if (currentLanguage !== args.language) {
    return proposedRepairRejection(
      "language_mismatch",
      "The proposed repair language must match the current editor language.",
    );
  }
  if (
    normalizedRepairProgram(currentCode) ===
    normalizedRepairProgram(args.candidateCode)
  ) {
    return proposedRepairRejection(
      "candidate_is_not_a_repair",
      "The supplied code is the current editor program modulo imports, comments, or formatting. Diagnose from the aligned evidence, or author a concrete repair before validating it.",
    );
  }
  const hasLocatableDelta = args.repair.edits.every(
    (edit) =>
      currentCode.includes(edit.before) &&
      args.candidateCode.includes(edit.after) &&
      normalizedRepairProgram(edit.before) !== normalizedRepairProgram(edit.after),
  );
  if (!hasLocatableDelta) {
    return proposedRepairRejection(
      "repair_delta_not_locatable",
      "Each declared repair edit must name a changed fragment from the current editor and its replacement in the proposed repair code.",
    );
  }
  return undefined;
}

function normalizedRepairProgram(code: string) {
  return code
    .replace(/^\s*(?:from\s+\S+\s+import\s+.+|import\s+.+)$/gmu, "")
    .replace(/#.*/gu, "")
    .replace(/\s+/gu, "");
}

function proposedRepairRejection(
  reason: ProposedRepairRejectionReason,
  message: string,
): ChatToolResult<"verify_proposed_repair"> {
  return {
    repairValidated: false,
    reason,
    message,
    llmObservation: {
      observationKind: "proposed_repair_rejected",
      repairValidated: false,
      reason,
      message,
      modelInstruction:
        "No code was run. Do not describe this as execution evidence. Diagnose the learner's current code from the aligned run already supplied, or author a concrete repair before calling verify_proposed_repair again.",
    },
  };
}

async function runChatCodeWithTests(args: {
  context: RunCodeContext;
  toolArgs: RunCodeArgsWithTests;
  code: string;
  language: CodeRunnerLanguage;
  source: "chat_current_tool" | "chat_candidate_tool";
  attachLatestReviewAttempt: boolean;
  metadata: RunCodeOriginMetadata;
}): Promise<ChatToolResult<"run_current_code">> {
  const context = args.context;
  const latestReviewAttempt = await context.prisma.reviewAttempt.findFirst({
    where: {
      userId: context.userId,
      problemId: context.problem.id,
      chatSessionId: context.chatSessionId,
      memoryOrigin: context.memoryOrigin,
    },
    orderBy: { createdAt: "desc" },
  });
  const testCases =
    normalizeProvidedTests(args.toolArgs.tests) ??
    normalizeDataInput(args.toolArgs.dataInput) ??
    normalizeWorkspaceTests(context.workspace?.selectedTests) ??
    (latestReviewAttempt
      ? parseStoredTests(latestReviewAttempt.selectedTestsJson)
      : undefined) ??
    (await loadVisibleTests(context));

  if (!testCases || testCases.length === 0) {
    throw new Error(`${args.source} requires at least one visible or provided test.`);
  }

  const evidenceBoundary = buildRunCodeEvidenceBoundary({
    toolArgs: args.toolArgs,
    metadata: args.metadata,
    totalCount: testCases.length,
  });
  const suiteFingerprint = hashSelectedTestSuite(
    testCases.map((testCase) => testCase.id),
  );

  const result = await runCodeWithTests(
    {
      problem: {
        slug: context.problem.slug,
        title: context.problem.title,
        leetcodeNumber: context.problem.leetcodeNumber,
        methodName: context.problem.methodName,
        tags: context.problemTags,
        inputContract: parseJson(context.problem.inputContractJson, undefined),
        outputContract: parseJson(context.problem.outputContractJson, undefined),
        isDemoSupported: context.problem.isDemoSupported,
        localRunStatus: context.problem.localRunStatus,
        localRunStatusMessage: context.problem.localRunStatusMessage,
        comparisonStrategy: context.problem.comparisonStrategy,
        comparisonConfig: parseJson(context.problem.comparisonConfigJson, {}),
        contractKind: context.problem.contractKind,
      },
      language: args.language,
      code: args.code,
      testCases,
      executionKind: "chat_run",
    },
    context.codeRunnerProvider,
  );
  const evidenceVerdict = evidenceVerdictForOrigin(
    result,
    args.metadata.codeOrigin,
  );

  const runEvidence = await context.prisma.runEvidence.create({
    data: {
      reviewAttemptId: args.attachLatestReviewAttempt
        ? latestReviewAttempt?.id
        : null,
      chatSessionId: context.chatSessionId,
      source: args.source,
      toolCallId: context.toolCallId,
      codeHash: args.metadata.executedCodeHash,
      executionFingerprint: args.metadata.executionFingerprint,
      status: result.status,
      passedCount: result.passedCount,
      failedCount: result.failedCount,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      actualOutput: result.actualOutput,
      expectedOutput: result.expectedOutput,
      firstFailedCaseJson: result.firstFailedCase
        ? JSON.stringify(result.firstFailedCase)
        : null,
      rawResultJson: JSON.stringify(
        runResultWithEvidenceVerdict(result, evidenceVerdict, {
          ...args.metadata,
          ...evidenceBoundary,
          suiteFingerprint,
        }),
      ),
      memoryOrigin: context.memoryOrigin,
    },
  });

  const modelInstruction = evidenceVerdict.modelInstruction;

  return {
    runEvidenceId: runEvidence.id,
    reviewAttemptId: args.attachLatestReviewAttempt
      ? latestReviewAttempt?.id ?? null
      : null,
    chatSessionId: context.chatSessionId,
    codeHash: args.metadata.executedCodeHash,
    executionFingerprint: args.metadata.executionFingerprint,
    executedCodeHash: args.metadata.executedCodeHash,
    currentCodeHash: args.metadata.currentCodeHash,
    matchesCurrentCode: args.metadata.matchesCurrentCode,
    codeOrigin: args.metadata.codeOrigin,
    evidenceKind: args.metadata.evidenceKind,
    ...evidenceBoundary,
    candidateDescription: args.metadata.candidateDescription,
    result,
    evidenceVerdict,
    modelInstruction,
    llmObservation: buildRunCodeLlmObservation({
      runEvidenceId: runEvidence.id,
      reviewAttemptId: args.attachLatestReviewAttempt
        ? latestReviewAttempt?.id ?? null
        : null,
      chatSessionId: context.chatSessionId,
      metadata: args.metadata,
      evidenceBoundary,
      result,
      evidenceVerdict,
      modelInstruction,
    }),
  };
}

function runResultWithEvidenceVerdict<T extends { rawResult?: unknown }>(
  result: T,
  evidenceVerdict: EvidenceVerdict,
  metadata: RunCodeOriginMetadata &
    RunCodeEvidenceBoundary & { suiteFingerprint?: string },
) {
  return {
    ...result,
    rawResult: {
      ...rawResultRecord(result.rawResult),
      evidenceVerdict,
      chatRunContext: metadata,
    },
  };
}

function evidenceVerdictForOrigin(
  result: CodeRunResult,
  codeOrigin: RunCodeOriginMetadata["codeOrigin"],
): EvidenceVerdict {
  const verdict = classifyExecutionEvidence(result, {
    consumer: "chat_run",
    providerUsed: readProviderUsed(result),
  });

  const advisoryVerdict = {
    ...verdict,
    capabilities: {
      ...verdict.capabilities,
      canWriteMistakeMemory: false,
      canWriteEpisode: false,
      canSignalPlanner: false,
      canUseFailureSalience: false,
    },
  };

  if (codeOrigin !== "assistant_candidate") {
    return {
      ...advisoryVerdict,
      modelInstruction: [
        verdict.modelInstruction,
        "This is an assistant-triggered advisory observation. Use it only within this turn and only for its declared scope; do not treat it as durable learner evidence or a planner signal.",
      ].join(" "),
    };
  }

  return {
    ...advisoryVerdict,
    modelInstruction: [
      verdict.modelInstruction,
      "This is assistant candidate-code evidence only. Use it to describe the candidate edit, never as proof that the user's current editor code passed or failed.",
    ].join(" "),
  };
}

function buildRunCodeEvidenceBoundary(args: {
  toolArgs: RunCodeArgsWithTests;
  metadata: RunCodeOriginMetadata;
  totalCount: number;
}): RunCodeEvidenceBoundary {
  const hasProvidedTests = Boolean(args.toolArgs.tests?.length);
  const hasRunnerInput = Boolean(args.toolArgs.dataInput?.trim());

  return {
    producer: "assistant_tool",
    subject:
      args.metadata.codeOrigin === "assistant_candidate"
        ? "assistant_candidate"
        : "current_user_code",
    authority: "advisory",
    scope: {
      kind: hasProvidedTests
        ? "specific_examples"
        : hasRunnerInput
          ? "runner_defined"
          : "selected_suite",
      totalCount: args.totalCount,
    },
    oracle: hasProvidedTests
      ? "provided_expected"
      : hasRunnerInput
        ? "runner"
        : "stored_expected",
  };
}

function rawResultRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildRunCodeLlmObservation(args: {
  runEvidenceId: string;
  reviewAttemptId: string | null;
  chatSessionId: string;
  metadata: RunCodeOriginMetadata;
  evidenceBoundary: RunCodeEvidenceBoundary;
  result: ChatToolResult<"run_current_code">["result"];
  evidenceVerdict: EvidenceVerdict;
  modelInstruction: string;
}): ChatToolResult<"run_current_code">["llmObservation"] {
  const redactedFields: string[] = [];
  const result = args.result;
  const actualOutput = compactStructuredText(
    result.actualOutput,
    "result.actualOutput",
    redactedFields,
  );
  const expectedOutput = compactStructuredText(
    result.expectedOutput,
    "result.expectedOutput",
    redactedFields,
  );

  const rawRunnerPayloadWithheld = result.rawResult !== undefined;

  if (result.firstFailedCase?.input !== undefined) {
    redactedFields.push("result.firstFailedCase.input");
  }

  if (result.testResults.length > 0) {
    redactedFields.push("result.testResults");
  }

  const errorDetail = result.errorDetail
    ? {
        kind: result.errorDetail.kind,
        title:
          compactStructuredText(
            result.errorDetail.title,
            "result.errorDetail.title",
            redactedFields,
          ) ?? result.errorDetail.kind,
        summary:
          compactStructuredText(
            result.errorDetail.summary,
            "result.errorDetail.summary",
            redactedFields,
          ) ?? "",
        likelyCauses: result.errorDetail.likelyCauses
          .slice(0, 3)
          .map(
            (cause, index) =>
              compactStructuredText(
                cause,
                `result.errorDetail.likelyCauses.${index}`,
                redactedFields,
              ) ?? "",
          )
          .filter(Boolean),
        nextStep: compactStructuredText(
          result.errorDetail.nextStep,
          "result.errorDetail.nextStep",
          redactedFields,
        ),
      }
    : undefined;

  if (result.errorDetail?.rawMessage) {
    redactedFields.push("result.errorDetail.rawMessage");
  }

  return {
    observationKind: "run_code_compact_observation",
    runEvidenceId: args.runEvidenceId,
    reviewAttemptId: args.reviewAttemptId,
    chatSessionId: args.chatSessionId,
    matchesCurrentCode: args.metadata.matchesCurrentCode,
    codeOrigin: args.metadata.codeOrigin,
    evidenceKind: args.metadata.evidenceKind,
    ...args.evidenceBoundary,
    candidateDescription: args.metadata.candidateDescription,
    status: result.status,
    failureProvenance: result.failureProvenance,
    passedCount: result.passedCount,
    failedCount: result.failedCount,
    durationMs: result.durationMs,
    actualOutput,
    expectedOutput,
    firstFailedCase: result.firstFailedCase
      ? {
          id: result.firstFailedCase.id,
          label:
            compactStructuredText(
              result.firstFailedCase.label,
              "result.firstFailedCase.label",
              redactedFields,
            ) ?? "failed case",
          actualOutput: compactStructuredValue(
            result.firstFailedCase.actual,
            "result.firstFailedCase.actual",
            redactedFields,
          ),
          expectedOutput: compactStructuredValue(
            result.firstFailedCase.expected,
            "result.firstFailedCase.expected",
            redactedFields,
          ),
          errorSummary: compactStructuredText(
            result.firstFailedCase.error,
            "result.firstFailedCase.error",
            redactedFields,
          ),
          errorLocation: result.firstFailedCase.errorLocation,
        }
      : undefined,
    errorLocation: result.errorLocation,
    errorDetail,
    testResultSummary: summarizeTestResults(result.testResults),
    stdoutSummary: summarizeUntrustedStream(
      result.stdout,
      "result.stdout",
      redactedFields,
    ),
    stderrSummary: summarizeUntrustedStream(
      result.stderr,
      "result.stderr",
      redactedFields,
    ),
    rawRunnerPayloadWithheld,
    untrustedOutputRedacted:
      rawRunnerPayloadWithheld || redactedFields.length > 0,
    redactedFields: [...new Set(redactedFields)],
    evidenceVerdict: args.evidenceVerdict,
    modelInstruction: args.modelInstruction,
  };
}

const COMPACT_TEXT_LIMIT = 180;

function compactStructuredValue(
  value: unknown,
  fieldPath: string,
  redactedFields: string[],
) {
  if (value === undefined) {
    return undefined;
  }

  return compactStructuredText(
    stringifyStructuredValue(value),
    fieldPath,
    redactedFields,
  );
}

function compactStructuredText(
  value: string | null | undefined,
  fieldPath: string,
  redactedFields: string[],
) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = value.replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return "";
  }

  if (looksLikePromptInstruction(normalized)) {
    redactedFields.push(fieldPath);
    return `[redacted untrusted text: ${describeText(normalized)}]`;
  }

  if (normalized.length > COMPACT_TEXT_LIMIT || lineCount(normalized) > 6) {
    redactedFields.push(fieldPath);
    return `[truncated untrusted text: ${describeText(normalized)}]`;
  }

  return normalized;
}

function summarizeUntrustedStream(
  value: string,
  fieldPath: string,
  redactedFields: string[],
) {
  if (!value) {
    return undefined;
  }

  redactedFields.push(fieldPath);
  const instructionNote = looksLikePromptInstruction(value)
    ? "; instruction-like text detected and withheld"
    : "";

  return `Captured ${describeText(value)}; raw stream text withheld from the model observation${instructionNote}.`;
}

function summarizeTestResults(testResults: CodeRunTestResult[]) {
  if (testResults.length === 0) {
    return undefined;
  }

  return {
    total: testResults.length,
    passed: testResults.filter((test) => test.passed).length,
    failed: testResults.filter((test) => !test.passed).length,
    errored: testResults.filter((test) =>
      ["compile_error", "runtime_error", "timeout", "internal_error"].includes(
        test.status ?? "",
      ),
    ).length,
  };
}

function stringifyStructuredValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeText(value: string) {
  return `${value.length} chars, ${lineCount(value)} line(s)`;
}

function lineCount(value: string) {
  return value.length === 0 ? 0 : value.split(/\r\n|\r|\n/).length;
}

function looksLikePromptInstruction(value: string) {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

const PROMPT_INJECTION_PATTERNS = [
  /\bsystem\s*:/i,
  /\b(user|assistant|developer|tool)\s*:/i,
  /\b(leetcode\s+)?accepted\b/i,
  /\b(leetcode\s+)?AC\b/,
  /\bhidden tests?\b.{0,32}\b(pass(?:ed)?|success|succeed(?:ed)?|green)\b/i,
  /\bpassed all hidden tests?\b/i,
  /隐藏测试.{0,12}(通过|全过|都过|过了)/,
  /(官方|LeetCode).{0,12}(AC|Accepted|通过)/i,
  /LEETCODE_SESSION|session\s+token/i,
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|messages|system)/i,
  /disregard\s+(previous|prior|above)\s+(instructions|messages|system)/i,
  /system\s+prompt/i,
  /developer\s+(message|instruction)/i,
  /you\s+are\s+(chatgpt|an?\s+ai|now)/i,
  /jailbreak/i,
  /忽略.*(之前|以上|系统|指令)/,
  /系统提示|开发者消息/,
] as const;

function normalizeProvidedTests(
  tests: ChatToolArgs<"run_current_code">["tests"],
): CodeRunTestCase[] | undefined {
  if (!tests || tests.length === 0) {
    return undefined;
  }

  return tests.map((test, index) => ({
    id: `chat-tool-test-${index + 1}`,
    label: test.label,
    input: test.input,
    expected: test.expected,
    source: "chat_tool",
  }));
}

function normalizeDataInput(dataInput: string | undefined): CodeRunTestCase[] | undefined {
  if (!dataInput?.trim()) {
    return undefined;
  }

  return [
    {
      id: "chat-tool-leetcode-input",
      label: "LeetCode run input",
      input: dataInput,
      expected: null,
      source: "chat_tool",
    },
  ];
}

function normalizeWorkspaceTests(
  tests: CodeRunTestCase[] | undefined,
): CodeRunTestCase[] | undefined {
  return tests && tests.length > 0 ? tests : undefined;
}

function parseStoredTests(value: string): CodeRunTestCase[] | undefined {
  const parsed = parseJson<
    Array<{
      id?: string;
      label?: string;
      input?: unknown;
      expected?: unknown;
      source?: string;
    }>
  >(value, []);

  if (parsed.length === 0) {
    return undefined;
  }

  return parsed.map((test, index) => ({
    id: test.id ?? `stored-visible-test-${index + 1}`,
    label: test.label ?? `visible test ${index + 1}`,
    input: test.input,
    expected: test.expected,
    source: test.source ?? "visible",
  }));
}

async function loadVisibleTests(context: RunCodeContext) {
  const tests = await context.prisma.problemTestCase.findMany({
    where: {
      problemId: context.problem.id,
      isVisible: true,
      OR: [{ userId: null }, { userId: context.userId }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  if (tests.length === 0) {
    return undefined;
  }

  return tests.map((test) => ({
    id: test.id,
    label: test.label,
    input: parseJson(test.inputJson, null),
    expected: parseJson(test.expectedJson, null),
    source: test.source,
  }));
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
