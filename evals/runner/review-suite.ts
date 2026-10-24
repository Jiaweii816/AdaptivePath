import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import type {
  CoachProvider,
  CoachReviewInput,
} from "@/server/agents/coach-agent/coach-agent.types";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  buildAgentObservabilityReport,
  loadAgentObservabilityRows,
} from "@/server/observability/agent-observability";
import {
  initializeEvalDatabase,
  removeEvalDatabase,
  resolveEvalDatabaseConfig,
  type EvalDatabaseConfig,
} from "./db";
import type { EvalRuntimeConfig } from "./eval-runtime";
import {
  createSyntheticEvalReviewTraceContext,
  finalizeSyntheticEvalReviewTraceContext,
} from "./eval-trace-invocation";
import {
  loadReviewDataset,
  type ReviewDataset,
  type ReviewDatasetCase,
} from "./review-dataset";
import { computeReviewSuiteScore } from "./review-metrics";
import {
  REVIEW_SUITE_LIMITATIONS,
  REVIEW_SUITE_NAME,
  type ReviewSuiteFailedRun,
  type ReviewSuiteReport,
  type ReviewSuiteRunResult,
  writeReviewSuiteReport,
} from "./review-report";
import { evalReportPaths } from "./report";
import { parseRepeats } from "./review-comparison-suite";

export type ReviewSuiteOptions = {
  dbInput?: string;
  keepDb?: boolean;
  repeats?: number;
  outputDir?: string;
  now?: Date;
  cwd?: string;
  recordRunEvidence?: boolean;
  provider?: CoachProvider;
  datasetPath?: string;
  fixtureDir?: string;
};

type ReviewRuntime = {
  database: EvalDatabaseConfig;
  runtime: EvalRuntimeConfig & {
    prisma?: PrismaClient;
  };
};

type SeededReviewSuite = {
  userId: string;
  problemsByCaseId: Map<string, { id: string; chatSessionId: string }>;
};

export async function runReviewSuite(
  options: ReviewSuiteOptions,
): Promise<ReviewSuiteReport> {
  const repeats = parseRepeats(options.repeats);

  if (options.recordRunEvidence) {
    throw new Error(
      "Record mode is not implemented for Task 2A; review suite uses replay fixtures only.",
    );
  }

  const timestamp = options.now ?? new Date();
  const dataset = loadReviewDataset({
    datasetPath: options.datasetPath,
    fixtureDir: options.fixtureDir,
  });
  const database = resolveEvalDatabaseConfig({
    suiteName: REVIEW_SUITE_NAME,
    dbInput: options.dbInput,
    timestamp,
    cwd: options.cwd,
  });
  const runtime: ReviewRuntime = {
    database,
    runtime: {
      prisma: undefined as unknown as PrismaClient,
      dbPath: database.dbPath,
      suiteName: REVIEW_SUITE_NAME,
      runId: `eval-${REVIEW_SUITE_NAME}-${randomUUID()}`,
      generatedAt: timestamp,
      backgroundJobsPolicy: "disabled",
      traceOptions: {
        enabled: true,
      },
      reportPaths: evalReportPaths({
        suiteName: REVIEW_SUITE_NAME,
        timestamp,
        outputDir: options.outputDir,
      }),
    },
  };
  const provider = options.provider ?? createQwenCoachProvider();
  let success = false;
  let report: ReviewSuiteReport | undefined;

  try {
    runtime.runtime.prisma = initializeEvalDatabase(database);
    const seeded = await seedReviewSuite(runtime.runtime.prisma, dataset);
    const runs: ReviewSuiteRunResult[] = [];
    const failedRuns: ReviewSuiteFailedRun[] = [];

    await runReviewCases({
      runtime,
      seeded,
      dataset,
      repeats,
      provider,
      runs,
      failedRuns,
    });

    const rows = await loadAgentObservabilityRows(runtime.runtime.prisma);
    const observability = buildAgentObservabilityReport({
      rows,
      dbPath: runtime.runtime.dbPath,
      explicitDb: database.explicit,
      generatedAt: timestamp,
    });
    const score = computeReviewSuiteScore({
      runs: runs.map((run) => ({
        caseId: run.caseId,
        repeatIndex: run.repeatIndex,
        bugCategory: run.bugCategory,
        predictedTags: run.predictedTags,
        goldenTags: run.goldenTags,
        coachReply: getRunReply(run, rows),
      })),
      cases: dataset.cases,
    });

    applyEvidenceScoresToRuns(runs, score);

    const dbKept = Boolean(options.keepDb) || failedRuns.length > 0;
    report = buildReviewSuiteReport({
      runtime,
      dataset,
      repeats,
      dbKept,
      observability,
      runs,
      failedRuns,
      score,
    });
    writeReviewSuiteReport(report);

    success = failedRuns.length === 0;
    return report;
  } finally {
    await runtime.runtime.prisma?.$disconnect().catch(() => undefined);

    if (success && !options.keepDb && existsSync(runtime.runtime.dbPath)) {
      removeEvalDatabase(runtime.runtime.dbPath);
    }
  }
}

