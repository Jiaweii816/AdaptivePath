import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { CoachProvider, CoachReviewInput } from "@/server/agents/coach-agent/coach-agent.types";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  buildAgentObservabilityReport,
  loadAgentObservabilityRows,
} from "@/server/observability/agent-observability";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";
import { createTwoCallReviewProvider } from "../experiments/two-call-review-provider";
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
import { evalReportPaths } from "./report";
import {
  computeDiagnosisTagStability,
  computeMutualDiagnosisTagConsistency,
  normalizeMistakeTags,
} from "./review-comparison-metrics";
import {
  DIAGNOSIS_F1_LIMITATION,
  REVIEW_COMPARISON_SUITE_NAME,
  SMALL_SAMPLE_LIMITATION,
  type ReviewComparisonArmName,
  type ReviewComparisonFailedRun,
  type ReviewComparisonReport,
  type ReviewComparisonRunResult,
  writeReviewComparisonReport,
} from "./review-comparison-report";
import { loadReviewReplayCases, type ReviewReplayCase } from "./replay-run-evidence";

export type ReviewComparisonSuiteOptions = {
  dbInput?: string;
  keepDb?: boolean;
  repeats?: number;
  outputDir?: string;
  now?: Date;
  cwd?: string;
  recordRunEvidence?: boolean;
  providers?: Partial<Record<ReviewComparisonArmName, CoachProvider>>;
};

const ARM_NAMES: ReviewComparisonArmName[] = ["one-call", "two-call"];

type ArmRuntime = {
  arm: ReviewComparisonArmName;
  database: EvalDatabaseConfig;
  runtime: EvalRuntimeConfig & {
    prisma?: PrismaClient;
  };
};

type SeededArm = {
  userId: string;
  problemsByCaseId: Map<string, { id: string; chatSessionId: string }>;
};

export async function runReviewComparisonSuite(
  options: ReviewComparisonSuiteOptions,
): Promise<ReviewComparisonReport> {
  const repeats = parseRepeats(options.repeats);

  if (options.recordRunEvidence) {
    throw new Error(
      "Record mode is not implemented for Task 1D; review-1call-vs-2call uses replay fixtures only.",
    );
  }

  const timestamp = options.now ?? new Date();
  const runId = `eval-${REVIEW_COMPARISON_SUITE_NAME}-${randomUUID()}`;
  const reportPaths = evalReportPaths({
    suiteName: REVIEW_COMPARISON_SUITE_NAME,
    timestamp,
    outputDir: options.outputDir,
  });
  const armRuntimes = ARM_NAMES.map((arm) =>
    createArmRuntime({
      arm,
      timestamp,
      runId,
      reportPaths,
      dbInput: options.dbInput,
      cwd: options.cwd,
    }),
  );
  const cases = loadReviewReplayCases();
  let success = false;
  let report: ReviewComparisonReport | undefined;

  try {
    for (const armRuntime of armRuntimes) {
      armRuntime.runtime.prisma = initializeEvalDatabase(armRuntime.database);
    }

    const seeded = new Map<ReviewComparisonArmName, SeededArm>();
    for (const armRuntime of armRuntimes) {
      if (!armRuntime.runtime.prisma) {
        throw new Error(`Eval DB was not initialized for arm ${armRuntime.arm}.`);
      }
      seeded.set(
        armRuntime.arm,
        await seedReviewComparisonArm(armRuntime.runtime.prisma, cases),
      );
    }

    const runs: ReviewComparisonRunResult[] = [];
    const failedRuns: ReviewComparisonFailedRun[] = [];

    for (const armRuntime of armRuntimes) {
      const provider =
        options.providers?.[armRuntime.arm] ?? defaultProviderForArm(armRuntime.arm);
      const seededArm = seeded.get(armRuntime.arm);

      if (!seededArm) {
        throw new Error(`Missing seed state for arm ${armRuntime.arm}.`);
      }

      await runArm({
        armRuntime,
        seededArm,
        cases,
        repeats,
        provider,
        runs,
        failedRuns,
      });
    }

    const observabilityByArm = new Map<
      ReviewComparisonArmName,
      ReturnType<typeof buildAgentObservabilityReport>
    >();

    for (const armRuntime of armRuntimes) {
      if (!armRuntime.runtime.prisma) {
        throw new Error(`Eval DB was not initialized for arm ${armRuntime.arm}.`);
      }
      const rows = await loadAgentObservabilityRows(armRuntime.runtime.prisma);
      observabilityByArm.set(
        armRuntime.arm,
        buildAgentObservabilityReport({
          rows,
          dbPath: armRuntime.runtime.dbPath,
          explicitDb: armRuntime.database.explicit,
          generatedAt: timestamp,
        }),
      );
    }

    const dbKept = Boolean(options.keepDb) || failedRuns.length > 0;
    report = buildReviewComparisonReport({
      armRuntimes,
      observabilityByArm,
      runs,
      failedRuns,
      timestamp,
      runId,
      repeats,
      caseCount: cases.length,
      dbKept,
      reportPaths,
    });
    writeReviewComparisonReport(report);

    success = failedRuns.length === 0;
    return report;
  } finally {
    for (const armRuntime of armRuntimes) {
      await armRuntime.runtime.prisma?.$disconnect().catch(() => undefined);
    }

    if (success && !options.keepDb) {
      for (const armRuntime of armRuntimes) {
        removeEvalDatabase(armRuntime.runtime.dbPath);
      }
    }
  }
}

