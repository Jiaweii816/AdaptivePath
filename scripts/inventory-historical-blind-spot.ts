import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";
import { codeRunResultSchema } from "@/types/code-runner";
import {
  parseManualProvenanceManifest,
  type ManualProvenanceClassification,
} from "@/server/memory/replay/manual-provenance-review";

type SqliteStatement<Row> = {
  all: (...parameters: unknown[]) => Row[];
};

type SqliteDatabase = {
  close: () => void;
  pragma: (source: string) => unknown;
  prepare: <Row>(source: string) => SqliteStatement<Row>;
};

type SqliteConstructor = new (
  path: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => SqliteDatabase;

type CliArgs = {
  dbPath: string;
  outPath: string;
  userHandle: string;
  manifestPath?: string;
};

type ReviewRow = {
  id: string;
  userId: string;
  problemId: string;
  language: string;
  codeSnapshot: string;
  memoryOrigin: string;
  createdAt: string;
  problemSlug: string;
  problemTitle: string;
  hot150Order: number | null;
};

type RunEvidenceRow = {
  id: string;
  reviewAttemptId: string | null;
  source: string;
  status: string;
  executionFingerprint: string | null;
  rawResultJson: string;
};

type EpisodeOriginRow = {
  problemId: string;
  memoryOrigin: string;
};

type ProblemCohort =
  | "retrievable_today"
  | "legacy_unknown_only_episode"
  | "no_episode";

type RejectionReason =
  | "manual_provenance_not_learner"
  | "absent_from_manifest"
  | "missing_execution_evidence"
  | "revision_mismatch"
  | "unclassifiable_result"
  | "problem_not_hot150"
  | "mock_provider"
  | "empty_code_snapshot";

/**
 * `analyzeReview` rejects on the manual provenance decision before it looks at
 * any execution evidence. An inventory that skips this gate reports every
 * technically-sound attempt as recoverable and silently overstates the result,
 * so the manifest is consulted first here too.
 */
type ProvenanceLookup = Map<string, ManualProvenanceClassification>;

/**
 * A blind-spot attempt reaches durable memory by one of two routes. Pre-cutover
 * `legacy_unknown` attempts must go through historical replay, which is gated on
 * the manual provenance manifest. Post-cutover `learner` attempts are already
 * learner-origin and were never replay candidates; when they have no episode it
 * is because their activity extraction failed, so they are recovered by
 * re-running extraction instead.
 */
type RecoveryPath = "historical_replay" | "extraction_rerun";

type ReviewDecision =
  | {
      reviewAttemptId: string;
      occurredAt: string;
      recoverable: true;
      recoveryPath: RecoveryPath;
      providerUsed: string;
      runEvidenceId: string;
    }
  | {
      reviewAttemptId: string;
      occurredAt: string;
      recoverable: false;
      rejectionReason: RejectionReason;
      detail: string;
    };

type ProblemReport = {
  problemId: string;
  slug: string;
  title: string;
  hot150Order: number | null;
  cohort: Exclude<ProblemCohort, "retrievable_today">;
  recoverable: boolean;
  recoveryPaths: RecoveryPath[];
  candidateReviewAttemptIds: string[];
  reviewAttempts: ReviewDecision[];
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

function parseArgs(argv: string[]): CliArgs {
  let dbInput: string | undefined;
  let outInput: string | undefined;
  let manifestInput: string | undefined;
  let userHandle = "Iris904";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }
    switch (arg) {
      case "--db":
        dbInput = value;
        break;
      case "--out":
        outInput = value;
        break;
      case "--manifest":
        manifestInput = value;
        break;
      case "--user":
      case "--handle":
        userHandle = value;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
    index += 1;
  }

  if (!dbInput || !outInput) {
    throw new Error(
      "Usage: --db <sqlite.db> --out <report.json> [--manifest <manifest.json>] [--user <handle>]",
    );
  }

  return {
    dbPath: resolveSqliteFilePath(dbInput, process.cwd()),
    outPath: resolve(outInput),
    manifestPath: manifestInput ? resolve(manifestInput) : undefined,
    userHandle,
  };
}

async function loadProvenanceLookup(
  manifestPath: string | undefined,
  userHandle: string,
): Promise<ProvenanceLookup> {
  if (!manifestPath) return new Map();
  const manifest = parseManualProvenanceManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (manifest.learnerHandle !== userHandle) {
    throw new Error(
      `Approval manifest belongs to ${manifest.learnerHandle}, not ${userHandle}.`,
    );
  }
  return new Map(
    manifest.decisions.map((decision) => [
      decision.reviewAttemptId,
      decision.classification,
    ]),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = await realpath(args.dbPath);
  const outPath = resolve(args.outPath);
  if (dbPath === outPath) {
    throw new Error("Output path must not point to the source database.");
  }

  const sourceDbSha256 = await sha256File(dbPath);
  const provenance = await loadProvenanceLookup(
    args.manifestPath,
    args.userHandle,
  );
  const openedAs = `file:${dbPath}?mode=ro`;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");

  try {
    const reviews = db
      .prepare<ReviewRow>(`
        SELECT
          ra.id,
          ra.userId,
          ra.problemId,
          ra.language,
          ra.codeSnapshot,
          ra.memoryOrigin,
          ra.createdAt,
          p.slug AS problemSlug,
          p.title AS problemTitle,
          p.hot150Order
        FROM ReviewAttempt ra
        JOIN User u ON u.id = ra.userId
        JOIN Problem p ON p.id = ra.problemId
        WHERE u.handle = ?
        ORDER BY ra.createdAt ASC, ra.id ASC
      `)
      .all(args.userHandle);
    if (reviews.length === 0) {
      throw new Error(`No ReviewAttempt rows found for ${args.userHandle}.`);
    }

    const runs = db
      .prepare<RunEvidenceRow>(`
        SELECT id, reviewAttemptId, source, status, executionFingerprint, rawResultJson
        FROM RunEvidence
        WHERE reviewAttemptId IN (
          SELECT ra.id
          FROM ReviewAttempt ra
          JOIN User u ON u.id = ra.userId
          WHERE u.handle = ?
        )
        ORDER BY createdAt ASC, id ASC
      `)
      .all(args.userHandle);
    const episodeOrigins = db
      .prepare<EpisodeOriginRow>(`
        SELECT me.problemId, me.memoryOrigin
        FROM MemoryEpisode me
        JOIN User u ON u.id = me.userId
        WHERE u.handle = ? AND me.problemId IS NOT NULL
      `)
      .all(args.userHandle);

    const reviewsByProblem = groupBy(reviews, (review) => review.problemId);
    const runsByReview = groupBy(
      runs,
      (run) => run.reviewAttemptId ?? "__missing_review__",
    );
    const episodeOriginsByProblem = groupBy(
      episodeOrigins,
      (episode) => episode.problemId,
    );

    const retrievableProblemIds = new Set(
      episodeOrigins
        .filter((episode) => episode.memoryOrigin === "learner")
        .map((episode) => episode.problemId),
    );
    const blindProblemReports: ProblemReport[] = [];
    const histogram: Record<RejectionReason, number> = {
      manual_provenance_not_learner: 0,
      absent_from_manifest: 0,
      missing_execution_evidence: 0,
      revision_mismatch: 0,
      unclassifiable_result: 0,
      problem_not_hot150: 0,
      mock_provider: 0,
      empty_code_snapshot: 0,
    };

    for (const [problemId, problemReviews] of reviewsByProblem) {
      if (retrievableProblemIds.has(problemId)) continue;

      const origins = new Set(
        (episodeOriginsByProblem.get(problemId) ?? []).map(
          (episode) => episode.memoryOrigin,
        ),
      );
      const cohort =
        origins.size === 0
          ? "no_episode"
          : origins.size === 1 && origins.has("legacy_unknown")
            ? "legacy_unknown_only_episode"
            : undefined;
      if (!cohort) continue;

      const reviewAttempts = problemReviews.map((review) =>
        evaluateReview(review, runsByReview.get(review.id) ?? [], provenance),
      );
      for (const decision of reviewAttempts) {
        if (!decision.recoverable) histogram[decision.rejectionReason] += 1;
      }
      const candidateReviewAttemptIds = reviewAttempts.flatMap((decision) =>
        decision.recoverable ? [decision.reviewAttemptId] : [],
      );
      const first = problemReviews[0]!;
      blindProblemReports.push({
        problemId,
        slug: first.problemSlug,
        title: first.problemTitle,
        hot150Order: first.hot150Order,
        cohort,
        recoverable: candidateReviewAttemptIds.length > 0,
        recoveryPaths: [
          ...new Set(
            reviewAttempts.flatMap((decision) =>
              decision.recoverable ? [decision.recoveryPath] : [],
            ),
          ),
        ],
        candidateReviewAttemptIds,
        reviewAttempts,
      });
    }

    blindProblemReports.sort((left, right) => {
      const leftOrder = left.hot150Order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.hot150Order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder === rightOrder
        ? left.slug.localeCompare(right.slug)
        : leftOrder - rightOrder;
    });

    const candidateReviewAttemptIds = blindProblemReports.flatMap(
      (problem) => problem.candidateReviewAttemptIds,
    );
    const report = {
      generatedAt: new Date().toISOString(),
      sourceDbSha256,
      openedAs,
      learner: { handle: args.userHandle },
      reviewedProblems: reviewsByProblem.size,
      retrievableProblems: retrievableProblemIds.size,
      blindSpotProblems: blindProblemReports.length,
      manifestApplied: Boolean(args.manifestPath),
      manifestPath: args.manifestPath ?? null,
      likelyRecoverableProblems: blindProblemReports.filter(
        (problem) => problem.recoverable,
      ).length,
      recoverableByHistoricalReplay: blindProblemReports.filter((problem) =>
        problem.recoveryPaths.includes("historical_replay"),
      ).length,
      recoverableByExtractionRerun: blindProblemReports.filter((problem) =>
        problem.recoveryPaths.includes("extraction_rerun"),
      ).length,
      unrecoverableProblems: blindProblemReports
        .filter((problem) => !problem.recoverable)
        .map((problem) => ({
          slug: problem.slug,
          reasons: [
            ...new Set(
              problem.reviewAttempts.flatMap((decision) =>
                decision.recoverable ? [] : [decision.rejectionReason],
              ),
            ),
          ],
        })),
      rejectionHistogram: histogram,
      candidateReviewAttemptIds,
      problems: blindProblemReports,
    };

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          reportPath: outPath,
          reviewedProblems: report.reviewedProblems,
          retrievableProblems: report.retrievableProblems,
          blindSpotProblems: report.blindSpotProblems,
          manifestApplied: report.manifestApplied,
          likelyRecoverableProblems: report.likelyRecoverableProblems,
          recoverableByHistoricalReplay: report.recoverableByHistoricalReplay,
          recoverableByExtractionRerun: report.recoverableByExtractionRerun,
          unrecoverableProblems: report.unrecoverableProblems,
          rejectionHistogram: report.rejectionHistogram,
          candidateReviewAttemptIds: report.candidateReviewAttemptIds.length,
          sourceDbSha256,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

function evaluateReview(
  review: ReviewRow,
  runEvidences: RunEvidenceRow[],
  provenance: ProvenanceLookup,
): ReviewDecision {
  const provenanceRejection = provenanceGate(review, provenance);
  if (provenanceRejection) {
    return rejected(review, provenanceRejection.reason, provenanceRejection.detail);
  }
  if (review.language !== "Python") {
    return rejected(review, "unclassifiable_result", `language:${review.language}`);
  }
  if (review.hot150Order === null) {
    return rejected(review, "problem_not_hot150", "problem_not_hot150");
  }
  if (!review.codeSnapshot.trim()) {
    return rejected(review, "empty_code_snapshot", "empty_code_snapshot");
  }

  const reviewRuns = runEvidences.filter((run) => run.source === "review");
  if (reviewRuns.length !== 1) {
    return rejected(
      review,
      "missing_execution_evidence",
      `review_run_count:${reviewRuns.length}`,
    );
  }
  const run = reviewRuns[0]!;
  const codeRevisionHash = fingerprintCodeForExecution({
    language: "Python",
    code: review.codeSnapshot,
  });
  if (
    run.reviewAttemptId !== review.id ||
    (run.executionFingerprint !== null &&
      run.executionFingerprint !== codeRevisionHash)
  ) {
    return rejected(
      review,
      "revision_mismatch",
      "run_evidence_revision_does_not_match_review_code",
    );
  }

  const parsedRaw = parseJson(run.rawResultJson);
  const parsedRun = codeRunResultSchema.safeParse(parsedRaw);
  if (!parsedRun.success || parsedRun.data.status !== run.status) {
    return rejected(
      review,
      "unclassifiable_result",
      parsedRun.success ? "run_status_mismatch" : "raw_result_schema",
    );
  }

  const providerUsed = readProviderUsed(parsedRun.data.rawResult);
  if (!providerUsed) {
    return rejected(review, "unclassifiable_result", "missing_provider");
  }
  if (providerUsed === "mock") {
    return rejected(review, "mock_provider", "mock_provider");
  }

  return {
    reviewAttemptId: review.id,
    occurredAt: normalizeDate(review.createdAt),
    recoverable: true,
    recoveryPath:
      review.memoryOrigin === "learner" ? "extraction_rerun" : "historical_replay",
    providerUsed,
    runEvidenceId: run.id,
  };
}

function provenanceGate(review: ReviewRow, provenance: ProvenanceLookup) {
  // Post-cutover learner rows are outside the manifest's remit by design.
  if (review.memoryOrigin === "learner") return undefined;
  if (provenance.size === 0) return undefined;

  const classification = provenance.get(review.id);
  if (!classification) {
    return {
      reason: "absent_from_manifest" as const,
      detail: "absent_from_manifest",
    };
  }
  if (classification !== "learner") {
    return {
      reason: "manual_provenance_not_learner" as const,
      detail: `manual_classification:${classification}`,
    };
  }
  return undefined;
}

function rejected(
  review: ReviewRow,
  rejectionReason: RejectionReason,
  detail: string,
): ReviewDecision {
  return {
    reviewAttemptId: review.id,
    occurredAt: normalizeDate(review.createdAt),
    recoverable: false,
    rejectionReason,
    detail,
  };
}

function readProviderUsed(rawResult: unknown) {
  if (!rawResult || typeof rawResult !== "object") return undefined;
  const value = (rawResult as Record<string, unknown>).providerUsed;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseJson(source: string) {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
}

function groupBy<Row, Key>(
  rows: Row[],
  keyOf: (row: Row) => Key,
): Map<Key, Row[]> {
  const grouped = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return grouped;
}

function normalizeDate(value: string) {
  const parsed = value.includes("T") ? new Date(value) : new Date(`${value}Z`);
  return parsed.toISOString();
}

async function sha256File(path: string) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
