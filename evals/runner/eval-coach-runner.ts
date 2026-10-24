import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  buildAgentObservabilityReport,
  loadAgentObservabilityRows,
} from "@/server/observability/agent-observability";
import {
  initializeEvalDatabase,
  removeEvalDatabase,
  resolveEvalDatabaseConfig,
} from "./db";
import type { EvalRuntime, EvalRuntimeConfig } from "./eval-runtime";
import {
  seedPlaceholderSuite,
  scorePlaceholderSuite,
  type PlaceholderSeedOptions,
} from "./placeholder-suite";
import {
  buildEvalCoachReport,
  evalReportPaths,
  writeEvalCoachReport,
  type EvalCoachReport,
} from "./report";
import {
  REVIEW_COMPARISON_SUITE_NAME,
  type ReviewComparisonReport,
} from "./review-comparison-report";
import { runReviewComparisonSuite } from "./review-comparison-suite";
import {
  REVIEW_SUITE_NAME,
  type ReviewSuiteReport,
} from "./review-report";
import { runReviewSuite } from "./review-suite";
import {
  TRAJECTORY_SUITE_NAME,
  type TrajectorySuiteReport,
} from "./trajectory-report";
import { runTrajectorySuite } from "./trajectory-suite";
import {
  SAFETY_SUITE_NAME,
  type SafetySuiteReport,
} from "./safety-report";
import { runSafetySuite } from "./safety-suite";
import {
  WEEK2_BASELINE_SUITE_NAME,
  type Week2BaselineReport,
} from "./week2-baseline-report";
import { runWeek2BaselineSuite } from "./week2-baseline-suite";
import {
  MEMORY_RETRIEVAL_SUITE_NAME,
  type MemoryRetrievalReport,
} from "./memory-retrieval-report";
import { runMemoryRetrievalSuite } from "./memory-retrieval-suite";
import {
  MEMORY_ABLATION_SUITE_NAME,
  type MemoryAblationReport,
} from "./memory-ablation-report";
import { runMemoryAblationSuite } from "./memory-ablation-suite";
import {
  PRODUCT_INVARIANT_SUITE_NAME,
  type ProductInvariantSuiteReport,
} from "./product-invariant-report";
import { runProductInvariantSuite } from "./product-invariant-suite";

export type EvalCoachRunnerOptions = {
  suiteName: string;
  dbInput?: string;
  keepDb?: boolean;
  outputDir?: string;
  now?: Date;
  cwd?: string;
  seedOptions?: PlaceholderSeedOptions;
  repeats?: number;
  recordRunEvidence?: boolean;
  manifestPath?: string;
  datasetPath?: string;
  citationDatasetPath?: string;
};

export type EvalCoachRunnerReport =
  | EvalCoachReport
  | ReviewComparisonReport
  | ReviewSuiteReport
  | TrajectorySuiteReport
  | SafetySuiteReport
  | Week2BaselineReport
  | MemoryRetrievalReport
  | MemoryAblationReport
  | ProductInvariantSuiteReport;

type PlaceholderRunnerOptions = Omit<EvalCoachRunnerOptions, "suiteName"> & {
  suiteName: "placeholder";
};

type ReviewComparisonRunnerOptions = Omit<EvalCoachRunnerOptions, "suiteName"> & {
  suiteName: typeof REVIEW_COMPARISON_SUITE_NAME;
};

type ReviewRunnerOptions = Omit<EvalCoachRunnerOptions, "suiteName"> & {
  suiteName: typeof REVIEW_SUITE_NAME;
};

type TrajectoryRunnerOptions = Omit<EvalCoachRunnerOptions, "suiteName"> & {
  suiteName: typeof TRAJECTORY_SUITE_NAME;
};

type SafetyRunnerOptions = Omit<EvalCoachRunnerOptions, "suiteName"> & {
  suiteName: typeof SAFETY_SUITE_NAME;
};

type Week2BaselineRunnerOptions = Omit<EvalCoachRunnerOptions, "suiteName"> & {
  suiteName: typeof WEEK2_BASELINE_SUITE_NAME;
};

type MemoryRetrievalRunnerOptions = Omit<EvalCoachRunnerOptions, "suiteName"> & {
  suiteName: typeof MEMORY_RETRIEVAL_SUITE_NAME;
};

type MemoryAblationRunnerOptions = Omit<EvalCoachRunnerOptions, "suiteName"> & {
  suiteName: typeof MEMORY_ABLATION_SUITE_NAME;
};

type ProductInvariantRunnerOptions = Omit<
  EvalCoachRunnerOptions,
  "suiteName"
> & {
  suiteName: typeof PRODUCT_INVARIANT_SUITE_NAME;
};

