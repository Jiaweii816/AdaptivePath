import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryCitationDataset } from "./memory-citation-dataset";
import type { MemoryRetrievalDataset } from "./memory-retrieval-dataset";
import { formatRate } from "./memory-retrieval-report";
import type {
  CitationRate,
  DeferredAblationArm,
  MemoryAblationArmName,
  MemoryAblationArmScore,
  MemoryCitationSuiteScore,
  TokenEstimatorType,
  TokenReduction,
} from "./memory-ablation-metrics";
import type { MemoryAblationCitationLlmRun } from "./memory-ablation-suite";

export const MEMORY_ABLATION_SUITE_NAME = "memory-ablation";

export const MEMORY_ABLATION_LIMITATIONS = [
  "Ablation uses the selected synthetic learner seed and query dataset; it is a controlled baseline, not a complete learner-memory distribution.",
  "Prompt token counts use an approximate chars/4 estimator and are not provider usage.",
  "Full-history builders are eval-only and do not represent a product strategy.",
  "Retrieval/token ablation metrics are deterministic and do not require an LLM; personalized citation metrics use the real Chat LLM and are deterministic only for the structured citation block.",
  "Citation case labels are agent-drafted and require human review.",
  "FTS+vector hybrid is deferred unless an eval DB has stable episode embeddings and a configured embedding provider.",
];

export type MemoryAblationQueryRun = {
  arm: MemoryAblationArmName;
  queryId: string;
  promptTokens: number;
  retrievedKeys: string[];
  missingExpectedFactKeys: string[];
  missingExpectedEpisodeKeys: string[];
  surfacedForbiddenKeys: string[];
};

export type MemoryAblationArmReport = MemoryAblationArmScore & {
  label: string;
  evalOnly: boolean;
  includeL2Facts: boolean;
  retrievalMode: "fts_only" | "prompt_order";
};

export type MemoryAblationReport = {
  suiteName: typeof MEMORY_ABLATION_SUITE_NAME;
  runId: string;
  generatedAt: string;
  dbPath: string;
  seedDbPath: string;
  runDbPath: string;
  manifestPath: string;
  queryDatasetPath: string;
  citationDatasetPath: string;
  retrievalNow: string;
  dbKept: boolean;
  llmUsed: boolean;
  tokenEstimator: TokenEstimatorType;
  queryCount: number;
  citationCaseCount: number;
  arms: MemoryAblationArmReport[];
  armNames: MemoryAblationArmName[];
  deferredArms: DeferredAblationArm[];
  tokenReductions: TokenReduction[];
  citation: {
    dataset: {
      name: string;
      version: string;
      status: string;
      humanReviewStatus: string;
      limitations: string[];
    };
    score: MemoryCitationSuiteScore;
    llmRuns: MemoryAblationCitationLlmRun[];
  };
  queryDataset: {
    name: string;
    version: string;
    status: string;
    humanReviewStatus: string;
    limitations: string[];
  };
  runs: MemoryAblationQueryRun[];
  warnings: string[];
  limitations: string[];
  reportPaths: {
    markdown: string;
    json: string;
  };
};

export function buildMemoryAblationReport(args: {
  runId: string;
  generatedAt: Date;
  seedDbPath: string;
  runDbPath: string;
  manifestPath: string;
  queryDatasetPath: string;
  citationDatasetPath: string;
  retrievalNow: Date;
  dbKept: boolean;
  queryDataset: MemoryRetrievalDataset;
  citationDataset: MemoryCitationDataset;
  arms: MemoryAblationArmReport[];
  deferredArms: DeferredAblationArm[];
  tokenReductions: TokenReduction[];
  citationScore: MemoryCitationSuiteScore;
  citationRuns: MemoryAblationCitationLlmRun[];
  llmUsed: boolean;
  runs: MemoryAblationQueryRun[];
  warnings: string[];
  reportPaths: { markdown: string; json: string };
}): MemoryAblationReport {
  return {
    suiteName: MEMORY_ABLATION_SUITE_NAME,
    runId: args.runId,
    generatedAt: args.generatedAt.toISOString(),
    dbPath: args.runDbPath,
    seedDbPath: args.seedDbPath,
    runDbPath: args.runDbPath,
    manifestPath: args.manifestPath,
    queryDatasetPath: args.queryDatasetPath,
    citationDatasetPath: args.citationDatasetPath,
    retrievalNow: args.retrievalNow.toISOString(),
    dbKept: args.dbKept,
    llmUsed: args.llmUsed,
    tokenEstimator: "approx_chars_div_4_v1",
    queryCount: args.queryDataset.cases.length,
    citationCaseCount: args.citationDataset.cases.length,
    arms: args.arms,
    armNames: args.arms.map((arm) => arm.arm),
    deferredArms: args.deferredArms,
    tokenReductions: args.tokenReductions,
    citation: {
      dataset: {
        name: args.citationDataset.name,
        version: args.citationDataset.datasetVersion,
        status: args.citationDataset.status,
        humanReviewStatus: args.citationDataset.humanReviewStatus,
        limitations: args.citationDataset.limitations,
      },
      score: args.citationScore,
      llmRuns: args.citationRuns,
    },
    queryDataset: {
      name: args.queryDataset.name,
      version: args.queryDataset.datasetVersion,
      status: args.queryDataset.status,
      humanReviewStatus: args.queryDataset.humanReviewStatus,
      limitations: args.queryDataset.limitations,
    },
    runs: args.runs,
    warnings: args.warnings,
    limitations: [
      ...new Set([
        ...MEMORY_ABLATION_LIMITATIONS,
        ...args.queryDataset.limitations,
        ...args.citationDataset.limitations,
      ]),
    ],
    reportPaths: args.reportPaths,
  };
}

