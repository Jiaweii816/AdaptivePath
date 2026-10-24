import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import type {
  CoachProvider,
  CoachReviewInput,
} from "@/server/agents/coach-agent/coach-agent.types";
import { chatReply } from "@/server/agents/coach-agent/chat-reply";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { getLocalUserAndProfile } from "@/server/agents/coach-agent/review-pipeline";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  buildAgentObservabilityReport,
  loadAgentObservabilityRows,
} from "@/server/observability/agent-observability";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
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
import {
  buildSyntheticEvalTraceRequest,
  createSyntheticEvalReviewTraceContext,
  finalizeSyntheticEvalReviewTraceContext,
} from "./eval-trace-invocation";
import { evalReportPaths } from "./report";
import { parseRepeats } from "./review-comparison-suite";
import {
  loadSafetyDataset,
  type SafetyDataset,
  type SafetyDatasetCase,
} from "./safety-dataset";
import {
  computeSafetySuiteScore,
  type SafetyRunObservation,
} from "./safety-metrics";
import {
  SAFETY_SUITE_LIMITATIONS,
  SAFETY_SUITE_NAME,
  type SafetySuiteFailedRun,
  type SafetySuiteReport,
  type SafetySuiteRunResult,
  writeSafetySuiteReport,
} from "./safety-report";

export type SafetySuiteOptions = {
  dbInput?: string;
  keepDb?: boolean;
  repeats?: number;
  outputDir?: string;
  now?: Date;
  cwd?: string;
  recordRunEvidence?: boolean;
  provider?: CoachProvider;
  datasetPath?: string;
};

type SafetyRuntime = {
  database: EvalDatabaseConfig;
  runtime: EvalRuntimeConfig & {
    prisma?: PrismaClient;
  };
};

type SeededSafetyRun = {
  userId: string;
  problemId: string;
  chatSessionId: string;
  selectedTestCaseIds: string[];
};

type L1TraceRow = Awaited<ReturnType<typeof loadSafetyTraceRows>>[number];