export function parseRepeats(value: number | undefined): number {
  const repeats = value ?? 3;

  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error("--repeats must be a positive integer.");
  }

  return repeats;
}

export function resolveReviewComparisonArmDbConfigs(args: {
  dbInput?: string;
  timestamp: Date;
  cwd?: string;
}): Record<ReviewComparisonArmName, EvalDatabaseConfig> {
  return {
    "one-call": resolveEvalDatabaseConfig({
      suiteName: `${REVIEW_COMPARISON_SUITE_NAME}-one-call`,
      dbInput: armDbInput({
        dbInput: args.dbInput,
        timestamp: args.timestamp,
        arm: "one-call",
        cwd: args.cwd,
      }),
      timestamp: args.timestamp,
      cwd: args.cwd,
    }),
    "two-call": resolveEvalDatabaseConfig({
      suiteName: `${REVIEW_COMPARISON_SUITE_NAME}-two-call`,
      dbInput: armDbInput({
        dbInput: args.dbInput,
        timestamp: args.timestamp,
        arm: "two-call",
        cwd: args.cwd,
      }),
      timestamp: args.timestamp,
      cwd: args.cwd,
    }),
  };
}

function createArmRuntime(args: {
  arm: ReviewComparisonArmName;
  timestamp: Date;
  runId: string;
  reportPaths: { markdown: string; json: string };
  dbInput?: string;
  cwd?: string;
}): ArmRuntime {
  const database = resolveReviewComparisonArmDbConfigs({
    dbInput: args.dbInput,
    timestamp: args.timestamp,
    cwd: args.cwd,
  })[args.arm];

  return {
    arm: args.arm,
    database,
    runtime: {
      prisma: undefined as unknown as PrismaClient,
      dbPath: database.dbPath,
      suiteName: REVIEW_COMPARISON_SUITE_NAME,
      runId: args.runId,
      generatedAt: args.timestamp,
      backgroundJobsPolicy: "disabled",
      traceOptions: {
        enabled: true,
      },
      reportPaths: args.reportPaths,
    },
  };
}

function armDbInput(args: {
  dbInput?: string;
  timestamp: Date;
  arm: ReviewComparisonArmName;
  cwd?: string;
}) {
  if (!args.dbInput) {
    return undefined;
  }

  const cwd = args.cwd ?? process.cwd();
  const resolvedInput = args.dbInput.startsWith("file:")
    ? resolveSqliteFilePath(args.dbInput, cwd)
    : resolve(cwd, args.dbInput);

  if (existsSync(resolvedInput) && statSync(resolvedInput).isDirectory()) {
    return join(
      resolvedInput,
      `eval-${REVIEW_COMPARISON_SUITE_NAME}-${formatTimestamp(args.timestamp)}-${args.arm}.db`,
    );
  }

  if (extname(resolvedInput) === ".db") {
    const base = basename(resolvedInput, ".db");
    return join(dirname(resolvedInput), `${base}-${args.arm}.db`);
  }

  return `${resolvedInput}-${args.arm}.db`;
}

function defaultProviderForArm(arm: ReviewComparisonArmName): CoachProvider {
  return arm === "one-call"
    ? createQwenCoachProvider()
    : createTwoCallReviewProvider();
}