export function writeMemoryAblationReport(report: MemoryAblationReport) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(report.reportPaths.markdown, renderMemoryAblationMarkdown(report), "utf8");
  writeFileSync(report.reportPaths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function renderMemoryAblationMarkdown(report: MemoryAblationReport) {
  const focused = report.arms.find((arm) => arm.arm === "focused_l2_fts");
  const full = report.arms.find((arm) => arm.arm === "full_history_l2_eval_only");
  const primaryReduction = report.tokenReductions.find(
    (item) =>
      item.baselineArm === "full_history_l2_eval_only" &&
      item.comparisonArm === "focused_l2_fts",
  );

  return [
    `# Eval Suite: ${report.suiteName}`,
    "",
    "## Header",
    "",
    `- Suite name: ${report.suiteName}`,
    `- Run id: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Seed DB path: ${report.seedDbPath}`,
    `- Run DB path: ${report.runDbPath}`,
    `- DB kept: ${report.dbKept ? "yes" : "no"}`,
    `- Manifest path: ${report.manifestPath}`,
    `- Query dataset path: ${report.queryDatasetPath}`,
    `- Citation dataset path: ${report.citationDatasetPath}`,
    `- Retrieval decay anchor: ${report.retrievalNow}`,
    `- Ablation arms: ${report.armNames.join(", ")}`,
    `- Query count: ${report.queryCount}`,
    `- Citation case count: ${report.citationCaseCount}`,
    `- LLM used: ${report.llmUsed ? "yes" : "no"}`,
    `- Token estimator: ${report.tokenEstimator}`,
    `- Query ground truth pending human review: ${report.queryDataset.humanReviewStatus === "pending" ? "yes" : "no"}`,
    `- Citation ground truth pending human review: ${report.citation.dataset.humanReviewStatus === "pending" ? "yes" : "no"}`,
    "",
    "## Decision Summary",
    "",
    ...buildDecisionSummary(report),
    "",
    "## Token Summary",
    "",
    "| Arm | Avg tokens | P50 | P95 | Min | Max |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.arms.map(
      (arm) =>
        `| ${arm.arm} | ${formatNumber(arm.promptTokens.avg)} | ${formatNumber(arm.promptTokens.p50)} | ${formatNumber(arm.promptTokens.p95)} | ${arm.promptTokens.min} | ${arm.promptTokens.max} |`,
    ),
    "",
    "## Focused Vs Full-History Token Reduction",
    "",
    primaryReduction
      ? `Focused context average tokens: ${formatNumber(focused?.promptTokens.avg ?? 0)}; full-history average tokens: ${formatNumber(full?.promptTokens.avg ?? 0)}; reduction: ${formatNumber(primaryReduction.absoluteTokens)} tokens (${formatRate(primaryReduction.percent)}).`
      : "Focused vs full-history token reduction could not be computed.",
    "",
    "## Per Arm Channel Retrieval Metrics",
    "",
    "| Arm | factRecall@factChannel | episodeRecall@episodeChannel | factPrecision | episodePrecision | factForbidden | episodeForbidden | rank-normalized precision@5 | legacy mixed precision@5 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.arms.map(
      (arm) =>
        `| ${arm.arm} | ${formatRateWithCount(arm.retrieval.plantedFactRecall)} | ${formatRateWithCount(arm.retrieval.plantedEpisodeRecall)} | ${formatRateWithCount(arm.retrieval.factPrecision)} | ${formatRateWithCount(arm.retrieval.episodePrecision)} | ${formatRateWithCount(arm.retrieval.factForbiddenSurfacing)} | ${formatRateWithCount(arm.retrieval.episodeForbiddenSurfacing)} | ${formatRateWithCount(arm.retrieval.rankNormalizedPrecisionAtK)} | ${formatRateWithCount(arm.retrieval.precisionAtK)} |`,
    ),
    "",
    "Legacy mixed precision is retained only as raw-score top-K diagnostic; fact and episode scores are not comparable across memory kinds.",
    "",
    "## Worst Category By Arm",
    "",
    "| Arm | Worst category | factRecall | episodeRecall | factForbidden | episodeForbidden | rank-normalized precision |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...report.arms.map((arm) => {
      const worst = worstCategoryForArm(arm);

      return `| ${arm.arm} | ${worst.category} | ${formatRateWithCount(worst.plantedFactRecall)} | ${formatRateWithCount(worst.plantedEpisodeRecall)} | ${formatRateWithCount(worst.factForbiddenSurfacing)} | ${formatRateWithCount(worst.episodeForbiddenSurfacing)} | ${formatRateWithCount(worst.rankNormalizedPrecisionAtK)} |`;
    }),
    "",
    "## Personalized Citation Metrics",
    "",
    `- Citation scoring status: ${report.citation.score.scoringStatus}`,
    `- Hallucinated memory rate: ${formatNullableRate(report.citation.score.hallucinatedMemoryRate)}`,
    `- Affected reply hallucination rate: ${formatNullableRate(report.citation.score.affectedReplyHallucinationRate)}`,
    `- Structured citation coverage: ${formatNullableRate(report.citation.score.structuredCitationCoverage)}`,
    `- Expected citation recall: ${formatNullableRate(report.citation.score.expectedCitationRecall)}`,
    `- Forbidden citation rate: ${formatNullableRate(report.citation.score.forbiddenCitationRate)}`,
    `- Unsupported citation rate: ${formatNullableRate(report.citation.score.unsupportedCitationRate)}`,
    `- No-citation / unscorable count: ${report.citation.score.noCitationOrUnscorableCount}`,
    `- Citation LLM ok/error: ${report.citation.llmRuns.filter((run) => run.status === "ok").length}/${report.citation.llmRuns.filter((run) => run.status === "error").length}`,
    "",
    "## Findings",
    "",
    ...buildFindings(report),
    "",
    "## Deferred Arms",
    "",
    ...(report.deferredArms.length > 0
      ? report.deferredArms.map((item) => `- ${item.arm}: ${item.reason}`)
      : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length > 0
      ? report.warnings.map((warning) => `- ${warning}`)
      : ["- None"]),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
    "## Human Audit Checklist",
    "",
    "- Confirm the eval-only full-history builder is not imported by product code.",
    "- Confirm retrieval defaults and product memory behavior remain unchanged.",
    "- Review whether focused vs full-history trade-offs are fairly described.",
    "- Review citation expected/forbidden keys and no-evidence cases.",
    "- Decide whether hallucinated memory scoring is too strict or too loose once structured citations exist.",
    "- Mark token reduction as approximate unless provider usage is collected.",
    "- Decide which numbers are interview-ready and which are only a seed baseline.",
    "- Choose Week4 memory optimization targets from the worst buckets.",
    "",
  ].join("\n");
}