export async function runSafetySuite(
  options: SafetySuiteOptions,
): Promise<SafetySuiteReport> {
  const repeats = parseRepeats(options.repeats);

  if (options.recordRunEvidence) {
    throw new Error(
      "Record mode is not implemented for Task 2C; safety suite uses replay fixtures only.",
    );
  }

  const timestamp = options.now ?? new Date();
  const dataset = loadSafetyDataset({ datasetPath: options.datasetPath });
  const database = resolveEvalDatabaseConfig({
    suiteName: SAFETY_SUITE_NAME,
    dbInput: options.dbInput,
    timestamp,
    cwd: options.cwd,
  });
  const runtime: SafetyRuntime = {
    database,
    runtime: {
      prisma: undefined as unknown as PrismaClient,
      dbPath: database.dbPath,
      suiteName: SAFETY_SUITE_NAME,
      runId: `eval-${SAFETY_SUITE_NAME}-${randomUUID()}`,
      generatedAt: timestamp,
      backgroundJobsPolicy: "disabled",
      traceOptions: {
        enabled: true,
      },
      reportPaths: evalReportPaths({
        suiteName: SAFETY_SUITE_NAME,
        timestamp,
        outputDir: options.outputDir,
      }),
    },
  };
  const provider = options.provider ?? createQwenCoachProvider();
  const replayProvider = createSafetyReplayCodeRunner();
  let success = false;
  let report: SafetySuiteReport | undefined;
  let failedRuns: SafetySuiteFailedRun[] = [];

  try {
    runtime.runtime.prisma = initializeEvalDatabase(database);
    const runs: SafetySuiteRunResult[] = [];
    failedRuns = [];
    const observations: SafetyRunObservation[] = [];

    for (const safetyCase of dataset.cases) {
      for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
        const seeded = await seedSafetyRun({
          prisma: runtime.runtime.prisma,
          safetyCase,
          repeatIndex,
        });
        let failedMessage: string | undefined;

        try {
          if (safetyCase.path === "review") {
            await runReviewSafetyCase({
              runtime,
              seeded,
              safetyCase,
              repeatIndex,
              provider,
            });
          } else {
            const traceRequest = buildSyntheticEvalTraceRequest(
              {
                suiteName: SAFETY_SUITE_NAME,
                runId: runtime.runtime.runId,
                caseId: safetyCase.caseId,
                repeatIndex,
              },
              timestamp,
            );
            await chatReply(
              {
                chatSessionId: seeded.chatSessionId,
                message: safetyCase.userMessage,
                language: safetyCase.language,
                code: safetyCase.code,
                selectedTestCaseIds: seeded.selectedTestCaseIds,
                responseLanguage: "zh",
                ...traceRequest,
              },
              {
                prisma: runtime.runtime.prisma,
                coachProvider: provider,
                codeRunnerProvider: replayProvider.forCase(safetyCase),
                backgroundJobsPolicy: "disabled",
                traceStoreCutoverEnabled: true,
              },
            );
          }
        } catch (error) {
          failedMessage = error instanceof Error ? error.message : String(error);
          failedRuns.push({
            caseId: safetyCase.caseId,
            repeatIndex,
            category: safetyCase.category,
            path: safetyCase.path,
            injectionChannel: safetyCase.injectionChannel,
            message: failedMessage,
          });
        }

        const traceRows = await loadSafetyTraceRows(
          runtime.runtime.prisma,
          seeded.chatSessionId,
        );
        const observation = buildSafetyObservation({
          safetyCase,
          repeatIndex,
          failed: Boolean(failedMessage),
          failedMessage,
          rows: traceRows,
        });
        observations.push(observation);
        runs.push({
          caseId: safetyCase.caseId,
          repeatIndex,
          category: safetyCase.category,
          path: safetyCase.path,
          injectionChannel: safetyCase.injectionChannel,
          chatSessionId: seeded.chatSessionId,
          traceRunId: observation.traceRunId,
          toolCalls: observation.toolCalls,
          toolResults: observation.toolResults.map((result) => ({
            toolName: result.toolName,
            status: result.status,
            errorKind: result.errorKind,
          })),
          finalReplyLength: observation.finalReply.length,
          replySafetyReplaced: observation.replySafetyReplaced,
          failed: Boolean(failedMessage),
        });
      }
    }

    const rows = await loadAgentObservabilityRows(runtime.runtime.prisma);
    const observability = buildAgentObservabilityReport({
      rows,
      dbPath: runtime.runtime.dbPath,
      explicitDb: database.explicit,
      generatedAt: timestamp,
    });
    const score = computeSafetySuiteScore({
      runs: observations,
      dataset,
    });
    const dbKept = Boolean(options.keepDb) || failedRuns.length > 0;

    report = buildSafetySuiteReport({
      runtime,
      dataset,
      repeats,
      dbKept,
      observability,
      runs,
      failedRuns,
      score,
    });
    writeSafetySuiteReport(report);

    success = true;
    return report;
  } finally {
    await runtime.runtime.prisma?.$disconnect().catch(() => undefined);

    if (
      success &&
      !options.keepDb &&
      failedRuns.length === 0 &&
      existsSync(runtime.runtime.dbPath)
    ) {
      removeEvalDatabase(runtime.runtime.dbPath);
    }
  }
}

async function seedSafetyRun(args: {
  prisma: PrismaClient;
  safetyCase: SafetyDatasetCase;
  repeatIndex: number;
}): Promise<SeededSafetyRun> {
  const { user } = await getLocalUserAndProfile(args.prisma);
  const slug = `${args.safetyCase.problem.slug}-safety-${args.safetyCase.caseId}-${args.repeatIndex}`;
  const problem = await args.prisma.problem.create({
    data: {
      slug,
      title: args.safetyCase.problem.title,
      leetcodeNumber: null,
      statementMarkdown: `Eval safety fixture for ${args.safetyCase.problem.title}. Original LeetCode #${args.safetyCase.problem.leetcodeNumber}.`,
      methodName: args.safetyCase.problem.methodName,
      tags: JSON.stringify(args.safetyCase.problem.tags),
      inputContractJson: JSON.stringify({ kind: "safety_eval_fixture" }),
      outputContractJson: JSON.stringify({ kind: "safety_eval_fixture" }),
      comparisonStrategy: "exact",
      comparisonConfigJson: JSON.stringify({}),
      contractKind: "pure_function",
      isDemoSupported: true,
      localRunStatus: "ready",
    },
  });
  const selectedTestCaseIds: string[] = [];

  for (const [index, test] of args.safetyCase.selectedTests.entries()) {
    const row = await args.prisma.problemTestCase.create({
      data: {
        problemId: problem.id,
        label: test.label,
        inputJson: JSON.stringify(test.input),
        expectedJson: JSON.stringify(test.expected),
        source: "safety_eval",
        expectedSource: "safety_eval",
        validationStatus: "checked",
        metadataJson: JSON.stringify({ caseId: args.safetyCase.caseId }),
        isVisible: true,
        sortOrder: index,
      },
    });
    selectedTestCaseIds.push(row.id);
  }

  const chatSession = await args.prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "evaluation",
      title: `${args.safetyCase.caseId} r${args.repeatIndex}`,
      primaryLanguage: "zh",
      isActive: true,
    },
  });

  return {
    userId: user.id,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    selectedTestCaseIds,
  };
}

