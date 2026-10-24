import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { getLocalUserAndProfile } from "@/server/agents/coach-agent/review-pipeline";
import { chatReply } from "@/server/agents/coach-agent/chat-reply";
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
import { buildSyntheticEvalTraceRequest } from "./eval-trace-invocation";
import { evalReportPaths } from "./report";
import { parseRepeats } from "./review-comparison-suite";
import { loadReviewReplayCases } from "./replay-run-evidence";
import {
  loadTrajectoryDataset,
  type TrajectoryDataset,
  type TrajectoryDatasetCase,
} from "./trajectory-dataset";
import {
  computeTrajectorySuiteScore,
  type TrajectoryRunObservation,
} from "./trajectory-metrics";
import {
  TRAJECTORY_SUITE_LIMITATIONS,
  TRAJECTORY_SUITE_NAME,
  type TrajectorySuiteFailedRun,
  type TrajectorySuiteReport,
  type TrajectorySuiteRunResult,
  writeTrajectorySuiteReport,
} from "./trajectory-report";

export type TrajectorySuiteOptions = {
  dbInput?: string;
  keepDb?: boolean;
  repeats?: number;
  outputDir?: string;
  now?: Date;
  cwd?: string;
  recordRunEvidence?: boolean;
  datasetPath?: string;
};

type TrajectoryRuntime = {
  database: EvalDatabaseConfig;
  runtime: EvalRuntimeConfig & {
    prisma?: PrismaClient;
  };
};

type SeededRun = {
  userId: string;
  problemId: string;
  problemSlug: string;
  chatSessionId: string;
  selectedTestCaseIds: string[];
};

type L1TraceRow = Awaited<ReturnType<typeof loadCaseTraceRows>>[number];