async function seedReviewSuite(
  prisma: PrismaClient,
  dataset: ReviewDataset,
): Promise<SeededReviewSuite> {
  const user = await prisma.user.create({
    data: {
      handle: `eval-review-${randomUUID()}`,
    },
  });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      displayName: "Eval Review Learner",
      interviewGoal: "review-coachbench",
      preferredLanguages: JSON.stringify(["Python"]),
      strongPatterns: JSON.stringify(["step-through"]),
      weakPatterns: JSON.stringify(["boundary cases"]),
      explanationStyle: JSON.stringify(["concise", "evidence-first"]),
      outputPreferences: JSON.stringify(["markdown"]),
    },
  });

  const problemsBySlug = new Map<string, string>();
  const chatSessionsByProblemId = new Map<string, string>();
  const problemsByCaseId = new Map<string, { id: string; chatSessionId: string }>();

  for (const reviewCase of dataset.cases) {
    let problemId = problemsBySlug.get(reviewCase.problem.slug);

    if (!problemId) {
      const problem = await prisma.problem.create({
        data: {
          slug: reviewCase.fixture.problem.slug,
          title: reviewCase.fixture.problem.title,
          leetcodeNumber: reviewCase.fixture.problem.leetcodeNumber,
          statementMarkdown: reviewCase.fixture.problem.statementMarkdown ?? "",
          methodName: reviewCase.fixture.problem.methodName,
          tags: JSON.stringify(reviewCase.fixture.problem.tags),
          inputContractJson: JSON.stringify({
            kind: "eval_replay_fixture",
          }),
          outputContractJson: JSON.stringify({
            kind: "eval_replay_fixture",
          }),
          comparisonStrategy: "exact",
          comparisonConfigJson: JSON.stringify({}),
          contractKind: "pure_function",
        },
      });
      problemId = problem.id;
      problemsBySlug.set(reviewCase.problem.slug, problemId);
    }

    let chatSessionId = chatSessionsByProblemId.get(problemId);

    if (!chatSessionId) {
      const chatSession = await prisma.chatSession.create({
        data: {
          userId: user.id,
          problemId,
          memoryOrigin: "evaluation",
          title: `${reviewCase.problem.title} review eval`,
          primaryLanguage: "zh",
          isActive: true,
        },
      });
      chatSessionId = chatSession.id;
      chatSessionsByProblemId.set(problemId, chatSessionId);
    }

    problemsByCaseId.set(reviewCase.caseId, {
      id: problemId,
      chatSessionId,
    });
  }

  return {
    userId: user.id,
    problemsByCaseId,
  };
}

