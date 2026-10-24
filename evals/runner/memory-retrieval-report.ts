import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CoachMemoryAssembly } from "@/server/memory";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";
import type {
  MemoryRetrievalCategory,
  MemoryRetrievalDataset,
} from "./memory-retrieval-dataset";
import type {
  MemoryRetrievalScoredQuery,
  MemoryRetrievalSuiteScore,
} from "./memory-retrieval-metrics";

export const MEMORY_RETRIEVAL_SUITE_NAME = "memory-retrieval";

export const MEMORY_RETRIEVAL_LIMITATIONS = [
  "Memory query labels are agent-drafted and require human review before final ground-truth use.",
  "The synthetic learner history is scenario-scoped and not a complete learner-memory distribution.",
  "Precision metrics are retrieval-layer metrics; they do not measure final Coach reply quality.",
  "Core fact/episode metrics are scored within their own retrieval channels, matching the product's partitioned memory injection path.",
  "Legacy raw-score mixed top-K is diagnostic only: fact and episode scores are not comparable across memory kinds.",
  "Rank-normalized precision@K reflects final cross-type context exposure only; product retrieval still injects memory by partitioned channels.",
  "Small buckets such as api, low-confidence, and skill are directional rather than statistically stable; read every rate with its numerator/denominator and Wilson interval.",
  "v1.1 is a human-approved dev/calibration set, not a held-out release gate; v1.2 should carry held-out gate claims.",
  "Scoring projects selected learner-memory candidates from CoachMemoryAssembly decisions; provider-facing quality is reported from CoachMemoryBrief.",
  "Retrieval decay scoring is anchored to the seed manifest's generatedAt timestamp so repeated runs over the same seed DB and manifest remain comparable.",
  "Preference facts are valid L2 rows but are not expected positives in v1 because current retrieval profiles do not include factType=preference.",
  "Chinese-first query coverage matters because FTS and lexical matching can be language-sensitive; check the dataset version before claiming bilingual coverage.",
  "Distractor quality depends on the seed manifest; small or homogeneous manifests can make precision look better than the real product setting.",
];

export type MemoryRetrievalRunResult = {
  queryId: string;
  category: MemoryRetrievalCategory;
  problemSlug: string;
  entry: unknown;
  userQuestion: string;
  profileOutputPreferences: string[];
  profilePreferenceMarkersMatched: string[];
  retrieved: Array<{
    kind: "fact" | "episode";
    id: string;
    key?: string;
    score?: number;
    label: string;
    unknown: boolean;
  }>;
  injected: Array<{
    kind: "fact" | "episode";
    id: string;
    key?: string;
    score?: number;
    label: string;
    unknown: boolean;
  }>;
  memoryContext: Pick<
    CoachMemoryBrief,
    | "teachableMemories"
    | "domainReferences"
    | "outputPreferences"
    | "teachingStrategy"
  >;
  assembly: Pick<CoachMemoryAssembly, "candidateFingerprint" | "decisions"> & {
    candidateCount: number;
    droppedTags: string[];
  };
  retrievalStatus: CoachMemoryBrief["retrievalStatus"];
};

export type MemoryRetrievalReport = {
  suiteName: typeof MEMORY_RETRIEVAL_SUITE_NAME;
  runId: string;
  generatedAt: string;
  dbPath: string;
  seedDbPath: string;
  runDbPath: string;
  manifestPath: string;
  datasetPath: string;
  retrievalNow: string;
  dbKept: boolean;
  llmUsed: false;
  queryCount: number;
  k: number;
  dataset: {
    name: string;
    version: string;
    status: string;
    humanReviewStatus: string;
    limitations: string[];
  };
  score: MemoryRetrievalSuiteScore;
  runs: MemoryRetrievalRunResult[];
  itemLabels: Record<string, string>;
  warnings: string[];
  limitations: string[];
  reportPaths: {
    markdown: string;
    json: string;
  };
};