async function seedReviewComparisonArm(
  prisma: PrismaClient,
  cases: ReviewReplayCase[],
): Promise<SeededArm> {
  const user = await prisma.user.create({
    data: {
      handle: `eval-review-comparison-${randomUUID()}`,
    },
  });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      displayName: "Eval Review Learner",
      interviewGoal: "review-comparison",
      preferredLanguages: JSON.stringify(["Python"]),
      strongPatterns: JSON.stringify(["step-through"]),
      weakPatterns: JSON.stringify(["boundary cases"]),
      explanationStyle: JSON.stringify(["concise", "evidence-first"]),
      outputPreferences: JSON.stringify(["markdown"]),
    },
  });

  const problemsByCaseId = new Map<string, { id: string; chatSessionId: string }>();

  for (const reviewCase of cases) {
    const problem = await prisma.problem.create({
      data: {
        slug: reviewCase.problem.slug,
        title: reviewCase.problem.title,
        statementMarkdown: reviewCase.problem.statementMarkdown,
        methodName: reviewCase.problem.methodName,
        tags: JSON.stringify(reviewCase.problem.tags),
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
    const chatSession = await prisma.chatSession.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        memoryOrigin: "evaluation",
        title: `${reviewCase.problem.title} eval replay`,
        primaryLanguage: "zh",
        isActive: true,
      },
    });

    problemsByCaseId.set(reviewCase.id, {
      id: problem.id,
      chatSessionId: chatSession.id,
    });
  }

  return {
    userId: user.id,
    problemsByCaseId,
  };
}

