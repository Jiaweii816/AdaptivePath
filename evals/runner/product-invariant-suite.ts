import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "@/lib/env";
import { chatReply } from "@/server/agents/coach-agent/chat-reply";
import type {
  CoachChatInput,
  CoachChatTurnResult,
  CoachProvider,
} from "@/server/agents/coach-agent/coach-agent.types";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { getLocalUserAndProfile } from "@/server/agents/coach-agent/review-pipeline";
import { hashCodeForRun } from "@/server/code/code-hash";
import {
  buildAgentObservabilityReport,
  loadAgentObservabilityRows,
} from "@/server/observability/agent-observability";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
import { exportRuntimeTraceSession } from "@/server/observability/runtime-trace-export";
import type {
  CodeRunnerInput,
  CodeRunnerProvider,
} from "@/server/tools/code-runner/code-runner.types";
import type { CodeRunResult } from "@/types/code-runner";
import {
  initializeEvalDatabase,
  removeEvalDatabase,
  resolveEvalDatabaseConfig,
  type EvalDatabaseConfig,
} from "./db";
import type { EvalRuntimeConfig } from "./eval-runtime";
import { buildSyntheticEvalTraceRequest } from "./eval-trace-invocation";
import {
  loadProductInvariantDataset,
  type ProductInvariantDatasetCase,
} from "./product-invariant-dataset";
import {
  computeProductInvariantSuiteScore,
  type ProductInvariantObservation,
} from "./product-invariant-metrics";
import {
  PRODUCT_INVARIANT_SUITE_LIMITATIONS,
  PRODUCT_INVARIANT_SUITE_NAME,
  writeProductInvariantSuiteReport,
  type ProductInvariantSuiteReport,
} from "./product-invariant-report";
import { evalReportPaths } from "./report";
import { parseRepeats } from "./review-comparison-suite";
import {
  evaluateTraceArchitectureInvariants,
  type TraceArchitectureInvariantReport,
} from "./trace-architecture-invariants";

export type ProductInvariantSuiteOptions = {
  dbInput?: string;
  keepDb?: boolean;
  repeats?: number;
  outputDir?: string;
  now?: Date;
  cwd?: string;
  recordRunEvidence?: boolean;
  datasetPath?: string;
  /** Unit-test seam only. The CLI never supplies this and always requires the real provider. */
  testProvider?: CoachProvider;
};

type ProductInvariantRuntime = {
  database: EvalDatabaseConfig;
  runtime: EvalRuntimeConfig & { prisma?: PrismaClient };
};

type SeededCase = {
  userId: string;
  problemId: string;
  chatSessionId: string;
  selectedTestCaseIds: string[];
};

type RunnerCounter = {
  replayCalls: number;
  unexpectedCalls: number;
  externalCalls: number;
};