function buildFindings(report: MemoryAblationReport) {
  const findings: string[] = [];
  const worst = [...report.arms].sort(
    (a, b) =>
      a.retrieval.rankNormalizedPrecisionAtK.rate -
      b.retrieval.rankNormalizedPrecisionAtK.rate,
  )[0];
  const focused = report.arms.find((arm) => arm.arm === "focused_l2_fts");
  const full = report.arms.find((arm) => arm.arm === "full_history_l2_eval_only");

  if (worst) {
    findings.push(
      `- Lowest rank-normalized precision arm: ${worst.arm} (${formatRateWithCount(worst.retrieval.rankNormalizedPrecisionAtK)}).`,
    );
  }
  if (focused && full) {
    findings.push(
      `- Focused fact forbidden surfacing is ${formatRateWithCount(focused.retrieval.factForbiddenSurfacing)} vs full-history with L2 ${formatRateWithCount(full.retrieval.factForbiddenSurfacing)}.`,
    );
    findings.push(
      `- Focused episode-channel recall is ${formatRateWithCount(focused.retrieval.plantedEpisodeRecall)}; legacy mixed top-K recall is no longer used as the primary episode metric.`,
    );
  }
  if (report.citation.score.hallucinatedMemoryRate.rate === null) {
    findings.push(
      "- Hallucinated memory rate is not reported as deterministic because this run produced no structured citation blocks.",
    );
  }

  return findings;
}