export class EvalRunnerError extends Error {
  constructor(
    message: string,
    readonly details: {
      dbPath?: string;
      report?: EvalCoachRunnerReport;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "EvalRunnerError";
  }
}

export function runEvalCoach(
  options: PlaceholderRunnerOptions,
): Promise<EvalCoachReport>;
export function runEvalCoach(
  options: ReviewComparisonRunnerOptions,
): Promise<ReviewComparisonReport>;
export function runEvalCoach(
  options: ReviewRunnerOptions,
): Promise<ReviewSuiteReport>;
export function runEvalCoach(
  options: TrajectoryRunnerOptions,
): Promise<TrajectorySuiteReport>;
export function runEvalCoach(
  options: SafetyRunnerOptions,
): Promise<SafetySuiteReport>;
export function runEvalCoach(
  options: Week2BaselineRunnerOptions,
): Promise<Week2BaselineReport>;
export function runEvalCoach(
  options: MemoryRetrievalRunnerOptions,
): Promise<MemoryRetrievalReport>;
export function runEvalCoach(
  options: MemoryAblationRunnerOptions,
): Promise<MemoryAblationReport>;
export function runEvalCoach(
  options: ProductInvariantRunnerOptions,
): Promise<ProductInvariantSuiteReport>;
export function runEvalCoach(
  options: EvalCoachRunnerOptions,
): Promise<EvalCoachRunnerReport>;
export async function runEvalCoach(
  options: EvalCoachRunnerOptions,
): Promise<EvalCoachRunnerReport> {
  if (options.suiteName === REVIEW_COMPARISON_SUITE_NAME) {
    try {
      const report = await runReviewComparisonSuite({
        dbInput: options.dbInput,
        keepDb: options.keepDb,
        repeats: options.repeats,
        outputDir: options.outputDir,
        now: options.now,
        cwd: options.cwd,
        recordRunEvidence: options.recordRunEvidence,
      });
      if (report.failedRuns.length > 0) {
        throw new EvalRunnerError("Eval suite failed.", {
          report,
        });
      }

      return report;
    } catch (error) {
      if (error instanceof EvalRunnerError) {
        throw error;
      }

      throw new EvalRunnerError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
        },
      );
    }
  }

  if (options.suiteName === REVIEW_SUITE_NAME) {
    try {
      const report = await runReviewSuite({
        dbInput: options.dbInput,
        keepDb: options.keepDb,
        repeats: options.repeats,
        outputDir: options.outputDir,
        now: options.now,
        cwd: options.cwd,
        recordRunEvidence: options.recordRunEvidence,
        datasetPath: options.datasetPath,
      });
      if (report.failedRuns.length > 0) {
        throw new EvalRunnerError("Eval suite failed.", {
          dbPath: report.dbPath,
          report,
        });
      }

      return report;
    } catch (error) {
      if (error instanceof EvalRunnerError) {
        throw error;
      }

      throw new EvalRunnerError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
        },
      );
    }
  }

  if (options.suiteName === TRAJECTORY_SUITE_NAME) {
    try {
      return await runTrajectorySuite({
        dbInput: options.dbInput,
        keepDb: options.keepDb,
        repeats: options.repeats,
        outputDir: options.outputDir,
        now: options.now,
        cwd: options.cwd,
        recordRunEvidence: options.recordRunEvidence,
        datasetPath: options.datasetPath,
      });
    } catch (error) {
      if (error instanceof EvalRunnerError) {
        throw error;
      }

      throw new EvalRunnerError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
        },
      );
    }
  }

  if (options.suiteName === SAFETY_SUITE_NAME) {
    try {
      const report = await runSafetySuite({
        dbInput: options.dbInput,
        keepDb: options.keepDb,
        repeats: options.repeats,
        outputDir: options.outputDir,
        now: options.now,
        cwd: options.cwd,
        recordRunEvidence: options.recordRunEvidence,
        datasetPath: options.datasetPath,
      });
      if (
        report.failedRuns.length > 0 ||
        hasSafetyDisclosureGateFailures(report.score)
      ) {
        throw new EvalRunnerError("Safety eval gates failed.", { report });
      }

      return report;
    } catch (error) {
      if (error instanceof EvalRunnerError) {
        throw error;
      }

      throw new EvalRunnerError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
        },
      );
    }
  }

  if (options.suiteName === WEEK2_BASELINE_SUITE_NAME) {
    try {
      return await runWeek2BaselineSuite({
        outputDir: options.outputDir,
        now: options.now,
        cwd: options.cwd,
      });
    } catch (error) {
      if (error instanceof EvalRunnerError) {
        throw error;
      }

      throw new EvalRunnerError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
        },
      );
    }
  }

  if (options.suiteName === MEMORY_RETRIEVAL_SUITE_NAME) {
    try {
      return await runMemoryRetrievalSuite({
        dbInput: options.dbInput,
        manifestPath: options.manifestPath,
        datasetPath: options.datasetPath,
        keepDb: options.keepDb,
        outputDir: options.outputDir,
        now: options.now,
        cwd: options.cwd,
      });
    } catch (error) {
      if (error instanceof EvalRunnerError) {
        throw error;
      }

      throw new EvalRunnerError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
        },
      );
    }
  }

  if (options.suiteName === MEMORY_ABLATION_SUITE_NAME) {
    try {
      return await runMemoryAblationSuite({
        dbInput: options.dbInput,
        manifestPath: options.manifestPath,
        datasetPath: options.datasetPath,
        citationDatasetPath: options.citationDatasetPath,
        keepDb: options.keepDb,
        outputDir: options.outputDir,
        now: options.now,
        cwd: options.cwd,
      });
    } catch (error) {
      if (error instanceof EvalRunnerError) {
        throw error;
      }

      throw new EvalRunnerError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
        },
      );
    }
  }

  if (options.suiteName === PRODUCT_INVARIANT_SUITE_NAME) {
    try {
      const report = await runProductInvariantSuite({
        dbInput: options.dbInput,
        keepDb: options.keepDb,
        repeats: options.repeats,
        outputDir: options.outputDir,
        now: options.now,
        cwd: options.cwd,
        recordRunEvidence: options.recordRunEvidence,
        datasetPath: options.datasetPath,
      });
      if (report.score.failCount > 0) {
        throw new EvalRunnerError("Product-invariant eval gates failed.", {
          dbPath: report.dbPath,
          report,
        });
      }
      return report;
    } catch (error) {
      if (error instanceof EvalRunnerError) {
        throw error;
      }
      throw new EvalRunnerError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }

  if (options.suiteName !== "placeholder") {
    throw new EvalRunnerError(`Unknown eval suite: ${options.suiteName}`);
  }

  const timestamp = options.now ?? new Date();
  const database = resolveEvalDatabaseConfig({
    suiteName: options.suiteName,
    dbInput: options.dbInput,
    timestamp,
    cwd: options.cwd,
  });
  const runtimeConfig: EvalRuntimeConfig = {
    dbPath: database.dbPath,
    suiteName: options.suiteName,
    runId: `eval-${options.suiteName}-${randomUUID()}`,
    generatedAt: timestamp,
    backgroundJobsPolicy: "disabled",
    traceOptions: {
      enabled: true,
    },
    reportPaths: evalReportPaths({
      suiteName: options.suiteName,
      timestamp,
      outputDir: options.outputDir,
    }),
  };
  let prisma;
  try {
    prisma = initializeEvalDatabase(database);
  } catch (error) {
    throw new EvalRunnerError(
      error instanceof Error ? error.message : String(error),
      {
        dbPath: runtimeConfig.dbPath,
        cause: error,
      },
    );
  }

  const runtime: EvalRuntime = { ...runtimeConfig, prisma };
  let report: EvalCoachReport | undefined;
  let success = false;

  try {
    await seedPlaceholderSuite(runtime.prisma, options.seedOptions);
    const rows = await loadAgentObservabilityRows(runtime.prisma);
    const observability = buildAgentObservabilityReport({
      rows,
      dbPath: runtime.dbPath,
      explicitDb: database.explicit,
      generatedAt: runtime.generatedAt,
    });
    const score = scorePlaceholderSuite(observability);
    report = buildEvalCoachReport({
      runtime,
      dbKept: Boolean(options.keepDb) || score.failCount > 0,
      score,
      observability,
    });

    writeEvalCoachReport(report);

    if (score.failCount > 0) {
      throw new EvalRunnerError("Eval suite failed.", {
        dbPath: runtime.dbPath,
        report,
      });
    }

    success = true;
    return report;
  } catch (error) {
    if (error instanceof EvalRunnerError) {
      throw error;
    }

    throw new EvalRunnerError(
      error instanceof Error ? error.message : String(error),
      {
        dbPath: runtime.dbPath,
        report,
        cause: error,
      },
    );
  } finally {
    await runtime.prisma.$disconnect();

    if (success && !options.keepDb && existsSync(runtime.dbPath)) {
      removeEvalDatabase(runtime.dbPath);
    }
  }
}

export function hasSafetyDisclosureGateFailures(
  score: SafetySuiteReport["score"],
) {
  return (
    score.unrequestedFullCode.leakageCount > 0 ||
    score.codeDisclosureAdherence.numerator <
      score.codeDisclosureAdherence.denominator
  );
}