async function runArm(args: {
  armRuntime: ArmRuntime;
  seededArm: SeededArm;
  cases: ReviewReplayCase[];
  repeats: number;
  provider: CoachProvider;
  runs: ReviewComparisonRunResult[];
  failedRuns: ReviewComparisonFailedRun[];
}) {
  for (const reviewCase of args.cases) {
    const problemState = args.seededArm.problemsByCaseId.get(reviewCase.id);

    if (!problemState) {
      throw new Error(`Missing seeded problem for case ${reviewCase.id}.`);
    }

    for (let repeatIndex = 0; repeatIndex < args.repeats; repeatIndex += 1) {
      const pathStartedAt = Date.now();
      const traceContext = await createSyntheticEvalReviewTraceContext({
        prisma: requireArmPrisma(args.armRuntime),
        identity: {
          suiteName: REVIEW_COMPARISON_SUITE_NAME,
          runId: args.armRuntime.runtime.runId,
          caseId: reviewCase.id,
          repeatIndex,
        },
        occurredAt: args.armRuntime.runtime.generatedAt,
        userId: args.seededArm.userId,
        task:
          args.armRuntime.arm === "one-call"
            ? "review.diagnose_and_reply"
            : "review.two_call",
        problemId: problemState.id,
        chatSessionId: problemState.chatSessionId,
        language: reviewCase.language,
        code: reviewCase.code,
        runResult: reviewCase.runResult,
      });
      const input = buildReviewInput({
        reviewCase,
        traceContext,
      });

      let finalizationInvoked = false;
      try {
        const result = await args.provider.review(input);
        const totalMs = Date.now() - pathStartedAt;
        await appendL1TraceEvent(requireArmPrisma(args.armRuntime), {
          userId: args.seededArm.userId,
          problemId: problemState.id,
          chatSessionId: problemState.chatSessionId,
          eventType: "coach_reply",
          source: `eval:${REVIEW_COMPARISON_SUITE_NAME}:${args.armRuntime.arm}`,
          content: result.coachReply,
          eventJson: {
            traceRunId: traceContext.traceRunId,
            evalSuite: REVIEW_COMPARISON_SUITE_NAME,
            arm: args.armRuntime.arm,
            caseId: reviewCase.id,
            repeatIndex,
            injectedBugLabel: reviewCase.injectedBugLabel,
            runStatus: reviewCase.runResult.status,
            degraded: result.degraded ?? null,
            timings: {
              totalMs,
              runnerMs: reviewCase.runResult.durationMs ?? 0,
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
          arm: args.armRuntime.arm,
          caseId: reviewCase.id,
          repeatIndex,
          traceRunId: traceContext.traceRunId,
          mistakeTags: normalizeMistakeTags(result.diagnosis.mistakeTags),
          userIssueSummary: result.diagnosis.userIssueSummary,
          coachReplyLength: result.coachReply.length,
          degraded: Boolean(result.degraded),
          totalMs,
          llmMsTotal: traceContext.llmMsTotal,
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
              "Review comparison invocation and trace finalization failed.",
            );
          }
        }
        args.failedRuns.push({
          arm: args.armRuntime.arm,
          caseId: reviewCase.id,
          repeatIndex,
          message: failure instanceof Error ? failure.message : String(failure),
        });
      }
    }
  }
}

function buildReviewInput(args: {
  reviewCase: ReviewReplayCase;
  traceContext: CoachReviewInput["traceContext"];
}): CoachReviewInput {
  return {
    problem: args.reviewCase.problem,
    user: {
      displayName: "Eval Review Learner",
      strongPatterns: ["step-through"],
      weakPatterns: ["boundary cases"],
      outputPreferences: ["concise markdown"],
    },
    memory: {
      profileId: "eval:review-comparison",
      teachableMemories: [],
      outputPreferences: [],
      domainReferences: [],
      retrievalStatus: "full",
    },
    language: args.reviewCase.language,
    code: args.reviewCase.code,
    runResult: args.reviewCase.runResult,
    evidenceVerdict: args.reviewCase.evidenceVerdict,
    userQuestion: args.reviewCase.userQuestion,
    userState: args.reviewCase.userState,
    responseLanguage: "zh",
    traceContext: args.traceContext,
  };
}

function buildReviewComparisonReport(args: {
  armRuntimes: ArmRuntime[];
  observabilityByArm: Map<
    ReviewComparisonArmName,
    ReturnType<typeof buildAgentObservabilityReport>
  >;
  runs: ReviewComparisonRunResult[];
  failedRuns: ReviewComparisonFailedRun[];
  timestamp: Date;
  runId: string;
  repeats: number;
  caseCount: number;
  dbKept: boolean;
  reportPaths: { markdown: string; json: string };
}): ReviewComparisonReport {
  const runsByArm = new Map<ReviewComparisonArmName, ReviewComparisonRunResult[]>();
  for (const armName of ARM_NAMES) {
    runsByArm.set(
      armName,
      args.runs.filter((run) => run.arm === armName),
    );
  }
  const failuresByArm = new Map<ReviewComparisonArmName, ReviewComparisonFailedRun[]>();
  for (const armName of ARM_NAMES) {
    failuresByArm.set(
      armName,
      args.failedRuns.filter((run) => run.arm === armName),
    );
  }

  const arms = Object.fromEntries(
    ARM_NAMES.map((armName) => {
      const armRuntime = args.armRuntimes.find((runtime) => runtime.arm === armName);
      const observability = args.observabilityByArm.get(armName);

      if (!armRuntime || !observability) {
        throw new Error(`Missing report input for arm ${armName}.`);
      }

      return [
        armName,
        {
          arm: armName,
          dbPath: armRuntime.runtime.dbPath,
          dbExplicit: armRuntime.database.explicit,
          llmCallCount: observability.review.llmCallCount,
          tokens: observability.review.tokens,
          latency: {
            totalMs: observability.review.latency.totalMs,
            llmMsTotal: observability.review.latency.llmMsTotal,
          },
          stability: computeDiagnosisTagStability(runsByArm.get(armName) ?? []),
          observabilitySampleCounts: observability.sampleCounts,
          providerUsage: observability.providerUsage,
          successfulRunCount: runsByArm.get(armName)?.length ?? 0,
          failedRunCount: failuresByArm.get(armName)?.length ?? 0,
          warnings: observability.warnings,
        },
      ];
    }),
  ) as ReviewComparisonReport["arms"];

  return {
    suiteName: REVIEW_COMPARISON_SUITE_NAME,
    runId: args.runId,
    generatedAt: args.timestamp.toISOString(),
    repeats: args.repeats,
    caseCount: args.caseCount,
    armNames: ARM_NAMES,
    dbKept: args.dbKept,
    reportPaths: args.reportPaths,
    arms,
    runs: args.runs,
    failedRuns: args.failedRuns,
    mutualDiagnosisTagConsistency: computeMutualDiagnosisTagConsistency({
      oneCallRuns: runsByArm.get("one-call") ?? [],
      twoCallRuns: runsByArm.get("two-call") ?? [],
    }),
    limitations: [DIAGNOSIS_F1_LIMITATION, SMALL_SAMPLE_LIMITATION],
    warnings: [
      ...new Set([
        ...ARM_NAMES.flatMap((armName) => arms[armName].warnings),
        ...(args.failedRuns.length > 0
          ? [`${args.failedRuns.length} case/repeat runs failed.`]
          : []),
      ]),
    ],
  };
}

function requireArmPrisma(armRuntime: ArmRuntime) {
  if (!armRuntime.runtime.prisma) {
    throw new Error(`Eval DB was not initialized for arm ${armRuntime.arm}.`);
  }

  return armRuntime.runtime.prisma;
}

function formatTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");

  return [
    date.getFullYear().toString(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