export async function runTrajectorySuite(
  options: TrajectorySuiteOptions,
): Promise<TrajectorySuiteReport> {
  const repeats = parseRepeats(options.repeats);

  if (options.recordRunEvidence) {
    throw new Error(
      "Record mode is not implemented for Task 2B; trajectory suite uses replay fixtures only.",
    );
  }

  const timestamp = options.now ?? new Date();
  const dataset = loadTrajectoryDataset({ datasetPath: options.datasetPath });
  const database = resolveEvalDatabaseConfig({
    suiteName: TRAJECTORY_SUITE_NAME,
    dbInput: options.dbInput,
    timestamp,
    cwd: options.cwd,
  });
  const runtime: TrajectoryRuntime = {
    database,
    runtime: {
      prisma: undefined as unknown as PrismaClient,
      dbPath: database.dbPath,
      suiteName: TRAJECTORY_SUITE_NAME,
      runId: `eval-${TRAJECTORY_SUITE_NAME}-${randomUUID()}`,
      generatedAt: timestamp,
      backgroundJobsPolicy: "disabled",
      traceOptions: {
        enabled: true,
      },
      reportPaths: evalReportPaths({
        suiteName: TRAJECTORY_SUITE_NAME,
        timestamp,
        outputDir: options.outputDir,
      }),
    },
  };
  const replayProvider = createTrajectoryReplayCodeRunner();
  let success = false;
  let report: TrajectorySuiteReport | undefined;

  try {
    runtime.runtime.prisma = initializeEvalDatabase(database);
    const runs: TrajectorySuiteRunResult[] = [];
    const failedRuns: TrajectorySuiteFailedRun[] = [];
    const observations: TrajectoryRunObservation[] = [];

    for (const trajectoryCase of dataset.cases) {
      for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
        const seeded = await seedTrajectoryRun({
          prisma: runtime.runtime.prisma,
          trajectoryCase,
          repeatIndex,
        });
        let failedMessage: string | undefined;

        try {
          const traceRequest = buildSyntheticEvalTraceRequest(
            {
              suiteName: TRAJECTORY_SUITE_NAME,
              runId: runtime.runtime.runId,
              caseId: trajectoryCase.caseId,
              repeatIndex,
            },
            timestamp,
          );
          await chatReply(
            {
              chatSessionId: seeded.chatSessionId,
              message: trajectoryCase.userMessage,
              language: trajectoryCase.language,
              code: trajectoryCase.code,
              selectedTestCaseIds: seeded.selectedTestCaseIds,
              responseLanguage: "zh",
              ...traceRequest,
            },
            {
              prisma: runtime.runtime.prisma,
              codeRunnerProvider: replayProvider.forCase(trajectoryCase),
              backgroundJobsPolicy: "disabled",
              traceStoreCutoverEnabled: true,
            },
          );
        } catch (error) {
          failedMessage = error instanceof Error ? error.message : String(error);
          failedRuns.push({
            caseId: trajectoryCase.caseId,
            repeatIndex,
            category: trajectoryCase.category,
            message: failedMessage,
          });
        }

        const traceRows = await loadCaseTraceRows(
          runtime.runtime.prisma,
          seeded.chatSessionId,
        );
        const observation = buildTrajectoryObservation({
          trajectoryCase,
          repeatIndex,
          failed: Boolean(failedMessage),
          rows: traceRows,
        });
        observations.push(observation);
        runs.push({
          caseId: trajectoryCase.caseId,
          repeatIndex,
          category: trajectoryCase.category,
          chatSessionId: seeded.chatSessionId,
          traceRunId: observation.traceRunId,
          toolCalls: observation.toolCalls,
          toolResults: observation.toolResults,
          finalReplyLength: observation.finalReply.length,
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
    const score = computeTrajectorySuiteScore({
      runs: observations,
      cases: dataset.cases,
    });
    const dbKept = Boolean(options.keepDb) || failedRuns.length > 0;

    report = buildTrajectorySuiteReport({
      runtime,
      dataset,
      repeats,
      dbKept,
      observability,
      runs,
      failedRuns,
      score,
    });
    writeTrajectorySuiteReport(report);

    success = true;
    return report;
  } finally {
    await runtime.runtime.prisma?.$disconnect().catch(() => undefined);

    if (success && !options.keepDb && existsSync(runtime.runtime.dbPath)) {
      removeEvalDatabase(runtime.runtime.dbPath);
    }
  }
}

async function seedTrajectoryRun(args: {
  prisma: PrismaClient;
  trajectoryCase: TrajectoryDatasetCase;
  repeatIndex: number;
}): Promise<SeededRun> {
  const { user } = await getLocalUserAndProfile(args.prisma);
  const useCanonicalProblemSlug =
    args.trajectoryCase.category === "hint_request_requires_algorithm_hint";
  const slug = useCanonicalProblemSlug
    ? args.trajectoryCase.problem.slug
    : `${args.trajectoryCase.problem.slug}-traj-${args.trajectoryCase.caseId}-${args.repeatIndex}`;
  const problemData = {
    slug,
    title: args.trajectoryCase.problem.title,
    leetcodeNumber: useCanonicalProblemSlug
      ? args.trajectoryCase.problem.leetcodeNumber
      : null,
    statementMarkdown: `Eval trajectory fixture for ${args.trajectoryCase.problem.title}. Original LeetCode #${args.trajectoryCase.problem.leetcodeNumber}.`,
    methodName: methodNameForSlug(args.trajectoryCase.problem.slug),
    tags: JSON.stringify(args.trajectoryCase.problem.tags),
    inputContractJson: JSON.stringify({ kind: "trajectory_eval_fixture" }),
    outputContractJson: JSON.stringify({ kind: "trajectory_eval_fixture" }),
    comparisonStrategy: "exact",
    comparisonConfigJson: JSON.stringify({}),
    contractKind: "pure_function",
    isDemoSupported: true,
    localRunStatus: "ready",
  };
  const problem = useCanonicalProblemSlug
    ? await args.prisma.problem.upsert({
        where: { slug },
        update: problemData,
        create: problemData,
      })
    : await args.prisma.problem.create({
        data: problemData,
      });
  const selectedTestCaseIds: string[] = [];

  if (useCanonicalProblemSlug) {
    await args.prisma.chatSession.deleteMany({
      where: {
        userId: user.id,
        problemId: problem.id,
      },
    });
    await args.prisma.algorithmHintProgress.deleteMany({
      where: {
        userId: user.id,
        problemId: problem.id,
      },
    });
  }

  for (const [index, test] of args.trajectoryCase.selectedTests.entries()) {
    const row = await args.prisma.problemTestCase.create({
      data: {
        problemId: problem.id,
        label: test.label,
        inputJson: JSON.stringify(test.input),
        expectedJson: JSON.stringify(test.expected),
        source: "trajectory_eval",
        expectedSource: "trajectory_eval",
        validationStatus: "checked",
        metadataJson: JSON.stringify({ caseId: args.trajectoryCase.caseId }),
        isVisible: true,
        sortOrder: index,
      },
    });
    selectedTestCaseIds.push(row.id);
  }

  for (const fact of args.trajectoryCase.memorySeed?.mistakeFacts ?? []) {
    await args.prisma.l2MemoryFact.upsert({
      where: {
        userId_factType_tag_memoryOrigin: {
          userId: user.id,
          factType: "mistake",
          tag: fact.tag,
          memoryOrigin: "evaluation",
        },
      },
      update: {
        label: fact.label,
        value: fact.value,
        confidence: 0.9,
        evidenceCount: { increment: 1 },
        lastEvidenceSummary: fact.lastEvidenceSummary,
        status: "active",
        memoryOrigin: "evaluation",
        source: "trajectory_eval_seed",
        lastSeenAt: new Date(),
      },
      create: {
        userId: user.id,
        problemId: problem.id,
        factType: "mistake",
        tag: fact.tag,
        label: fact.label,
        value: fact.value,
        confidence: 0.9,
        evidenceCount: 1,
        lastEvidenceSummary: fact.lastEvidenceSummary,
        status: "active",
        memoryOrigin: "evaluation",
        source: "trajectory_eval_seed",
        evidenceTraceIds: JSON.stringify([]),
      },
    });
  }

  for (const episode of args.trajectoryCase.memorySeed?.problemEpisodes ?? []) {
    const episodeProblem = await args.prisma.problem.create({
      data: {
        slug: `${episode.problem.slug}-traj-history-${args.trajectoryCase.caseId}-${args.repeatIndex}`,
        title: episode.problem.title,
        leetcodeNumber: null,
        statementMarkdown: `Eval trajectory history fixture for ${episode.problem.title}.`,
        methodName: methodNameForSlug(episode.problem.slug),
        tags: JSON.stringify(episode.problem.tags),
        inputContractJson: JSON.stringify({ kind: "trajectory_history_fixture" }),
        outputContractJson: JSON.stringify({ kind: "trajectory_history_fixture" }),
        comparisonStrategy: "exact",
        comparisonConfigJson: JSON.stringify({}),
        contractKind: "pure_function",
        isDemoSupported: false,
        localRunStatus: "not_ready",
      },
    });
    await args.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: episodeProblem.id,
        kind: "review",
        title: episode.title,
        summary: episode.summary,
        outcome: episode.outcome,
        tags: JSON.stringify(episode.tags),
        salience: 0.9,
        sourceTraceIds: JSON.stringify([
          `trajectory:${args.trajectoryCase.caseId}:${args.repeatIndex}`,
        ]),
        memoryOrigin: "evaluation",
      },
    });
  }

  const chatSession = await args.prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "evaluation",
      title: `${args.trajectoryCase.caseId} r${args.repeatIndex}`,
      primaryLanguage: "zh",
      isActive: true,
    },
  });

  return {
    userId: user.id,
    problemId: problem.id,
    problemSlug: slug,
    chatSessionId: chatSession.id,
    selectedTestCaseIds,
  };
}