async function runReviewCases(args: {
  runtime: ReviewRuntime;
  seeded: SeededReviewSuite;
  dataset: ReviewDataset;
  repeats: number;
  provider: CoachProvider;
  runs: ReviewSuiteRunResult[];
  failedRuns: ReviewSuiteFailedRun[];
}) {
  for (const reviewCase of args.dataset.cases) {
    const problemState = args.seeded.problemsByCaseId.get(reviewCase.caseId);

    if (!problemState) {
      throw new Error(`Missing seeded problem for case ${reviewCase.caseId}.`);
    }

    for (let repeatIndex = 0; repeatIndex < args.repeats; repeatIndex += 1) {
      const pathStartedAt = Date.now();
      const prisma = requirePrisma(args.runtime);
      const traceContext = await createSyntheticEvalReviewTraceContext({
        prisma,
        identity: {
          suiteName: REVIEW_SUITE_NAME,
          runId: args.runtime.runtime.runId,
          caseId: reviewCase.caseId,
          repeatIndex,
        },
        occurredAt: args.runtime.runtime.generatedAt,
        userId: args.seeded.userId,
        task: "review.diagnose_and_reply",
        problemId: problemState.id,
        chatSessionId: problemState.chatSessionId,
        language: reviewCase.fixture.language,
        code: reviewCase.fixture.code,
        runResult: reviewCase.fixture.runResult,
      });
      const input = buildReviewInput({
        reviewCase,
        traceContext,
      });

      let finalizationInvoked = false;
      try {
        const result = await args.provider.review(input);
        const totalMs = Date.now() - pathStartedAt;
        await appendL1TraceEvent(prisma, {
          userId: args.seeded.userId,
          problemId: problemState.id,
          chatSessionId: problemState.chatSessionId,
          eventType: "coach_reply",
          source: `eval:${REVIEW_SUITE_NAME}`,
          content: result.coachReply,
          eventJson: {
            traceRunId: traceContext.traceRunId,
            evalSuite: REVIEW_SUITE_NAME,
            datasetName: args.dataset.name,
            datasetVersion: args.dataset.datasetVersion,
            caseId: reviewCase.caseId,
            repeatIndex,
            bugCategory: reviewCase.bugCategory,
            goldenMistakeTags: reviewCase.goldenMistakeTags,
            predictedMistakeTags: result.diagnosis.mistakeTags,
            runStatus: reviewCase.fixture.runResult.status,
            degraded: result.degraded ?? null,
            timings: {
              totalMs,
              runnerMs: reviewCase.fixture.runResult.durationMs ?? 0,
              llmMsTotal: traceContext.llmMsTotal,
            },
          },
        });
        finalizationInvoked = true;
        await finalizeSyntheticEvalReviewTraceContext({
          traceContext,
          status: "succeeded",
        });
        args.runs.push({
          caseId: reviewCase.caseId,
          repeatIndex,
          traceRunId: traceContext.traceRunId,
          bugCategory: reviewCase.bugCategory,
          predictedTags: result.diagnosis.mistakeTags,
          goldenTags: reviewCase.goldenMistakeTags,
          coachReplyLength: result.coachReply.length,
          degraded: Boolean(result.degraded),
          totalMs,
          llmMsTotal: traceContext.llmMsTotal,
          evidenceGrounded: false,
          matchedEvidenceMarkers: [],
        });
      } catch (error) {
        let failure = error;
        if (!finalizationInvoked) {
          finalizationInvoked = true;
          try {
            await finalizeSyntheticEvalReviewTraceContext({
              traceContext,
              status: "failed",
              error,
            });
          } catch (finalizationError) {
            failure = new AggregateError(
              [error, finalizationError],
              "Review eval invocation and trace finalization failed.",
            );
          }
        }
        args.failedRuns.push({
          caseId: reviewCase.caseId,
          repeatIndex,
          message: failure instanceof Error ? failure.message : String(failure),
        });
      }
    }
  }
}

function buildReviewInput(args: {
  reviewCase: ReviewDatasetCase;
  traceContext: CoachReviewInput["traceContext"];
}): CoachReviewInput {
  return {
    problem: args.reviewCase.fixture.problem,
    user: {
      displayName: "Eval Review Learner",
      strongPatterns: ["step-through"],
      weakPatterns: ["boundary cases"],
      outputPreferences: ["concise markdown"],
    },
    memory: {
      profileId: "eval:review",
      teachableMemories: [],
      outputPreferences: [],
      domainReferences: [],
      retrievalStatus: "full",
    },
    language: args.reviewCase.fixture.language,
    code: args.reviewCase.fixture.code,
    runResult: args.reviewCase.fixture.runResult,
    evidenceVerdict: args.reviewCase.fixture.evidenceVerdict,
    userQuestion: args.reviewCase.fixture.userQuestion,
    userState: args.reviewCase.fixture.userState,
    responseLanguage: "zh",
    traceContext: args.traceContext,
  };
}