async function runReviewSafetyCase(args: {
  runtime: SafetyRuntime;
  seeded: SeededSafetyRun;
  safetyCase: SafetyDatasetCase;
  repeatIndex: number;
  provider: CoachProvider;
}) {
  const prisma = requirePrisma(args.runtime);
  const pathStartedAt = Date.now();
  const traceContext = await createSyntheticEvalReviewTraceContext({
    prisma,
    identity: {
      suiteName: SAFETY_SUITE_NAME,
      runId: args.runtime.runtime.runId,
      caseId: args.safetyCase.caseId,
      repeatIndex: args.repeatIndex,
    },
    occurredAt: args.runtime.runtime.generatedAt,
    userId: args.seeded.userId,
    task: "safety.review",
    problemId: args.seeded.problemId,
    chatSessionId: args.seeded.chatSessionId,
    language: args.safetyCase.language,
    code: args.safetyCase.code,
    selectedTestCaseIds: args.seeded.selectedTestCaseIds,
    runResult: args.safetyCase.runResult,
  });
  const input = buildSafetyReviewInput({
    safetyCase: args.safetyCase,
    traceContext,
  });
  let finalizationInvoked = false;
  try {
    const result = await args.provider.review(input);
    const totalMs = Date.now() - pathStartedAt;

    await appendL1TraceEvent(prisma, {
      userId: args.seeded.userId,
      problemId: args.seeded.problemId,
      chatSessionId: args.seeded.chatSessionId,
      eventType: "coach_reply",
      source: `eval:${SAFETY_SUITE_NAME}`,
      content: result.coachReply,
      eventJson: {
        traceRunId: traceContext.traceRunId,
        evalSuite: SAFETY_SUITE_NAME,
        datasetCaseId: args.safetyCase.caseId,
        repeatIndex: args.repeatIndex,
        category: args.safetyCase.category,
        injectionChannel: args.safetyCase.injectionChannel,
        path: args.safetyCase.path,
        runStatus: args.safetyCase.runResult?.status ?? null,
        degraded: result.degraded ?? null,
        replySafetyReplaced: Boolean(result.degraded?.safetyReplaced),
        timings: {
          totalMs,
          runnerMs: args.safetyCase.runResult?.durationMs ?? 0,
          llmMsTotal: traceContext.llmMsTotal,
        },
      },
    });
    finalizationInvoked = true;
    await finalizeSyntheticEvalReviewTraceContext({
      traceContext,
      status: "succeeded",
    });
  } catch (error) {
    if (!finalizationInvoked) {
      finalizationInvoked = true;
      try {
        await finalizeSyntheticEvalReviewTraceContext({
          traceContext,
          status: "failed",
          error,
        });
      } catch (finalizationError) {
        throw new AggregateError(
          [error, finalizationError],
          "Safety Review invocation and trace finalization failed.",
        );
      }
    }
    throw error;
  }
}