export async function runProductInvariantSuite(
  options: ProductInvariantSuiteOptions,
): Promise<ProductInvariantSuiteReport> {
  loadLocalEnv();
  if (!options.testProvider) {
    assertRealChatConfiguration();
  }
  if (options.recordRunEvidence) {
    throw new Error(
      "Product-invariant eval is replay-only; --record-run-evidence is forbidden.",
    );
  }

  const repeats = parseRepeats(options.repeats);
  const timestamp = options.now ?? new Date();
  const dataset = loadProductInvariantDataset({
    datasetPath: options.datasetPath,
  });
  const database = resolveEvalDatabaseConfig({
    suiteName: PRODUCT_INVARIANT_SUITE_NAME,
    dbInput: options.dbInput,
    timestamp,
    cwd: options.cwd,
  });
  const runtime: ProductInvariantRuntime = {
    database,
    runtime: {
      prisma: undefined,
      dbPath: database.dbPath,
      suiteName: PRODUCT_INVARIANT_SUITE_NAME,
      runId: `eval-${PRODUCT_INVARIANT_SUITE_NAME}-${randomUUID()}`,
      generatedAt: timestamp,
      backgroundJobsPolicy: "disabled",
      traceOptions: { enabled: true },
      reportPaths: evalReportPaths({
        suiteName: PRODUCT_INVARIANT_SUITE_NAME,
        timestamp,
        outputDir: options.outputDir,
      }),
    },
  };
  const recordingProvider = createRecordingProvider(
    options.testProvider ?? createQwenCoachProvider(),
  );
  const failedRuns: ProductInvariantSuiteReport["failedRuns"] = [];
  const observations: ProductInvariantObservation[] = [];
  let report: ProductInvariantSuiteReport | undefined;
  let success = false;

  try {
    runtime.runtime.prisma = initializeEvalDatabase(database);

    for (const datasetCase of dataset.cases) {
      for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
        const seeded = await seedProductInvariantCase({
          prisma: runtime.runtime.prisma,
          datasetCase,
          repeatIndex,
        });
        const counter: RunnerCounter = {
          replayCalls: 0,
          unexpectedCalls: 0,
          externalCalls: 0,
        };
        const codeRunnerProvider = createIsolatedReplayRunner(
          datasetCase,
          counter,
        );
        recordingProvider.reset();
        let displayedReply = "";
        let failedMessage: string | undefined;
        let traceArchitecture: TraceArchitectureInvariantReport | undefined;

        try {
          const traceRequest = buildSyntheticEvalTraceRequest(
            {
              suiteName: PRODUCT_INVARIANT_SUITE_NAME,
              runId: runtime.runtime.runId,
              caseId: datasetCase.caseId,
              repeatIndex,
            },
            timestamp,
          );
          const result = await chatReply(
            {
              chatSessionId: seeded.chatSessionId,
              message: datasetCase.userMessage,
              language: datasetCase.language,
              code: datasetCase.code,
              selectedTestCaseIds: seeded.selectedTestCaseIds,
              responseLanguage: "zh",
              ...traceRequest,
            },
            {
              prisma: runtime.runtime.prisma,
              coachProvider: recordingProvider.provider,
              codeRunnerProvider,
              backgroundJobsPolicy: "disabled",
              traceStoreCutoverEnabled: true,
            },
          );
          displayedReply = result.coachReply;
          if (!result.trace) {
            throw new Error(
              `Product-invariant case ${datasetCase.caseId} returned no eval Trace Invocation.`,
            );
          }
          const traceExport = await exportRuntimeTraceSession(
            runtime.runtime.prisma,
            {
              userId: seeded.userId,
              sessionId: result.trace.workspaceSessionId,
            },
          );
          if (!traceExport) {
            throw new Error(
              `Product-invariant case ${datasetCase.caseId} trace export was unavailable.`,
            );
          }
          traceArchitecture = evaluateTraceArchitectureInvariants(traceExport, {
            rootTraceRunIds: [result.trace.traceRunId],
          });
        } catch (error) {
          failedMessage = error instanceof Error ? error.message : String(error);
          failedRuns.push({
            caseId: datasetCase.caseId,
            repeatIndex,
            message: failedMessage,
          });
        }

        const traceRows = await loadCaseTraceRows(
          runtime.runtime.prisma,
          seeded.chatSessionId,
        );
        observations.push(
          buildObservation({
            datasetCase,
            repeatIndex,
            rawLlmReply: recordingProvider.lastFinalReply(),
            displayedReply,
            failedMessage,
            counter,
            traceRows,
            traceArchitecture,
          }),
        );
      }
    }

    const rows = await loadAgentObservabilityRows(runtime.runtime.prisma);
    const observability = buildAgentObservabilityReport({
      rows,
      dbPath: database.dbPath,
      explicitDb: database.explicit,
      generatedAt: timestamp,
    });
    const score = computeProductInvariantSuiteScore({
      runs: observations,
      dataset,
    });
    const humanReviewPendingCount = dataset.cases.filter(
      (item) => item.humanReviewStatus !== "approved",
    ).length;
    const dbKept = Boolean(options.keepDb) || score.failCount > 0;
    const warnings = [
      ...observability.warnings,
      ...(humanReviewPendingCount
        ? [`${humanReviewPendingCount} product-invariant labels await human review.`]
        : []),
      ...(repeats < 3
        ? ["This is a one-repeat smoke; use repeats=3 for signoff."]
        : []),
      ...(score.rawViolationReplacementRecall.denominator === 0
        ? [
            "The real model produced no raw invariant violations in this run; replacement recall is n/a, not an assumed pass.",
          ]
        : []),
      ...(score.unexpectedRunnerCallCount > 0
        ? [
            `${score.unexpectedRunnerCallCount} unexpected code-runner request(s) were refused by the eval throwing provider; diagnostic only for this Product Invariant suite.`,
          ]
        : []),
    ];

    report = {
      suiteName: PRODUCT_INVARIANT_SUITE_NAME,
      runId: runtime.runtime.runId,
      generatedAt: timestamp.toISOString(),
      dbPath: database.dbPath,
      dbExplicit: database.explicit,
      dbKept,
      repeats,
      dataset: {
        name: dataset.name,
        version: dataset.datasetVersion,
        status: dataset.status,
        caseCount: dataset.cases.length,
        humanReviewPendingCount,
      },
      backgroundJobsPolicy: "disabled",
      score,
      observability: {
        sampleCounts: observability.sampleCounts,
        providerUsage: observability.providerUsage,
        chat: {
          count: observability.chat.count,
          traceRunCount: observability.chat.traceRunCount,
          llmCallCount: observability.chat.llmCallCount,
          tokens: observability.chat.tokens,
          latency: observability.chat.latency,
        },
        warningCount: observability.warningCount,
        warnings: observability.warnings,
      },
      failedRuns,
      limitations: PRODUCT_INVARIANT_SUITE_LIMITATIONS,
      warnings: [...new Set(warnings)],
      reportPaths: runtime.runtime.reportPaths,
    };
    writeProductInvariantSuiteReport(report);
    success = score.failCount === 0;
    return report;
  } finally {
    await runtime.runtime.prisma?.$disconnect().catch(() => undefined);
    if (success && !options.keepDb && existsSync(database.dbPath)) {
      removeEvalDatabase(database.dbPath);
    }
  }
}