function buildReviewSuiteReport(args: {
  runtime: ReviewRuntime;
  dataset: ReviewDataset;
  repeats: number;
  dbKept: boolean;
  observability: ReturnType<typeof buildAgentObservabilityReport>;
  runs: ReviewSuiteRunResult[];
  failedRuns: ReviewSuiteFailedRun[];
  score: ReturnType<typeof computeReviewSuiteScore>;
}): ReviewSuiteReport {
  const sourceCounts: Record<string, number> = {};
  const bucketCaseCounts: Record<string, number> = {};

  for (const reviewCase of args.dataset.cases) {
    sourceCounts[reviewCase.source] = (sourceCounts[reviewCase.source] ?? 0) + 1;
    bucketCaseCounts[reviewCase.bugCategory] =
      (bucketCaseCounts[reviewCase.bugCategory] ?? 0) + 1;
  }

  const humanReviewPendingCount = args.dataset.cases.filter(
    (reviewCase) => reviewCase.humanReviewStatus === "pending",
  ).length;
  const humanApprovedCount = args.dataset.cases.filter(
    (reviewCase) => reviewCase.humanReviewStatus === "approved",
  ).length;
  const humanRejectedCount = args.dataset.cases.filter(
    (reviewCase) => reviewCase.humanReviewStatus === "rejected",
  ).length;
  const warnings = [
    ...args.observability.warnings,
    ...(humanReviewPendingCount > 0
      ? [
          `${humanReviewPendingCount} review dataset cases have golden labels pending human review.`,
        ]
      : []),
    ...(args.failedRuns.length > 0
      ? [`${args.failedRuns.length} case/repeat runs failed.`]
      : []),
    ...(humanRejectedCount > 0
      ? [`${humanRejectedCount} review dataset cases are marked rejected.`]
      : []),
  ];

  return {
    suiteName: REVIEW_SUITE_NAME,
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
      sources: sourceCounts,
      bucketCaseCounts,
      humanApprovedCount,
      humanReviewPendingCount,
      humanRejectedCount,
    },
    backgroundJobsPolicy: args.runtime.runtime.backgroundJobsPolicy,
    traceOptions: args.runtime.runtime.traceOptions,
    successfulRunCount: args.runs.length,
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
      warningCount: args.observability.warningCount,
      warnings: args.observability.warnings,
    },
    runs: args.runs,
    failedRuns: args.failedRuns,
    limitations: REVIEW_SUITE_LIMITATIONS,
    warnings: [...new Set(warnings)],
    reportPaths: args.runtime.runtime.reportPaths,
  };
}

function getRunReply(
  run: ReviewSuiteRunResult,
  rows: Awaited<ReturnType<typeof loadAgentObservabilityRows>>,
) {
  const row = rows.find((candidate) => {
    if (candidate.eventType !== "coach_reply") {
      return false;
    }

    try {
      const eventJson = JSON.parse(candidate.eventJson) as {
        traceRunId?: unknown;
      };
      return eventJson.traceRunId === run.traceRunId;
    } catch {
      return false;
    }
  });

  return row?.content ?? "";
}

function applyEvidenceScoresToRuns(
  runs: ReviewSuiteRunResult[],
  score: ReturnType<typeof computeReviewSuiteScore>,
) {
  const scoreByRun = new Map(
    score.cases.map((item) => [`${item.caseId}\u001f${item.repeatIndex}`, item]),
  );

  for (const run of runs) {
    const item = scoreByRun.get(`${run.caseId}\u001f${run.repeatIndex}`);
    if (!item) {
      continue;
    }
    run.evidenceGrounded = item.evidenceGrounded;
    run.matchedEvidenceMarkers = item.matchedEvidenceMarkers;
  }
}

function requirePrisma(runtime: ReviewRuntime) {
  if (!runtime.runtime.prisma) {
    throw new Error("Eval DB was not initialized for review suite.");
  }

  return runtime.runtime.prisma;
}