function buildSafetyReviewInput(args: {
  safetyCase: SafetyDatasetCase;
  traceContext: CoachReviewInput["traceContext"];
}): CoachReviewInput {
  if (!args.safetyCase.runResult) {
    throw new Error(`Missing runResult for review safety case ${args.safetyCase.caseId}.`);
  }

  return {
    problem: {
      slug: args.safetyCase.problem.slug,
      title: args.safetyCase.problem.title,
      leetcodeNumber: args.safetyCase.problem.leetcodeNumber,
      tags: args.safetyCase.problem.tags,
      methodName: args.safetyCase.problem.methodName,
      statementMarkdown: `Safety eval fixture for ${args.safetyCase.problem.title}.`,
    },
    user: {
      displayName: "Eval Safety Learner",
      strongPatterns: ["step-through"],
      weakPatterns: ["overclaiming evidence"],
      outputPreferences: ["concise markdown"],
    },
    memory: {
      profileId: "eval:safety-review",
      teachableMemories: [],
      outputPreferences: [],
      domainReferences: [],
      retrievalStatus: "full",
    },
    language: args.safetyCase.language,
    code: args.safetyCase.code,
    runResult: args.safetyCase.runResult,
    evidenceVerdict: args.safetyCase.evidenceVerdict,
    userQuestion: args.safetyCase.userMessage,
    userState: args.safetyCase.requiredSafeBehavior,
    responseLanguage: "zh",
    traceContext: args.traceContext,
  };
}

async function loadSafetyTraceRows(prisma: PrismaClient, chatSessionId: string) {
  return loadFormalTraceProjection(prisma, {
    chatSessionId,
    eventTypes: [
      "tool_call",
      "tool_result",
      "chat_reply",
      "coach_reply",
      "reply_safety_replaced",
    ],
    order: "asc",
  });
}

function buildSafetyObservation(args: {
  safetyCase: SafetyDatasetCase;
  repeatIndex: number;
  failed: boolean;
  failedMessage?: string;
  rows: L1TraceRow[];
}): SafetyRunObservation & { traceRunId: string | null } {
  const toolCalls: string[] = [];
  const toolResults: SafetyRunObservation["toolResults"] = [];
  let finalReply = "";
  let traceRunId: string | null = null;
  let replySafetyReplaced = false;

  for (const row of args.rows) {
    const eventJson = parseEventJson(row.eventJson);

    if (!traceRunId && typeof eventJson.traceRunId === "string") {
      traceRunId = eventJson.traceRunId;
    }

    if (row.eventType === "tool_call" && typeof eventJson.toolName === "string") {
      toolCalls.push(eventJson.toolName);
    }

    if (row.eventType === "tool_result") {
      toolResults.push({
        toolName:
          typeof eventJson.toolName === "string" ? eventJson.toolName : "unknown",
        status: typeof eventJson.status === "string" ? eventJson.status : "unknown",
        errorKind:
          typeof eventJson.errorKind === "string" ? eventJson.errorKind : null,
        result: eventJson.result,
      });
    }

    if (row.eventType === "reply_safety_replaced") {
      replySafetyReplaced = true;
      if (typeof eventJson.replacement === "string") {
        finalReply = eventJson.replacement;
      }
    }

    if (row.eventType === "chat_reply" || row.eventType === "coach_reply") {
      finalReply = row.content ?? "";
      if (eventJson.replySafetyReplaced === true) {
        replySafetyReplaced = true;
      }
    }
  }

  return {
    caseId: args.safetyCase.caseId,
    repeatIndex: args.repeatIndex,
    category: args.safetyCase.category,
    injectionChannel: args.safetyCase.injectionChannel,
    path: args.safetyCase.path,
    finalReply,
    failed: args.failed,
    failedMessage: args.failedMessage,
    replySafetyReplaced,
    toolCalls,
    toolResults,
    traceRunId,
  };
}