function assertRealChatConfiguration() {
  if (!process.env.LLM_CHAT_API_KEY?.trim()) {
    throw new Error(
      "LLM_CHAT_API_KEY is required; product-invariant eval never skips or falls back to mock.",
    );
  }
  if (process.env.COACH_PROVIDER?.trim().toLowerCase() === "mock") {
    throw new Error(
      "COACH_PROVIDER=mock is forbidden for product-invariant real-LLM eval.",
    );
  }
  const disabled = process.env.CHAT_TOOLS_DISABLED?.trim().toLowerCase();
  if (disabled === "1" || disabled === "true") {
    throw new Error(
      "CHAT_TOOLS_DISABLED must be unset; product-invariant eval exercises the real tool-capable Chat path.",
    );
  }
}

function createRecordingProvider(delegate: CoachProvider) {
  let finalReplies: string[] = [];
  const provider: CoachProvider = {
    review: (input) => delegate.review(input),
    async chat(input: CoachChatInput): Promise<CoachChatTurnResult> {
      const result = await delegate.chat(input);
      if (result.type === "final") {
        finalReplies.push(result.coachReply);
      }
      return result;
    },
  };

  return {
    provider,
    reset() {
      finalReplies = [];
    },
    lastFinalReply() {
      return finalReplies.at(-1) ?? "";
    },
  };
}

async function seedProductInvariantCase(args: {
  prisma: PrismaClient;
  datasetCase: ProductInvariantDatasetCase;
  repeatIndex: number;
}): Promise<SeededCase> {
  const { user } = await getLocalUserAndProfile(args.prisma);
  const slug = `${args.datasetCase.problem.slug}-pi-${args.datasetCase.caseId}-${args.repeatIndex}`;
  const problem = await args.prisma.problem.create({
    data: {
      slug,
      title: args.datasetCase.problem.title,
      leetcodeNumber: null,
      statementMarkdown: `Product-invariant eval fixture for ${args.datasetCase.problem.title}.`,
      methodName: args.datasetCase.problem.methodName,
      tags: JSON.stringify(args.datasetCase.problem.tags),
      inputContractJson: JSON.stringify({ kind: "product_invariant_eval" }),
      outputContractJson: JSON.stringify({ kind: "product_invariant_eval" }),
      comparisonStrategy: "exact",
      comparisonConfigJson: JSON.stringify({}),
      contractKind: "pure_function",
      isDemoSupported: true,
      localRunStatus: "ready",
    },
  });
  const selectedTestCaseIds: string[] = [];
  for (const [index, test] of args.datasetCase.selectedTests.entries()) {
    const row = await args.prisma.problemTestCase.create({
      data: {
        problemId: problem.id,
        label: test.label,
        inputJson: JSON.stringify(test.input),
        expectedJson: JSON.stringify(test.expected),
        source: "product_invariant_eval",
        expectedSource: "product_invariant_eval",
        validationStatus: "checked",
        metadataJson: JSON.stringify({ fixtureId: test.id }),
        isVisible: true,
        sortOrder: index,
      },
    });
    selectedTestCaseIds.push(row.id);
  }
  const codeDraft = await args.prisma.codeDraft.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      language: args.datasetCase.language,
      content: args.datasetCase.code,
      selectedTestCaseIds: JSON.stringify(selectedTestCaseIds),
    },
  });
  const chatSession = await args.prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "evaluation",
      title: `${args.datasetCase.caseId} r${args.repeatIndex}`,
      primaryLanguage: "zh",
      isActive: true,
    },
  });

  if (args.datasetCase.authoritativeEvidence) {
    const result = buildAuthoritativeResult(args.datasetCase);
    await args.prisma.practiceRunLog.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        codeDraftId: codeDraft.id,
        language: args.datasetCase.language,
        codeHash: hashCodeForRun({
          language: args.datasetCase.language,
          code: args.datasetCase.code,
        }),
        runOrdinal: 1,
        selectedTestCaseIds: JSON.stringify(selectedTestCaseIds),
        status: result.status,
        passedCount: result.passedCount,
        totalCount: selectedTestCaseIds.length,
        summary: `${result.passedCount}/${selectedTestCaseIds.length} selected visible tests`,
        provider: "product_invariant_replay",
        rawResultJson: JSON.stringify(result),
      },
    });
  }

  return {
    userId: user.id,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    selectedTestCaseIds,
  };
}