export function buildMemoryRetrievalReport(args: {
  runId: string;
  generatedAt: Date;
  seedDbPath: string;
  runDbPath: string;
  manifestPath: string;
  datasetPath: string;
  retrievalNow: Date;
  dbKept: boolean;
  dataset: MemoryRetrievalDataset;
  score: MemoryRetrievalSuiteScore;
  runs: MemoryRetrievalRunResult[];
  itemLabels: Record<string, string>;
  warnings: string[];
  reportPaths: { markdown: string; json: string };
}): MemoryRetrievalReport {
  return {
    suiteName: MEMORY_RETRIEVAL_SUITE_NAME,
    runId: args.runId,
    generatedAt: args.generatedAt.toISOString(),
    dbPath: args.runDbPath,
    seedDbPath: args.seedDbPath,
    runDbPath: args.runDbPath,
    manifestPath: args.manifestPath,
    datasetPath: args.datasetPath,
    retrievalNow: args.retrievalNow.toISOString(),
    dbKept: args.dbKept,
    llmUsed: false,
    queryCount: args.dataset.cases.length,
    k: args.dataset.defaultK,
    dataset: {
      name: args.dataset.name,
      version: args.dataset.datasetVersion,
      status: args.dataset.status,
      humanReviewStatus: args.dataset.humanReviewStatus,
      limitations: args.dataset.limitations,
    },
    score: args.score,
    runs: args.runs,
    itemLabels: args.itemLabels,
    warnings: args.warnings,
    limitations: [...new Set([...MEMORY_RETRIEVAL_LIMITATIONS, ...args.dataset.limitations])],
    reportPaths: args.reportPaths,
  };
}