function buildSafetySuiteReport(args: {
  runtime: SafetyRuntime;
  dataset: SafetyDataset;
  repeats: number;
  dbKept: boolean;
  observability: ReturnType<typeof buildAgentObservabilityReport>;
  runs: SafetySuiteRunResult[];
  failedRuns: SafetySuiteFailedRun[];
  score: ReturnType<typeof computeSafetySuiteScore>;
}): SafetySuiteReport {
  const categoryCounts: Record<string, number> = {};
  const injectionChannelCounts: Record<string, number> = {};
  const codeDisclosureCounts: Record<string, number> = {};

  for (const safetyCase of args.dataset.cases) {
    categoryCounts[safetyCase.category] =
      (categoryCounts[safetyCase.category] ?? 0) + 1;
    injectionChannelCounts[safetyCase.injectionChannel] =
      (injectionChannelCounts[safetyCase.injectionChannel] ?? 0) + 1;
    codeDisclosureCounts[safetyCase.codeDisclosure] =
      (codeDisclosureCounts[safetyCase.codeDisclosure] ?? 0) + 1;
  }

  const humanReviewPendingCount = args.dataset.cases.filter(
    (safetyCase) => safetyCase.humanReviewStatus !== "approved",
  ).length;
  const warnings = [
    ...args.observability.warnings,
    ...(humanReviewPendingCount > 0
      ? [
          `${humanReviewPendingCount} safety dataset cases have safety truth pending human review.`,
        ]
      : []),
    ...(args.failedRuns.length > 0
      ? [`${args.failedRuns.length} case/repeat runs failed; failures are reported as eval data, not silently skipped.`]
      : []),
    ...(args.repeats < 3
      ? [
          `This run used repeats=${args.repeats}; Week2 reporting guidance expects n=3 before using rates in external narration.`,
        ]
      : []),
  ];

  return {
    suiteName: SAFETY_SUITE_NAME,
    runId: args.runtime.runtime.runId,
    generatedAt: args.runtime.runtime.generatedAt.toISOString(),
    dbPath: args.runtime.runtime.dbPath,
    dbExplicit: args.runtime.database.explicit,
    dbKept: args.dbKept,
    repeats: args.repeats,
    dataset: {
      name: args.dataset.name,
      version: args.dataset.datasetVersion,
      status: args.dataset.status,
      caseCount: args.dataset.cases.length,
      categoryCounts,
      injectionChannelCounts,
      codeDisclosureCounts,
      humanReviewPendingCount,
    },
    backgroundJobsPolicy: args.runtime.runtime.backgroundJobsPolicy,
    traceOptions: args.runtime.runtime.traceOptions,
    successfulRunCount: args.runs.filter((run) => !run.failed).length,
    failedRunCount: args.failedRuns.length,
    score: args.score,
    observability: {
      sampleCounts: args.observability.sampleCounts,
      providerUsage: args.observability.providerUsage,
      review: {
        count: args.observability.review.count,
        traceRunCount: args.observability.review.traceRunCount,
        llmCallCount: args.observability.review.llmCallCount,
        tokens: args.observability.review.tokens,
        latency: args.observability.review.latency,
      },
      chat: {
        count: args.observability.chat.count,
        traceRunCount: args.observability.chat.traceRunCount,
        llmCallCount: args.observability.chat.llmCallCount,
        tokens: args.observability.chat.tokens,
        latency: args.observability.chat.latency,
        toolCallsPerChat: args.observability.chat.toolCallsPerChat,
      },
      toolCalls: args.observability.toolCalls,
      warningCount: args.observability.warningCount,
      warnings: args.observability.warnings,
    },
    runs: args.runs,
    failedRuns: args.failedRuns,
    limitations: SAFETY_SUITE_LIMITATIONS,
    warnings: [...new Set(warnings)],
    reportPaths: args.runtime.runtime.reportPaths,
  };
}

function createSafetyReplayCodeRunner(): {
  forCase: (safetyCase: SafetyDatasetCase) => CodeRunnerProvider;
} {
  return {
    forCase: (safetyCase) => ({
      async run(input: CodeRunnerInput): Promise<CodeRunResult> {
        if (!safetyCase.toolRunResult) {
          throw new Error(
            `No replay run-code fixture configured for safety case ${safetyCase.caseId}; live runners are disabled in eval.`,
          );
        }

        return {
          ...safetyCase.toolRunResult,
          durationMs: safetyCase.toolRunResult.durationMs ?? 0,
          rawResult: {
            ...(safetyCase.toolRunResult.rawResult &&
            typeof safetyCase.toolRunResult.rawResult === "object" &&
            !Array.isArray(safetyCase.toolRunResult.rawResult)
              ? safetyCase.toolRunResult.rawResult
              : {}),
            providerUsed: "safety_replay",
            executionKind: input.executionKind ?? "chat_run",
            safetyCaseId: safetyCase.caseId,
          },
        };
      },
    }),
  };
}

function parseEventJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function requirePrisma(runtime: SafetyRuntime) {
  if (!runtime.runtime.prisma) {
    throw new Error("Eval DB was not initialized for safety suite.");
  }

  return runtime.runtime.prisma;
}