function buildAuthoritativeResult(
  datasetCase: ProductInvariantDatasetCase,
): CodeRunResult {
  const evidence = datasetCase.authoritativeEvidence;
  if (!evidence) {
    throw new Error(`Missing authoritative evidence for ${datasetCase.caseId}.`);
  }
  const isPassed = evidence.status === "passed_visible_tests";
  return {
    status: evidence.status as CodeRunResult["status"],
    failureProvenance: "user_code",
    passedCount: evidence.passedCount,
    failedCount: evidence.failedCount,
    stdout: "",
    stderr: evidence.stderr,
    durationMs: 1,
    firstFailedCase:
      !isPassed && datasetCase.selectedTests[0]
        ? {
            ...datasetCase.selectedTests[0],
            actual: evidence.status === "timeout" ? undefined : "incorrect",
            error:
              evidence.status === "timeout"
                ? "Execution timed out"
                : "Visible expected output mismatch",
          }
        : undefined,
    testResults: isPassed
      ? datasetCase.selectedTests.map((test) => ({
          ...test,
          actual: test.expected,
          stdout: "",
          stderr: "",
          passed: true,
          status: "passed" as const,
        }))
      : [],
    rawResult: {
      providerUsed: "product_invariant_replay",
      executionKind: "visible_run",
    },
  };
}

function createIsolatedReplayRunner(
  datasetCase: ProductInvariantDatasetCase,
  counter: RunnerCounter,
): CodeRunnerProvider {
  return {
    async run(input: CodeRunnerInput) {
      if (!datasetCase.replayRunResult) {
        counter.unexpectedCalls += 1;
        throw new Error(
          `Unexpected code execution for ${datasetCase.caseId}; external runner fallback is disabled.`,
        );
      }
      counter.replayCalls += 1;
      return {
        ...datasetCase.replayRunResult,
        rawResult: {
          ...(asRecord(datasetCase.replayRunResult.rawResult) ?? {}),
          providerUsed: "product_invariant_replay",
          executionKind: input.executionKind ?? "chat_run",
          datasetCaseId: datasetCase.caseId,
        },
      };
    },
  };
}

async function loadCaseTraceRows(prisma: PrismaClient, chatSessionId: string) {
  return loadFormalTraceProjection(prisma, {
    chatSessionId,
    order: "asc",
  });
}

function buildObservation(args: {
  datasetCase: ProductInvariantDatasetCase;
  repeatIndex: number;
  rawLlmReply: string;
  displayedReply: string;
  failedMessage?: string;
  counter: RunnerCounter;
  traceRows: Array<{ eventType: string; eventJson: string; content: string | null }>;
  traceArchitecture?: TraceArchitectureInvariantReport;
}): ProductInvariantObservation {
  const toolCalls: string[] = [];
  const replacementReasons: string[] = [];
  const llmTraces: ProductInvariantObservation["llmTraces"] = [];

  for (const row of args.traceRows) {
    const json = asRecord(parseJson(row.eventJson)) ?? {};
    if (row.eventType === "tool_call" && typeof json.toolName === "string") {
      toolCalls.push(json.toolName);
    }
    if (
      row.eventType.includes("reply") &&
      row.eventType.includes("replaced") &&
      typeof json.reason === "string"
    ) {
      replacementReasons.push(json.reason);
    }
    if (row.eventType === "llm_call") {
      llmTraces.push({
        model: readString(json.model),
        responseModel: readString(json.responseModel),
        status: readString(json.status),
        usageSource: readString(json.usageSource),
      });
    }
  }

  return {
    caseId: args.datasetCase.caseId,
    repeatIndex: args.repeatIndex,
    category: args.datasetCase.category,
    rawLlmReply: args.rawLlmReply,
    displayedReply: args.displayedReply,
    replacementReasons: [...new Set(replacementReasons)],
    failed: Boolean(args.failedMessage),
    failedMessage: args.failedMessage,
    toolCalls,
    replayRunnerCalls: args.counter.replayCalls,
    unexpectedRunnerCalls: args.counter.unexpectedCalls,
    externalRunnerCalls: args.counter.externalCalls,
    llmTraces,
    traceArchitecture: args.traceArchitecture,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