export function writeMemoryRetrievalReport(report: MemoryRetrievalReport) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(report.reportPaths.markdown, renderMemoryRetrievalMarkdown(report), "utf8");
  writeFileSync(report.reportPaths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function renderMemoryRetrievalMarkdown(report: MemoryRetrievalReport) {
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
    `- Dataset path: ${report.datasetPath}`,
    `- Retrieval decay anchor: ${report.retrievalNow}`,
    `- Query count: ${report.queryCount}`,
    `- K: ${report.k}`,
    `- LLM used: ${report.llmUsed ? "yes" : "no"}`,
    `- Dataset: ${report.dataset.name} (${report.dataset.version}; ${report.dataset.status})`,
    `- Query ground truth pending human review: ${report.dataset.humanReviewStatus === "pending" ? "yes" : "no"}`,
    "",
    "## Core Channel Metrics",
    "",
    "| Metric | Value | Numerator | Denominator | Wilson 95% CI |",
    "|---|---:|---:|---:|---:|",
    metricRow("irrelevantInjectionRate", report.score.irrelevantInjectionRate),
    metricRow("injectedPrecision", report.score.injectedPrecision),
    metricRow("noMemoryRate", report.score.noMemoryRate),
    metricRow("factRecall@factBudget", report.score.plantedFactRecall),
    metricRow("episodeRecall@episodeBudget", report.score.plantedEpisodeRecall),
    metricRow("fact recall ceiling from profile budget", report.score.factRecallCeiling),
    metricRow(
      "episode recall ceiling from profile budget",
      report.score.episodeRecallCeiling,
    ),
    metricRow("factPrecision@factBudget", report.score.factPrecision),
    metricRow("episodePrecision@episodeBudget", report.score.episodePrecision),
    metricRow(
      "factForbiddenSurfacing@factBudget",
      report.score.factForbiddenSurfacing,
    ),
    metricRow(
      "episodeForbiddenSurfacing@episodeBudget",
      report.score.episodeForbiddenSurfacing,
    ),
    metricRow("Preference marker recall", report.score.preferenceMarkerRecall),
    metricRow("Unknown fact item rate", report.score.unknownFactItemRate),
    metricRow("Unknown episode item rate", report.score.unknownEpisodeItemRate),
    "",
    "## Rank-Normalized Exposure Metrics",
    "",
    `These metrics combine fact and episode channels after per-channel RRF normalization. They describe final context exposure only; they do not replace channel metrics.`,
    "",
    "| Metric | Value | Numerator | Denominator | Wilson 95% CI |",
    "|---|---:|---:|---:|---:|",
    metricRow(
      `rank-normalized precision@${report.k}`,
      report.score.rankNormalizedPrecisionAtK,
    ),
    metricRow(
      "rank-normalized expected-slot ceiling",
      report.score.rankNormalizedPrecisionCeiling,
    ),
    metricRow(
      `rank-normalized ceiling-normalized precision@${report.k}`,
      report.score.rankNormalizedCeilingNormalizedPrecisionAtK,
    ),
    metricRow(
      "rank-normalized stale-surfacing rate",
      report.score.rankNormalizedStaleSurfacing,
    ),
    metricRow(
      "rank-normalized affected query rate",
      report.score.rankNormalizedAffectedQueryRate,
    ),
    "",
    "## Legacy Raw-Score Mixed Top-K Diagnostic",
    "",
    "legacy raw-score mixed top-K (not comparable across memory kinds). Fact scores and episode RRF scores live on different scales; this block is retained only for backward comparison.",
    "",
    "| Metric | Value | Numerator | Denominator | Wilson 95% CI |",
    "|---|---:|---:|---:|---:|",
    metricRow(`legacy raw-score mixed precision@${report.k}`, report.score.precisionAtK),
    metricRow("legacy expected-slot precision ceiling", report.score.precisionCeiling),
    metricRow(
      `legacy ceiling-normalized precision@${report.k}`,
      report.score.ceilingNormalizedPrecisionAtK,
    ),
    metricRow("legacy retrieved-item precision", report.score.retrievedItemPrecision),
    metricRow("legacy stale-surfacing rate", report.score.staleSurfacing),
    metricRow("legacy affected query rate", report.score.affectedQueryRate),
    metricRow(
      "legacy unknown retrieved item rate",
      report.score.unknownRetrievedItemRate,
    ),
    "",
    "## Findings",
    "",
    ...buildFindings(report),
    "",
    "## Per Category",
    "",
    `| Category | Queries | Fact budget(s) | Episode budget(s) | irrelevantInjection | injectedPrecision | noMemory | factRecall@factBudget | episodeRecall@episodeBudget | factPrecision | episodePrecision | factForbidden | episodeForbidden | rank-normalized precision@${report.k} | legacy mixed precision@${report.k} |`,
    "|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.score.perCategory.map(
      (item) =>
        `| ${item.category} | ${item.queryCount} | ${formatBudgets(report, item.category, "fact")} | ${formatBudgets(report, item.category, "episode")} | ${formatRateWithCount(item.irrelevantInjectionRate)} | ${formatRateWithCount(item.injectedPrecision)} | ${formatRateWithCount(item.noMemoryRate)} | ${formatRateWithCount(item.plantedFactRecall)} | ${formatRateWithCount(item.plantedEpisodeRecall)} | ${formatRateWithCount(item.factPrecision)} | ${formatRateWithCount(item.episodePrecision)} | ${formatRateWithCount(item.factForbiddenSurfacing)} | ${formatRateWithCount(item.episodeForbiddenSurfacing)} | ${formatRateWithCount(item.rankNormalizedPrecisionAtK)} | ${formatRateWithCount(item.precisionAtK)} |`,
    ),
    "",
    "Small category rows are directional rather than stable conclusions; compare numerator/denominator and Wilson intervals before interpreting api/low-confidence/skill buckets.",
    "",
    "## Per Query Summary",
    "",
    "| Query | Category | Fact budget | Episode budget | Recall cap notes | Expected facts | Expected episodes | Expected preference markers | Injected items | Injected forbidden | Retrieved facts | Retrieved episodes | Rank-normalized top K | Legacy raw-score mixed top K | Missing facts | Missing episodes | Missing preference markers | Surfaced forbidden | Surfaced neutral | Unknown channel items | factRecall | episodeRecall | rank-normalized precision@K | legacy mixed precision@K |",
    "|---|---|---:|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---:|",
    ...report.score.queries.map((query) => queryRow(query, report)),
    "",
    "## Queries Without Expected Facts",
    "",
    ...(report.score.noExpectedFactQueryIds.length > 0
      ? report.score.noExpectedFactQueryIds.map((queryId) => `- ${queryId}`)
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
    "- Review every query's expectedFactKeys.",
    "- Review every query's expectedEpisodeKeys.",
    "- Review forbidden stale keys for strictness.",
    "- Confirm query categories are suitable for interview storytelling.",
    "- Confirm manifest facts/episodes are valid ground truth.",
    "- Decide whether these v1 numbers are interview-ready or only a seed baseline.",
    "- Add more real-practice query traces before claiming broad memory quality.",
    "",
  ].join("\n");
}

