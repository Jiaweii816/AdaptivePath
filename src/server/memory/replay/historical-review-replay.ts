import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";
import { alignReviewResultWithRunEvidence } from "@/server/agents/coach-agent/review-result-guard";
import { buildReviewEpisode } from "@/server/memory/consolidation/write-review-episode";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { resolveMemoryWritePolicy } from "@/server/memory/memory-origin";
import {
  arbitrateFactCandidates,
  mapMemoryUpdateCandidateToFactCandidates,
} from "@/server/memory/store/fact-store";
import { createMemoryEpisode } from "@/server/memory/store/episode-store";
import type { FtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import {
  resolveCanonicalMechanismSignal,
} from "@/server/problems/hot150-taxonomy";
import { codeRunResultSchema, type CodeRunResult } from "@/types/code-runner";
import { coachDiagnosisSchema, type CoachReviewResult } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";
import type {
  ManualProvenanceClassification,
  ManualProvenanceDecision,
} from "./manual-provenance-review";

// Bumped when the replay materialization rules change, so completion markers
// from an earlier ruleset stop satisfying the idempotency check and their
// Reviews are reprocessed. v3 decouples Episode creation from L2 fact
// portability: every accepted Review now leaves searchable history.
export const HISTORICAL_REPLAY_RULE_VERSION =
  "2026-07-26.episode-decoupled.v3";

const SHOWCASE_PROBLEM_SLUGS = new Set([
  "two-sum",
  "search-insert-position",
  "longest-substring-without-repeating-characters",
]);

const LOCAL_VISIBLE_PROVIDERS = new Set([
  "piston",
  "piston_fallback",
  "local_hot150",
  "lc_run",
  "remote_unavailable_local_fallback",
]);

export type HistoricalReplayDecisionKind =
  | "accept_learner_review"
  | "accept_review_drop_blocked_candidate"
  | "accept_learner_ledger_only"
  | "reject_manual_provenance"
  | "reject_revision_mismatch"
  | "reject_missing_execution_evidence"
  | "reject_non_learner_origin"
  | "reject_unsupported_language_or_problem"
  | "reject_unclassifiable_result";

export type HistoricalReplayDecision = {
  sourceReviewAttemptId: string;
  sourceRunEvidenceIds: string[];
  sourceDiagnosisId: string | null;
  sourceProblemHistoryId: string | null;
  problemId: string;
  problemSlug: string;
  isShowcaseProblem: boolean;
  occurredAt: string;
  codeRevisionHash: string | null;
  clusterId: string | null;
  inputChecksum: string;
  outcome: string | null;
  evidenceScope: "official_judge" | "local_visible" | null;
  decision: HistoricalReplayDecisionKind;
  decisionReasons: string[];
  canonicalMechanisms: string[];
  blockedCandidateTags: string[];
  manualClassification: ManualProvenanceClassification;
  materializesMemory: boolean;
};

export type HistoricalReplayResult = {
  replayRunId: string;
  ruleVersion: string;
  apply: boolean;
  decisions: HistoricalReplayDecision[];
  summary: {
    scannedReviews: number;
    learnerApprovedReviews: number;
    manualExcludedReviews: number;
    acceptedReviews: number;
    memoryMaterializedReviews: number;
    ledgerOnlyReviews: number;
    deferredReviews: number;
    rejectedReviews: number;
    acceptedNonShowcaseProblems: number;
    generatedClusters: number;
    generatedFactWrites: number;
    generatedEpisodes: number;
    generatedRetrievalDocuments: number;
    proposedFactCandidates: number;
    proposedEpisodes: number;
    idempotentSkips: number;
  };
};

type ReplaySourceReview = Prisma.ReviewAttemptGetPayload<{
  include: {
    problem: true;
    runEvidences: true;
    diagnosisResult: true;
    problemHistories: true;
  };
}>;

type AcceptedReplayAnalysis = {
  decision: HistoricalReplayDecision;
  source: ReplaySourceReview;
  runEvidence: ReplaySourceReview["runEvidences"][number];
  runResult: CodeRunResult;
  evidenceVerdict: EvidenceVerdict;
  alignedCoachResult: CoachReviewResult;
  problemTags: string[];
  materializesMemory: boolean;
};

type ReplayAnalysis =
  | AcceptedReplayAnalysis
  | { decision: HistoricalReplayDecision; source: ReplaySourceReview };

export async function runHistoricalReviewReplay(
  prisma: PrismaClient,
  args: {
    userId: string;
    replayRunId: string;
    apply: boolean;
    ftsStore?: FtsStore;
    minimumAcceptedNonShowcaseProblems?: number;
    provenanceDecisions: readonly ManualProvenanceDecision[];
    provenanceDecisionFingerprint: string;
  },
): Promise<HistoricalReplayResult> {
  if (args.apply) {
    const writePolicy = resolveMemoryWritePolicy();
    if (!writePolicy.durableWrites) {
      throw new Error(
        `Historical replay apply requires PATTERNCOACH_MEMORY_ORIGIN=learner; got ${writePolicy.origin}.`,
      );
    }
  }

  const decisionsByReviewId = validateManualDecisions(args.provenanceDecisions);
  const reviews = await prisma.reviewAttempt.findMany({
    where: {
      userId: args.userId,
      id: { in: [...decisionsByReviewId.keys()] },
    },
    include: {
      problem: true,
      runEvidences: { orderBy: { createdAt: "asc" } },
      diagnosisResult: true,
      problemHistories: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  validateDecisionCoverage(reviews, decisionsByReviewId);
  const analyses = reviews.map((review) =>
    analyzeReview(review, decisionsByReviewId.get(review.id)!),
  );
  const accepted = analyses.filter(isAcceptedAnalysis);
  const acceptedNonShowcaseProblems = new Set(
    accepted
      .filter((analysis) => !analysis.decision.isShowcaseProblem)
      .map((analysis) => analysis.decision.problemId),
  ).size;
  const minimum = args.minimumAcceptedNonShowcaseProblems ?? 90;
  if (acceptedNonShowcaseProblems < minimum) {
    throw new Error(
      `Historical replay failed closed: accepted ${acceptedNonShowcaseProblems} non-showcase Hot-150 problems; required at least ${minimum}.`,
    );
  }

  let generatedClusters = 0;
  let generatedFactWrites = 0;
  let generatedEpisodes = 0;
  let generatedRetrievalDocuments = 0;
  let idempotentSkips = 0;

  if (args.apply) {
    for (const analysis of accepted) {
      const applied = await prisma.$transaction((tx) =>
        applyAcceptedReview(tx, analysis, {
          replayRunId: args.replayRunId,
          provenanceDecisionFingerprint: args.provenanceDecisionFingerprint,
        }),
      );
      generatedClusters += applied.generatedCluster ? 1 : 0;
      generatedFactWrites += applied.generatedFactWrites;
      generatedEpisodes += applied.generatedEpisode ? 1 : 0;
      idempotentSkips += applied.idempotentSkip ? 1 : 0;
    }
    if (generatedClusters > 0 && args.ftsStore) {
      const projection = await reconcileLearnerMemoryRetrievalDocuments(prisma, {
        userId: args.userId,
        ftsStore: args.ftsStore,
      });
      generatedRetrievalDocuments = projection.documentCount;
    }
  }

  const decisions = analyses.map((analysis) => analysis.decision);
  return {
    replayRunId: args.replayRunId,
    ruleVersion: HISTORICAL_REPLAY_RULE_VERSION,
    apply: args.apply,
    decisions,
    summary: {
      scannedReviews: decisions.length,
      learnerApprovedReviews: decisions.filter(
        (decision) => decision.manualClassification === "learner",
      ).length,
      manualExcludedReviews: decisions.filter(
        (decision) => decision.decision === "reject_manual_provenance",
      ).length,
      acceptedReviews: decisions.filter((decision) =>
        decision.decision.startsWith("accept_"),
      ).length,
      memoryMaterializedReviews: decisions.filter(
        (decision) => decision.materializesMemory,
      ).length,
      ledgerOnlyReviews: decisions.filter(
        (decision) => decision.decision === "accept_learner_ledger_only",
      ).length,
      deferredReviews: decisions.filter((decision) =>
        decision.decision.startsWith("defer_"),
      ).length,
      rejectedReviews: decisions.filter((decision) =>
        decision.decision.startsWith("reject_"),
      ).length,
      acceptedNonShowcaseProblems,
      generatedClusters,
      generatedFactWrites,
      generatedEpisodes,
      generatedRetrievalDocuments,
      proposedFactCandidates: accepted.reduce(
        (sum, analysis) =>
          sum +
          analysis.alignedCoachResult.diagnosis.memoryUpdateCandidate.facts
            .length,
        0,
      ),
      // Every accepted Review yields an Episode; only a subset yields L2 facts.
      proposedEpisodes: accepted.length,
      idempotentSkips,
    },
  };
}

function analyzeReview(
  review: ReplaySourceReview,
  provenanceDecision: ManualProvenanceDecision,
): ReplayAnalysis {
  const problemTags = parseStringArray(review.problem.tags);
  const inputChecksum = checksum({
    review: {
      id: review.id,
      userId: review.userId,
      problemId: review.problemId,
      language: review.language,
      codeSnapshot: review.codeSnapshot,
      selectedTestCaseIds: review.selectedTestCaseIds,
      userState: review.userState,
      userQuestion: review.userQuestion,
      memoryOrigin: review.memoryOrigin,
      createdAt: review.createdAt.toISOString(),
    },
    runs: review.runEvidences.map((run) => ({
      id: run.id,
      source: run.source,
      status: run.status,
      executionFingerprint: run.executionFingerprint,
      rawResultJson: run.rawResultJson,
    })),
    diagnosis: review.diagnosisResult
      ? {
          id: review.diagnosisResult.id,
          diagnosisJson: review.diagnosisResult.diagnosisJson,
        }
      : null,
  });
  const base = {
    sourceReviewAttemptId: review.id,
    sourceRunEvidenceIds: review.runEvidences.map((run) => run.id),
    sourceDiagnosisId: review.diagnosisResult?.id ?? null,
    sourceProblemHistoryId: review.problemHistories[0]?.id ?? null,
    problemId: review.problemId,
    problemSlug: review.problem.slug,
    isShowcaseProblem: SHOWCASE_PROBLEM_SLUGS.has(review.problem.slug),
    occurredAt: review.createdAt.toISOString(),
    inputChecksum,
    manualClassification: provenanceDecision.classification,
  };

  if (provenanceDecision.classification !== "learner") {
    return rejectedAnalysis(review, base, "reject_manual_provenance", [
      `manual_classification:${provenanceDecision.classification}`,
    ]);
  }
  if (
    review.memoryOrigin !== "legacy_unknown" &&
    review.memoryOrigin !== "learner"
  ) {
    return rejectedAnalysis(review, base, "reject_non_learner_origin", [
      `source_origin:${review.memoryOrigin}`,
    ]);
  }
  if (
    review.language !== "Python" ||
    review.problem.hot150Order === null ||
    !review.codeSnapshot.trim()
  ) {
    return rejectedAnalysis(
      review,
      base,
      "reject_unsupported_language_or_problem",
      [
        review.language !== "Python" ? `language:${review.language}` : null,
        review.problem.hot150Order === null ? "problem_not_hot150" : null,
        !review.codeSnapshot.trim() ? "empty_code_snapshot" : null,
      ].filter((reason): reason is string => Boolean(reason)),
    );
  }

  const reviewRuns = review.runEvidences.filter(
    (run) => run.source === "review",
  );
  if (reviewRuns.length !== 1) {
    return rejectedAnalysis(
      review,
      base,
      "reject_missing_execution_evidence",
      [`review_run_count:${reviewRuns.length}`],
    );
  }
  const runEvidence = reviewRuns[0]!;
  const codeRevisionHash = fingerprintCodeForExecution({
    language: "Python",
    code: review.codeSnapshot,
  });
  if (
    runEvidence.reviewAttemptId !== review.id ||
    (runEvidence.executionFingerprint !== null &&
      runEvidence.executionFingerprint !== codeRevisionHash)
  ) {
    return rejectedAnalysis(review, base, "reject_revision_mismatch", [
      "run_evidence_revision_does_not_match_review_code",
    ], codeRevisionHash);
  }

  const parsedRun = codeRunResultSchema.safeParse(
    parseJson(runEvidence.rawResultJson),
  );
  if (!parsedRun.success || parsedRun.data.status !== runEvidence.status) {
    return rejectedAnalysis(
      review,
      base,
      "reject_unclassifiable_result",
      [
        !parsedRun.success
          ? `raw_result_schema:${parsedRun.error.issues[0]?.message ?? "invalid"}`
          : "run_status_mismatch",
      ],
      codeRevisionHash,
    );
  }
  const providerUsed = readProviderUsed(parsedRun.data);
  if (!providerUsed || providerUsed === "mock") {
    return rejectedAnalysis(
      review,
      base,
      "reject_unclassifiable_result",
      [providerUsed === "mock" ? "mock_provider" : "missing_provider"],
      codeRevisionHash,
    );
  }
  const evidenceVerdict = classifyExecutionEvidence(parsedRun.data, {
    consumer: "review",
    providerUsed,
    localFallback: LOCAL_VISIBLE_PROVIDERS.has(providerUsed),
  });
  if (!evidenceVerdict.capabilities.canVerdict) {
    return rejectedAnalysis(
      review,
      base,
      "reject_unclassifiable_result",
      [`non_verdict:${evidenceVerdict.evidenceClass}`],
      codeRevisionHash,
    );
  }

  const diagnosis = coachDiagnosisSchema.safeParse(
    parseJson(review.diagnosisResult?.diagnosisJson ?? ""),
  );
  if (!review.diagnosisResult || !diagnosis.success) {
    return rejectedAnalysis(
      review,
      base,
      "reject_unclassifiable_result",
      [
        !review.diagnosisResult
          ? "missing_diagnosis"
          : `diagnosis_schema:${diagnosis.success ? "invalid" : diagnosis.error.issues[0]?.message}`,
      ],
      codeRevisionHash,
      parsedRun.data.status,
      evidenceScopeFor(evidenceVerdict),
    );
  }
  if (diagnosis.data.problemSlug !== review.problem.slug) {
    return rejectedAnalysis(
      review,
      base,
      "reject_revision_mismatch",
      ["diagnosis_problem_mismatch"],
      codeRevisionHash,
      parsedRun.data.status,
      evidenceScopeFor(evidenceVerdict),
    );
  }

  const coachResult: CoachReviewResult = {
    diagnosis: diagnosis.data,
    coachReply:
      review.coachReplyMarkdown?.trim() || "Historical Review evidence.",
  };
  const alignedCoachResult = alignReviewResultWithRunEvidence({
    coachResult,
    problemSlug: review.problem.slug,
    problemTitle: review.problem.title,
    problemTags,
    code: review.codeSnapshot,
    runResult: parsedRun.data,
    evidenceVerdict,
    responseLanguage: "en",
  });
  const resolutions = alignedCoachResult.diagnosis.memoryUpdateCandidate.facts.map(
    (fact) => ({
      rawTag: fact.tag,
      resolution: resolveCanonicalMechanismSignal({
        rawTag: fact.tag,
        problemTags,
      }),
    }),
  );
  const canonicalMechanisms = unique(
    resolutions.flatMap(({ resolution }) =>
      resolution.decision === "canonical" ? [resolution.key] : [],
    ),
  );
  const blockedCandidateTags = unique(
    resolutions.flatMap(({ rawTag, resolution }) =>
      resolution.decision === "canonical" ? [] : [rawTag],
    ),
  );

  const portableFacts = alignedCoachResult.diagnosis.memoryUpdateCandidate.facts
    .filter((_, index) => resolutions[index]?.resolution.decision === "canonical");
  const materializesMemory = portableFacts.length > 0;
  const replayCoachResult: CoachReviewResult = {
    coachReply: "Historical Review reply omitted from semantic replay.",
    diagnosis: {
      ...alignedCoachResult.diagnosis,
      memoryUpdateCandidate: {
        ...alignedCoachResult.diagnosis.memoryUpdateCandidate,
        facts: portableFacts,
      },
    },
  };

  const decision: HistoricalReplayDecision = {
    ...base,
    codeRevisionHash,
    clusterId: stableClusterId(review.id, runEvidence.id, codeRevisionHash),
    outcome: parsedRun.data.status,
    evidenceScope: evidenceScopeFor(evidenceVerdict),
    decision: !materializesMemory
      ? "accept_learner_ledger_only"
      : blockedCandidateTags.length > 0
        ? "accept_review_drop_blocked_candidate"
        : "accept_learner_review",
    decisionReasons: !materializesMemory
      ? ["no_portable_fact_candidate"]
      : blockedCandidateTags.length > 0
        ? ["one_or_more_candidates_failed_canonical_taxonomy"]
        : ["all_replay_whitelist_checks_passed"],
    canonicalMechanisms,
    blockedCandidateTags,
    materializesMemory,
  };
  return {
    decision,
    source: review,
    runEvidence,
    runResult: parsedRun.data,
    evidenceVerdict,
    alignedCoachResult: replayCoachResult,
    problemTags,
    materializesMemory,
  };
}

async function applyAcceptedReview(
  tx: Prisma.TransactionClient,
  analysis: AcceptedReplayAnalysis,
  replay: {
    replayRunId: string;
    provenanceDecisionFingerprint: string;
  },
) {
  const completionCandidates = await tx.l1MemoryEvent.findMany({
    where: {
      userId: analysis.source.userId,
      reviewAttemptId: analysis.source.id,
      eventType: "historical_replay_completed",
      source: "memory_agent:historical_replay",
      memoryOrigin: "learner",
    },
  });
  const existingCompletion = completionCandidates.find((event) => {
    const payload = asRecord(parseJson(event.eventJson));
    return (
      payload.replayRuleVersion === HISTORICAL_REPLAY_RULE_VERSION &&
      payload.provenanceDecisionFingerprint ===
        replay.provenanceDecisionFingerprint
    );
  });
  if (existingCompletion) {
    const payload = asRecord(parseJson(existingCompletion.eventJson));
    if (payload.inputChecksum !== analysis.decision.inputChecksum) {
      throw new Error(
        `Historical replay source revision changed after completion for ReviewAttempt ${analysis.source.id}.`,
      );
    }
    return {
      generatedCluster: false,
      generatedFactWrites: 0,
      generatedEpisode: false,
      idempotentSkip: true,
    };
  }

  const attestation = await appendL1TraceEvent(tx, {
    userId: analysis.source.userId,
    problemId: analysis.source.problemId,
    chatSessionId: analysis.source.chatSessionId,
    reviewAttemptId: analysis.source.id,
    eventType: "historical_replay_attestation",
    source: "memory_agent:historical_replay",
    content: `Historical Review ${analysis.decision.outcome} was reclassified under ${analysis.decision.evidenceScope} evidence.`,
    occurredAt: analysis.source.createdAt,
    eventJson: {
      replayRunId: replay.replayRunId,
      replayRuleVersion: HISTORICAL_REPLAY_RULE_VERSION,
      provenanceDecisionFingerprint: replay.provenanceDecisionFingerprint,
      originalReviewAttemptId: analysis.source.id,
      originalRunEvidenceId: analysis.runEvidence.id,
      originalRunEvidenceIds: analysis.decision.sourceRunEvidenceIds,
      originalDiagnosisId: analysis.decision.sourceDiagnosisId,
      originalProblemHistoryId: analysis.decision.sourceProblemHistoryId,
      inputChecksum: analysis.decision.inputChecksum,
      clusterId: analysis.decision.clusterId,
      executionFingerprint: analysis.decision.codeRevisionHash,
      status: analysis.runResult.status,
      providerUsed: analysis.evidenceVerdict.providerUsed,
      evidenceVerdict: analysis.evidenceVerdict,
      evidenceScope: analysis.decision.evidenceScope,
      canonicalMechanisms: analysis.decision.canonicalMechanisms,
      decision: analysis.decision.decision,
      decisionReasons: analysis.decision.decisionReasons,
      manualClassification: analysis.decision.manualClassification,
      materializesMemory: analysis.materializesMemory,
    },
  });
  const factCandidates = analysis.materializesMemory
    ? mapMemoryUpdateCandidateToFactCandidates({
        candidate: analysis.alignedCoachResult.diagnosis.memoryUpdateCandidate,
        evidenceTraceIds: [attestation.id],
      }).map((candidate) =>
        analysis.decision.evidenceScope === "local_visible"
          ? {
              ...candidate,
              observedBehavior: scopeLocalVisibleObservation(
                candidate.observedBehavior,
              ),
            }
          : candidate,
      )
    : [];
  const arbitration = analysis.materializesMemory
    ? await arbitrateFactCandidates(tx, {
        userId: analysis.source.userId,
        problemId: analysis.source.problemId,
        reviewAttemptId: analysis.source.id,
        source: "historical_replay",
        candidates: factCandidates,
        now: analysis.source.createdAt,
      })
    : { updated: [], rejected: [] };
  // An Episode is searchable history for one activity; an L2 fact is a durable
  // claim about the learner. They sit at different layers with different
  // evidence bars, so a Review with no portable fact candidate must still leave
  // retrievable history behind. Gating both on `materializesMemory` is what
  // made 46 approved Reviews across 43 problems invisible to Coach retrieval.
  const episodeId = `manual-replay-${shortHash(
    `${replay.provenanceDecisionFingerprint}\0${analysis.source.id}`,
  )}`;
  const existingEpisode = await tx.memoryEpisode.findUnique({
    where: { id: episodeId },
  });
  if (existingEpisode) {
    throw new Error(
      `Historical replay episode exists without completion marker for ReviewAttempt ${analysis.source.id}.`,
    );
  }
  const attemptOrdinal = await tx.reviewAttempt.count({
    where: {
      userId: analysis.source.userId,
      problemId: analysis.source.problemId,
      createdAt: { lte: analysis.source.createdAt },
    },
  });
  const evidenceSummary = factCandidates
    .map((candidate) =>
      episodeObservation(
        candidate.observedBehavior,
        analysis.decision.evidenceScope,
      ),
    )
    .filter(Boolean)
    .join(" ");
  const episode = await createMemoryEpisode(tx, {
    id: episodeId,
    userId: analysis.source.userId,
    problemId: analysis.source.problemId,
    chatSessionId: analysis.source.chatSessionId,
    memoryOrigin: "learner",
    createdAt: analysis.source.createdAt,
    ...buildReviewEpisode({
      problemTitle: analysis.source.problem.title,
      problemTags: analysis.problemTags,
      attemptOrdinal,
      runResult: analysis.runResult,
      diagnosis: {
        userIssueSummary: evidenceSummary,
        mistakeTags: analysis.decision.canonicalMechanisms,
      },
      sourceTraceIds: [attestation.id],
    }),
  });
  await appendL1TraceEvent(tx, {
    userId: analysis.source.userId,
    problemId: analysis.source.problemId,
    chatSessionId: analysis.source.chatSessionId,
    reviewAttemptId: analysis.source.id,
    eventType: "historical_replay_completed",
    source: "memory_agent:historical_replay",
    content: `Historical Review replay completed for cluster ${analysis.decision.clusterId}.`,
    occurredAt: new Date(analysis.source.createdAt.getTime() + 1),
    eventJson: {
      replayRunId: replay.replayRunId,
      replayRuleVersion: HISTORICAL_REPLAY_RULE_VERSION,
      provenanceDecisionFingerprint: replay.provenanceDecisionFingerprint,
      originalReviewAttemptId: analysis.source.id,
      inputChecksum: analysis.decision.inputChecksum,
      clusterId: analysis.decision.clusterId,
      generatedFactIds: arbitration.updated.map((fact) => fact.id),
      rejectedCandidates: arbitration.rejected,
      generatedEpisodeId: episode.id,
      memoryDisposition: analysis.materializesMemory
        ? "materialized"
        : "episode_only",
    },
  });
  return {
    generatedCluster: true,
    generatedFactWrites: arbitration.updated.length,
    generatedEpisode: Boolean(episode),
    idempotentSkip: false,
  };
}

function rejectedAnalysis(
  source: ReplaySourceReview,
  base: Pick<
    HistoricalReplayDecision,
    | "sourceReviewAttemptId"
    | "sourceRunEvidenceIds"
    | "sourceDiagnosisId"
    | "sourceProblemHistoryId"
    | "problemId"
    | "problemSlug"
    | "isShowcaseProblem"
    | "occurredAt"
    | "inputChecksum"
    | "manualClassification"
  >,
  decision: Exclude<HistoricalReplayDecisionKind, `accept_${string}`>,
  decisionReasons: string[],
  codeRevisionHash: string | null = null,
  outcome: string | null = null,
  evidenceScope: HistoricalReplayDecision["evidenceScope"] = null,
  canonicalMechanisms: string[] = [],
  blockedCandidateTags: string[] = [],
): ReplayAnalysis {
  return {
    source,
    decision: {
      ...base,
      codeRevisionHash,
      clusterId: null,
      outcome,
      evidenceScope,
      decision,
      decisionReasons,
      canonicalMechanisms,
      blockedCandidateTags,
      materializesMemory: false,
    },
  };
}

function isAcceptedAnalysis(
  analysis: ReplayAnalysis,
): analysis is AcceptedReplayAnalysis {
  return analysis.decision.decision.startsWith("accept_");
}

function evidenceScopeFor(verdict: EvidenceVerdict) {
  return verdict.evidenceClass === "local_only"
    ? ("local_visible" as const)
    : ("official_judge" as const);
}

function readProviderUsed(runResult: CodeRunResult) {
  const raw = asRecord(runResult.rawResult);
  return typeof raw.providerUsed === "string" && raw.providerUsed.trim()
    ? raw.providerUsed
    : undefined;
}

function parseStringArray(value: string) {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function validateManualDecisions(
  decisions: readonly ManualProvenanceDecision[],
) {
  if (decisions.length === 0) {
    throw new Error(
      "Historical replay requires a complete manual provenance manifest.",
    );
  }
  const byReviewId = new Map<string, ManualProvenanceDecision>();
  for (const decision of decisions) {
    if (byReviewId.has(decision.reviewAttemptId)) {
      throw new Error(
        `Historical replay received duplicate decision for ReviewAttempt ${decision.reviewAttemptId}.`,
      );
    }
    byReviewId.set(decision.reviewAttemptId, decision);
  }
  return byReviewId;
}

function validateDecisionCoverage(
  reviews: ReplaySourceReview[],
  decisionsByReviewId: ReadonlyMap<string, ManualProvenanceDecision>,
) {
  if (reviews.length !== decisionsByReviewId.size) {
    const found = new Set(reviews.map((review) => review.id));
    const missing = [...decisionsByReviewId.keys()].filter(
      (reviewId) => !found.has(reviewId),
    );
    throw new Error(
      `Historical replay manifest/database mismatch: expected ${decisionsByReviewId.size} reviews, found ${reviews.length}; missing ${missing.join(", ") || "unknown"}.`,
    );
  }
  for (const review of reviews) {
    const decision = decisionsByReviewId.get(review.id)!;
    if (decision.chatSessionId !== review.chatSessionId) {
      throw new Error(
        `Historical replay manifest session mismatch for ReviewAttempt ${review.id}.`,
      );
    }
    if (
      decision.leetcodeNumber !== null &&
      decision.leetcodeNumber !== review.problem.leetcodeNumber
    ) {
      throw new Error(
        `Historical replay manifest problem mismatch for ReviewAttempt ${review.id}.`,
      );
    }
  }
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableClusterId(
  reviewAttemptId: string,
  runEvidenceId: string,
  codeRevisionHash: string,
) {
  return `replay-cluster:${shortHash(
    [HISTORICAL_REPLAY_RULE_VERSION, reviewAttemptId, runEvidenceId, codeRevisionHash].join(
      "\0",
    ),
  )}`;
}

function checksum(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function lowercaseFirst(value: string) {
  return value ? `${value[0]!.toLowerCase()}${value.slice(1)}` : value;
}

function scopeLocalVisibleObservation(value: string) {
  return /local visible tests/i.test(value)
    ? value
    : `Within selected local visible tests, ${lowercaseFirst(value)}`;
}

function episodeObservation(
  value: string,
  evidenceScope: HistoricalReplayDecision["evidenceScope"],
) {
  const compact = value
    .replace(/^Within selected local visible tests,\s*/i, "")
    .replace(
      /;\s*this (?:claim )?does not establish official acceptance or hidden-test coverage\.?$/i,
      ".",
    )
    .trim();
  return evidenceScope === "local_visible"
    ? `Local visible evidence: ${lowercaseFirst(compact)}`
    : compact;
}