function buildDecisionSummary(report: MemoryAblationReport) {
  const focusedL2 = report.arms.find((arm) => arm.arm === "focused_l2_fts");
  const focusedNoL2 = report.arms.find(
    (arm) => arm.arm === "focused_no_l2_fts",
  );
  const fullL2 = report.arms.find(
    (arm) => arm.arm === "full_history_l2_eval_only",
  );
  const fullNoL2 = report.arms.find(
    (arm) => arm.arm === "full_history_no_l2_eval_only",
  );
  const focusedReduction = report.tokenReductions.find(
    (item) =>
      item.baselineArm === "full_history_l2_eval_only" &&
      item.comparisonArm === "focused_l2_fts",
  );
  const lines: string[] = [];

  if (focusedL2 && fullL2 && focusedReduction) {
    lines.push(
      `- Recommended default-quality arm remains focused_l2_fts: factRecall@factChannel is ${formatRateWithCount(focusedL2.retrieval.plantedFactRecall)}, episodeRecall@episodeChannel is ${formatRateWithCount(focusedL2.retrieval.plantedEpisodeRecall)}, and it reduces average prompt tokens by ${formatNumber(focusedReduction.absoluteTokens)} (${formatRate(focusedReduction.percent)}) versus full_history_l2_eval_only.`,
    );
    lines.push(
      `- Avoid treating full_history_l2_eval_only as better just because it contains more memory: it uses ${formatNumber(fullL2.promptTokens.avg)} avg tokens and legacy raw-score mixed precision is diagnostic only, not a product decision metric.`,
    );
  }
  if (focusedNoL2) {
    lines.push(
      `- focused_no_l2_fts is cheaper (${formatNumber(focusedNoL2.promptTokens.avg)} avg tokens) and is useful as an episode-channel diagnostic, but it drops factRecall@factChannel to ${formatRateWithCount(focusedNoL2.retrieval.plantedFactRecall)}, so it is not a product strategy when L2 facts matter.`,
    );
  }
  if (fullNoL2) {
    lines.push(
      `- full_history_no_l2_eval_only has episodeRecall@episodeChannel ${formatRateWithCount(fullNoL2.retrieval.plantedEpisodeRecall)} but loses all factRecall@factChannel (${formatRateWithCount(fullNoL2.retrieval.plantedFactRecall)}) and is still eval-only.`,
    );
  }
  lines.push(
    "- Conclusion: focused context with L2 facts is the best implemented trade-off for personalized memory quality plus token cost; full-history is a naive baseline that is more expensive and can still surface stale or irrelevant memory.",
  );

  return lines;
}

function worstCategoryForArm(arm: MemoryAblationArmReport) {
  return [...arm.retrieval.perCategory].sort(
    (a, b) =>
      channelQualityScore(a) - channelQualityScore(b),
  )[0];
}

function channelQualityScore(category: MemoryAblationArmReport["retrieval"]["perCategory"][number]) {
  const factWeight = category.plantedFactRecall.denominator > 0 ? 1 : 0;
  const episodeWeight = category.plantedEpisodeRecall.denominator > 0 ? 1 : 0;
  const denominator = factWeight + episodeWeight;

  if (denominator === 0) {
    return category.rankNormalizedPrecisionAtK.rate;
  }

  return (
    category.plantedFactRecall.rate * factWeight +
    category.plantedEpisodeRecall.rate * episodeWeight
  ) / denominator;
}

function formatNullableRate(rate: CitationRate) {
  if (rate.rate === null) {
    return `unscorable (${rate.numerator}/${rate.denominator})`;
  }

  const interval = rate.wilson95
    ? `, Wilson 95% ${formatRate(rate.wilson95.lower)}-${formatRate(rate.wilson95.upper)}`
    : "";

  return `${formatRate(rate.rate)} (${rate.numerator}/${rate.denominator}${interval})`;
}

function formatRateWithCount(rate: {
  numerator: number;
  denominator: number;
  rate: number;
  wilson95?: { lower: number; upper: number } | null;
}) {
  const interval = rate.wilson95
    ? `, Wilson 95% ${formatRate(rate.wilson95.lower)}-${formatRate(rate.wilson95.upper)}`
    : "";

  return `${formatRate(rate.rate)} (${rate.numerator}/${rate.denominator}${interval})`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