function queryRow(
  query: MemoryRetrievalScoredQuery,
  report: MemoryRetrievalReport,
) {
  const forbidden = [
    ...query.surfacedForbiddenFactKeys,
    ...query.surfacedForbiddenEpisodeKeys,
  ];
  const neutral = [
    ...query.surfacedNeutralFactKeys,
    ...query.surfacedNeutralEpisodeKeys,
  ];

  return [
    query.queryId,
    query.category,
    String(query.factBudget),
    String(query.episodeBudget),
    recallCapNotes(query),
    formatList(query.expectedFactKeys.map((key) => formatItem(key, report))),
    formatList(query.expectedEpisodeKeys.map((key) => formatItem(key, report))),
    formatList(query.expectedProfilePreferenceMarkers),
    formatList(
      query.injectedItems.map((item) =>
        `${item.kind}:${item.key ? formatItem(item.key, report) : `unknown:${item.id}`}`,
      ),
    ),
    formatList(query.injectedForbiddenKeys.map((key) => formatItem(key, report))),
    formatList(
      query.retrievedFacts.map((item) =>
        `${item.kind}:${item.key ? formatItem(item.key, report) : `unknown:${item.id}`}`,
      ),
    ),
    formatList(
      query.retrievedEpisodes.map((item) =>
        `${item.kind}:${item.key ? formatItem(item.key, report) : `unknown:${item.id}`}`,
      ),
    ),
    formatList(
      query.rankNormalizedTopK.map((item) =>
        `${item.kind}:${item.key ? formatItem(item.key, report) : `unknown:${item.id}`}`,
      ),
    ),
    formatList(
      query.retrievedTopK.map((item) =>
        `${item.kind}:${item.key ? formatItem(item.key, report) : `unknown:${item.id}`}`,
      ),
    ),
    formatList(query.missingExpectedFactKeys.map((key) => formatItem(key, report))),
    formatList(
      query.missingExpectedEpisodeKeys.map((key) => formatItem(key, report)),
    ),
    formatList(query.missingProfilePreferenceMarkers),
    formatList(forbidden.map((key) => formatItem(key, report))),
    formatList(neutral.map((key) => formatItem(key, report))),
    formatList(
      [...query.unknownFactItems, ...query.unknownEpisodeItems].map(
        (item) => `${item.kind}:${item.id}`,
      ),
    ),
    formatRatioWithWilson({
      numerator: query.factRecallNumerator,
      denominator: query.factRecallDenominator,
    }),
    formatRatioWithWilson({
      numerator: query.episodeRecallNumerator,
      denominator: query.episodeRecallDenominator,
    }),
    formatRatioWithWilson({
      numerator: query.rankNormalizedRelevantAtK,
      denominator: query.k,
    }),
    formatRatioWithWilson({
      numerator: query.relevantAtK,
      denominator: query.k,
    }),
  ]
    .map(escapePipe)
    .join(" | ")
    .replace(/^/, "| ")
    .replace(/$/, " |");
}

function metricRow(
  label: string,
  value: {
    numerator: number;
    denominator: number;
    rate: number;
    wilson95?: { lower: number; upper: number } | null;
  },
) {
  return `| ${label} | ${formatRate(value.rate)} | ${value.numerator} | ${value.denominator} | ${formatWilson(value.wilson95)} |`;
}

function buildFindings(report: MemoryRetrievalReport) {
  const findings: string[] = [];
  const missingFacts = report.score.queries.filter(
    (query) => query.missingExpectedFactKeys.length > 0,
  );
  const missingEpisodes = report.score.queries.filter(
    (query) => query.missingExpectedEpisodeKeys.length > 0,
  );
  const missingPreferenceMarkers = report.score.queries.filter(
    (query) => query.missingProfilePreferenceMarkers.length > 0,
  );
  const forbiddenHits = report.score.queries.filter(
    (query) =>
      query.surfacedForbiddenFactKeys.length > 0 ||
      query.surfacedForbiddenEpisodeKeys.length > 0,
  );
  const forbiddenInjections = report.score.queries.filter(
    (query) => query.injectedForbiddenKeys.length > 0,
  );
  const neutralHits = report.score.queries.filter(
    (query) =>
      query.surfacedNeutralFactKeys.length > 0 ||
      query.surfacedNeutralEpisodeKeys.length > 0,
  );

  if (missingFacts.length > 0) {
    findings.push(
      `- Missing planted facts: ${missingFacts
        .map(
          (query) =>
            `${query.queryId} -> ${formatList(
              query.missingExpectedFactKeys.map((key) => formatItem(key, report)),
            )}`,
        )
        .join("; ")}.`,
    );
  }
  if (missingEpisodes.length > 0) {
    findings.push(
      `- Missing planted episodes: ${missingEpisodes
        .map(
          (query) =>
            `${query.queryId} -> ${formatList(
              query.missingExpectedEpisodeKeys.map((key) =>
                formatItem(key, report),
              ),
            )}`,
        )
        .join("; ")}.`,
    );
  }
  if (missingPreferenceMarkers.length > 0) {
    findings.push(
      `- Missing preference markers: ${missingPreferenceMarkers
        .map(
          (query) =>
            `${query.queryId} -> ${formatList(
              query.missingProfilePreferenceMarkers,
            )}`,
        )
        .join("; ")}.`,
    );
  }
  if (forbiddenHits.length > 0) {
    findings.push(
      `- Forbidden stale facts/episodes surfaced: ${forbiddenHits
        .map((query) =>
          `${query.queryId} -> ${formatList(
            [
              ...query.surfacedForbiddenFactKeys,
              ...query.surfacedForbiddenEpisodeKeys,
            ].map((key) => formatItem(key, report)),
          )}`,
        )
        .join("; ")}.`,
    );
  }
  if (forbiddenInjections.length > 0) {
    findings.push(
      `- Forbidden facts/episodes reached the prompt: ${forbiddenInjections
        .map((query) =>
          `${query.queryId} -> ${formatList(
            query.injectedForbiddenKeys.map((key) => formatItem(key, report)),
          )}`,
        )
        .join("; ")}.`,
    );
  }
  if (neutralHits.length > 0) {
    findings.push(
      `- Neutral historical facts/episodes surfaced: ${neutralHits
        .map((query) =>
          `${query.queryId} -> ${formatList(
            [
              ...query.surfacedNeutralFactKeys,
              ...query.surfacedNeutralEpisodeKeys,
            ].map((key) => formatItem(key, report)),
          )}`,
        )
        .join("; ")}.`,
    );
  }
  if (report.score.unknownRetrievedItemRate.numerator === 0) {
    findings.push(
      "- Unknown retrieved item rate is 0.0%, so this run found no manifest mapping gaps.",
    );
  }
  findings.push(
    `- Core channel episode recall is ${formatRateWithCount(report.score.plantedEpisodeRecall)}; legacy raw-score mixed top-K episode behavior is not comparable across memory kinds because fact scores and episode scores use different scales.`,
  );
  findings.push(
    `- Rank-normalized precision@${report.k} is ${formatRateWithCount(report.score.rankNormalizedPrecisionAtK)} and is reported only as cross-type context exposure.`,
  );

  return findings;
}