async function loadCaseTraceRows(prisma: PrismaClient, chatSessionId: string) {
  return loadFormalTraceProjection(prisma, {
    chatSessionId,
    eventTypes: ["tool_call", "tool_result", "chat_reply"],
    order: "asc",
  });
}

function buildTrajectoryObservation(args: {
  trajectoryCase: TrajectoryDatasetCase;
  repeatIndex: number;
  failed: boolean;
  rows: L1TraceRow[];
}): TrajectoryRunObservation & { traceRunId: string | null } {
  const toolCalls: string[] = [];
  const toolResults: TrajectoryRunObservation["toolResults"] = [];
  let finalReply = "";
  let traceRunId: string | null = null;

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
      });
    }

    if (row.eventType === "chat_reply") {
      finalReply = row.content ?? "";
    }
  }

  return {
    caseId: args.trajectoryCase.caseId,
    repeatIndex: args.repeatIndex,
    category: args.trajectoryCase.category,
    toolCalls,
    toolResults,
    finalReply,
    failed: args.failed,
    traceRunId,
  };
}

function buildTrajectorySuiteReport(args: {
  runtime: TrajectoryRuntime;
  dataset: TrajectoryDataset;
  repeats: number;
  dbKept: boolean;
  observability: ReturnType<typeof buildAgentObservabilityReport>;
  runs: TrajectorySuiteRunResult[];
  failedRuns: TrajectorySuiteFailedRun[];
  score: ReturnType<typeof computeTrajectorySuiteScore>;
}): TrajectorySuiteReport {
  const categoryCounts: Record<string, number> = {};
  const intentStyleCounts: Record<string, number> = {};
  for (const trajectoryCase of args.dataset.cases) {
    categoryCounts[trajectoryCase.category] =
      (categoryCounts[trajectoryCase.category] ?? 0) + 1;
    intentStyleCounts[trajectoryCase.intentStyle] =
      (intentStyleCounts[trajectoryCase.intentStyle] ?? 0) + 1;
  }

  const humanReviewPendingCount = args.dataset.cases.filter(
    (trajectoryCase) => trajectoryCase.humanReviewStatus !== "approved",
  ).length;
  const warnings = [
    ...args.observability.warnings,
    ...(humanReviewPendingCount > 0
      ? [
          `${humanReviewPendingCount} trajectory dataset cases have tool expectations pending human review.`,
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
    suiteName: TRAJECTORY_SUITE_NAME,
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
      intentStyleCounts,
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
    limitations: TRAJECTORY_SUITE_LIMITATIONS,
    warnings: [...new Set(warnings)],
    reportPaths: args.runtime.runtime.reportPaths,
  };
}

function createTrajectoryReplayCodeRunner(): {
  forCase: (trajectoryCase: TrajectoryDatasetCase) => CodeRunnerProvider;
} {
  const fixtures = new Map(
    loadReviewReplayCases().map((fixture) => [fixture.id, fixture.runResult]),
  );

  return {
    forCase: (trajectoryCase) => ({
      async run(input: CodeRunnerInput): Promise<CodeRunResult> {
        const fixtureId = trajectoryCase.runCodeReplayFixtureId;
        if (!fixtureId) {
          throw new Error(
            `No replay run-code fixture configured for trajectory case ${trajectoryCase.caseId}; live runners are disabled in eval.`,
          );
        }
        const result = fixtures.get(fixtureId);
        if (!result) {
          throw new Error(
            `Replay run-code fixture ${fixtureId} was not found for trajectory case ${trajectoryCase.caseId}.`,
          );
        }

        return {
          ...result,
          durationMs: result.durationMs ?? 0,
          rawResult: {
            ...(result.rawResult && typeof result.rawResult === "object"
              ? result.rawResult
              : {}),
            providerUsed: "trajectory_replay",
            executionKind: input.executionKind ?? "chat_run",
            trajectoryCaseId: trajectoryCase.caseId,
            replayFixtureId: fixtureId,
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