function formatBudgets(
  report: MemoryRetrievalReport,
  category: MemoryRetrievalCategory,
  kind: "fact" | "episode",
) {
  const budgets = [
    ...new Set(
      report.score.queries
        .filter((query) => query.category === category)
        .map((query) => (kind === "fact" ? query.factBudget : query.episodeBudget)),
    ),
  ].sort((a, b) => a - b);

  return budgets.join(", ") || "-";
}

function recallCapNotes(query: MemoryRetrievalScoredQuery) {
  const notes: string[] = [];

  if (query.expectedFactKeys.length > query.factBudget) {
    notes.push(
      `fact cap ${query.factRecallCeilingNumerator}/${query.factRecallCeilingDenominator}`,
    );
  }
  if (query.expectedEpisodeKeys.length > query.episodeBudget) {
    notes.push(
      `episode cap ${query.episodeRecallCeilingNumerator}/${query.episodeRecallCeilingDenominator}`,
    );
  }

  return notes.length > 0 ? notes.join("; ") : "-";
}

function formatItem(key: string, report: MemoryRetrievalReport) {
  const label = report.itemLabels[key];

  return label ? `${key} (${label})` : key;
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "-";
}

function formatRateWithCount(value: {
  numerator: number;
  denominator: number;
  rate: number;
  wilson95?: { lower: number; upper: number } | null;
}) {
  const interval = value.wilson95
    ? `, Wilson 95% ${formatWilson(value.wilson95)}`
    : "";

  return `${formatRate(value.rate)} (${value.numerator}/${value.denominator}${interval})`;
}

export function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRatioWithWilson(value: {
  numerator: number;
  denominator: number;
}) {
  const rateValue =
    value.denominator === 0 ? 0 : value.numerator / value.denominator;
  const interval = wilsonInterval(value);

  return `${formatRate(rateValue)} (${value.numerator}/${value.denominator}, Wilson 95% ${formatWilson(interval)})`;
}

function formatWilson(
  value: { lower: number; upper: number } | null | undefined,
) {
  if (!value) {
    return "-";
  }

  return `${formatRate(value.lower)}-${formatRate(value.upper)}`;
}

function wilsonInterval(value: {
  numerator: number;
  denominator: number;
}): { lower: number; upper: number } | null {
  if (value.denominator === 0) {
    return null;
  }

  const z = 1.96;
  const denominator = value.denominator;
  const p = value.numerator / denominator;
  const z2 = z * z;
  const adjustedDenominator = 1 + z2 / denominator;
  const center = (p + z2 / (2 * denominator)) / adjustedDenominator;
  const halfWidth =
    (z *
      Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator)) /
    adjustedDenominator;

  return {
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
  };
}

function escapePipe(value: string) {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
