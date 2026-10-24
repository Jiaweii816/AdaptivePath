import type { SeedLearnerManifest } from "../seed-learner/manifest";
import type {
  MemoryCitationCase,
  MemoryCitationDataset,
} from "./memory-citation-dataset";
import type {
  MemoryRetrievalSuiteScore,
} from "./memory-retrieval-metrics";

export const MEMORY_CITATION_SENTINEL = "<<<MEMORY_CITATIONS_JSON>>>";

export type MemoryAblationArmName =
  | "focused_l2_fts"
  | "focused_no_l2_fts"
  | "full_history_l2_eval_only"
  | "full_history_no_l2_eval_only";

export type TokenEstimatorType = "approx_chars_div_4_v1";

export type TokenStats = {
  count: number;
  total: number;
  avg: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
};

export type TokenReduction = {
  baselineArm: MemoryAblationArmName;
  comparisonArm: MemoryAblationArmName;
  absoluteTokens: number;
  percent: number;
};

export type MemoryAblationArmScore = {
  arm: MemoryAblationArmName;
  retrieval: MemoryRetrievalSuiteScore;
  promptTokens: TokenStats;
};

export type DeferredAblationArm = {
  arm: string;
  reason: string;
};

export type CitationRate = {
  numerator: number;
  denominator: number;
  rate: number | null;
  wilson95: {
    lower: number;
    upper: number;
  } | null;
};

export type ParsedCitationBlock =
  | {
      status: "parsed";
      citedFactIds: string[];
      citedEpisodeIds: string[];
      noCitationReason?: string | null;
    }
  | {
      status: "unscorable";
      reason: string;
    };

export type MemoryCitationRunInput = {
  caseId: string;
  outputText?: string;
  allowedFactIds?: string[];
  allowedEpisodeIds?: string[];
};

export type MemoryCitationScoredCase = {
  caseId: string;
  category: string;
  citationRequirement: string;
  parsed: boolean;
  unscorableReason?: string;
  citedFactIds: string[];
  citedEpisodeIds: string[];
  citedFactKeys: string[];
  citedEpisodeKeys: string[];
  hallucinatedCitationIds: string[];
  wrongKindCitationIds: string[];
  unsupportedCitationIds: string[];
  forbiddenFactKeys: string[];
  forbiddenEpisodeKeys: string[];
  matchedExpectedFactKeys: string[];
  matchedExpectedEpisodeKeys: string[];
  missingExpectedFactKeys: string[];
  missingExpectedEpisodeKeys: string[];
  noCitationViolation: boolean;
  overCitation: boolean;
  duplicateCitationCount: number;
};

export type MemoryCitationSuiteScore = {
  caseCount: number;
  scoringStatus: "deterministic_structured_citations" | "unscorable_no_structured_citations";
  structuredCitationCoverage: CitationRate;
  unscorableCaseRate: CitationRate;
  hallucinatedMemoryRate: CitationRate;
  affectedReplyHallucinationRate: CitationRate;
  unsupportedCitationRate: CitationRate;
  forbiddenCitationRate: CitationRate;
  expectedCitationRecall: CitationRate;
  noCitationViolationRate: CitationRate;
  overCitationRate: CitationRate;
  noCitationOrUnscorableCount: number;
  cases: MemoryCitationScoredCase[];
};

export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function summarizeTokenEstimates(values: number[]): TokenStats {
  if (values.length === 0) {
    return {
      count: 0,
      total: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      min: 0,
      max: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);

  return {
    count: sorted.length,
    total,
    avg: total / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function calculateTokenReduction(args: {
  baselineArm: MemoryAblationArmName;
  baselineTokens: TokenStats;
  comparisonArm: MemoryAblationArmName;
  comparisonTokens: TokenStats;
}): TokenReduction {
  const absoluteTokens = args.baselineTokens.avg - args.comparisonTokens.avg;

  return {
    baselineArm: args.baselineArm,
    comparisonArm: args.comparisonArm,
    absoluteTokens,
    percent:
      args.baselineTokens.avg === 0
        ? 0
        : absoluteTokens / args.baselineTokens.avg,
  };
}

export function parseCitationBlock(outputText: string | undefined): ParsedCitationBlock {
  if (!outputText) {
    return {
      status: "unscorable",
      reason: "missing_output",
    };
  }

  const markerIndex = outputText.indexOf(MEMORY_CITATION_SENTINEL);
  if (markerIndex < 0) {
    return {
      status: "unscorable",
      reason: "missing_citation_sentinel",
    };
  }

  const jsonText = outputText
    .slice(markerIndex + MEMORY_CITATION_SENTINEL.length)
    .trim();
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      status: "unscorable",
      reason: "malformed_citation_json",
    };
  }

  if (!isCitationPayload(parsed)) {
    return {
      status: "unscorable",
      reason: "invalid_citation_shape",
    };
  }

  return {
    status: "parsed",
    citedFactIds: parsed.citedFactIds,
    citedEpisodeIds: parsed.citedEpisodeIds,
    noCitationReason: parsed.noCitationReason,
  };
}

export function scoreMemoryCitationSuite(args: {
  dataset: MemoryCitationDataset;
  manifest: SeedLearnerManifest;
  runs: MemoryCitationRunInput[];
}): MemoryCitationSuiteScore {
  const runsByCaseId = new Map(args.runs.map((run) => [run.caseId, run]));
  const manifestLookup = buildCitationManifestLookup(args.manifest);
  const cases = args.dataset.cases.map((item) =>
    scoreMemoryCitationCase({
      item,
      manifestLookup,
      run: runsByCaseId.get(item.caseId),
    }),
  );
  const requiredCases = cases.filter(
    (item) => item.citationRequirement === "required",
  );
  const noneExpectedCases = cases.filter(
    (item) => item.citationRequirement === "none_expected",
  );
  const allCitationCount = cases.reduce(
    (acc, item) => acc + item.citedFactIds.length + item.citedEpisodeIds.length,
    0,
  );
  const hallucinatedCount = cases.reduce(
    (acc, item) => acc + item.hallucinatedCitationIds.length,
    0,
  );
  const forbiddenCount = cases.reduce(
    (acc, item) =>
      acc + item.forbiddenFactKeys.length + item.forbiddenEpisodeKeys.length,
    0,
  );
  const expectedNumerator = cases.reduce(
    (acc, item) =>
      acc +
      item.matchedExpectedFactKeys.length +
      item.matchedExpectedEpisodeKeys.length,
    0,
  );
  const expectedDenominator = args.dataset.cases.reduce(
    (acc, item) =>
      acc + item.expectedFactKeys.length + item.expectedEpisodeKeys.length,
    0,
  );
  const unscorableCount = cases.filter((item) => !item.parsed).length;
  const noCitationViolationCount = requiredCases.filter(
    (item) => item.noCitationViolation,
  ).length;
  const scoringStatus =
    cases.some((item) => item.parsed)
      ? "deterministic_structured_citations"
      : "unscorable_no_structured_citations";

  return {
    caseCount: cases.length,
    scoringStatus,
    structuredCitationCoverage: rate({
      numerator: requiredCases.filter(
        (item) =>
          item.parsed &&
          item.citedFactIds.length + item.citedEpisodeIds.length > 0,
      ).length,
      denominator: requiredCases.length,
    }),
    unscorableCaseRate: rate({
      numerator: unscorableCount,
      denominator: cases.length,
    }),
    hallucinatedMemoryRate: nullableRate({
      numerator: hallucinatedCount,
      denominator: allCitationCount,
    }),
    affectedReplyHallucinationRate: nullableRate({
      numerator: cases.filter((item) => item.hallucinatedCitationIds.length > 0)
        .length,
      denominator: cases.filter((item) => item.parsed).length,
    }),
    unsupportedCitationRate: nullableRate({
      numerator: cases.reduce(
        (acc, item) => acc + item.unsupportedCitationIds.length,
        0,
      ),
      denominator: allCitationCount,
    }),
    forbiddenCitationRate: nullableRate({
      numerator: forbiddenCount,
      denominator: allCitationCount,
    }),
    expectedCitationRecall: rate({
      numerator: expectedNumerator,
      denominator: expectedDenominator,
    }),
    noCitationViolationRate: rate({
      numerator: noCitationViolationCount,
      denominator: requiredCases.length,
    }),
    overCitationRate: rate({
      numerator: noneExpectedCases.filter((item) => item.overCitation).length,
      denominator: noneExpectedCases.length,
    }),
    noCitationOrUnscorableCount:
      unscorableCount + noCitationViolationCount,
    cases,
  };
}

export function scoreMemoryCitationCase(args: {
  item: MemoryCitationCase;
  manifestLookup: CitationManifestLookup;
  run?: MemoryCitationRunInput;
}): MemoryCitationScoredCase {
  const parsed = parseCitationBlock(args.run?.outputText);
  if (parsed.status === "unscorable") {
    return {
      caseId: args.item.caseId,
      category: args.item.category,
      citationRequirement: args.item.citationRequirement,
      parsed: false,
      unscorableReason: parsed.reason,
      citedFactIds: [],
      citedEpisodeIds: [],
      citedFactKeys: [],
      citedEpisodeKeys: [],
      hallucinatedCitationIds: [],
      wrongKindCitationIds: [],
      unsupportedCitationIds: [],
      forbiddenFactKeys: [],
      forbiddenEpisodeKeys: [],
      matchedExpectedFactKeys: [],
      matchedExpectedEpisodeKeys: [],
      missingExpectedFactKeys: args.item.expectedFactKeys,
      missingExpectedEpisodeKeys: args.item.expectedEpisodeKeys,
      noCitationViolation: false,
      overCitation: false,
      duplicateCitationCount: 0,
    };
  }

  const dedupedFacts = dedupeWithCount(parsed.citedFactIds);
  const dedupedEpisodes = dedupeWithCount(parsed.citedEpisodeIds);
  const allowedFactIds = new Set(args.run?.allowedFactIds ?? []);
  const allowedEpisodeIds = new Set(args.run?.allowedEpisodeIds ?? []);
  const enforceAllowedFactIds = args.run?.allowedFactIds !== undefined;
  const enforceAllowedEpisodeIds = args.run?.allowedEpisodeIds !== undefined;
  const factKeys: string[] = [];
  const episodeKeys: string[] = [];
  const hallucinatedCitationIds: string[] = [];
  const wrongKindCitationIds: string[] = [];
  const unsupportedCitationIds: string[] = [];

  for (const id of dedupedFacts.values) {
    const key = args.manifestLookup.factKeyById.get(id);
    if (key) {
      factKeys.push(key);
      if (enforceAllowedFactIds && !allowedFactIds.has(id)) {
        unsupportedCitationIds.push(id);
      }
      continue;
    }
    if (args.manifestLookup.episodeKeyById.has(id)) {
      wrongKindCitationIds.push(id);
      continue;
    }
    hallucinatedCitationIds.push(id);
  }

  for (const id of dedupedEpisodes.values) {
    const key = args.manifestLookup.episodeKeyById.get(id);
    if (key) {
      episodeKeys.push(key);
      if (enforceAllowedEpisodeIds && !allowedEpisodeIds.has(id)) {
        unsupportedCitationIds.push(id);
      }
      continue;
    }
    if (args.manifestLookup.factKeyById.has(id)) {
      wrongKindCitationIds.push(id);
      continue;
    }
    hallucinatedCitationIds.push(id);
  }

  const expectedFactKeys = new Set(args.item.expectedFactKeys);
  const expectedEpisodeKeys = new Set(args.item.expectedEpisodeKeys);
  const forbiddenFactKeys = new Set(args.item.forbiddenFactKeys);
  const forbiddenEpisodeKeys = new Set(args.item.forbiddenEpisodeKeys);
  const matchedExpectedFactKeys = args.item.expectedFactKeys.filter((key) =>
    factKeys.includes(key),
  );
  const matchedExpectedEpisodeKeys = args.item.expectedEpisodeKeys.filter((key) =>
    episodeKeys.includes(key),
  );
  const surfacedForbiddenFactKeys = factKeys.filter((key) =>
    forbiddenFactKeys.has(key),
  );
  const surfacedForbiddenEpisodeKeys = episodeKeys.filter((key) =>
    forbiddenEpisodeKeys.has(key),
  );
  const citationCount = factKeys.length + episodeKeys.length + hallucinatedCitationIds.length;
  const noCitationViolation =
    args.item.citationRequirement === "required" && citationCount === 0;
  const overCitation =
    args.item.citationRequirement === "none_expected" && citationCount > 0;

  return {
    caseId: args.item.caseId,
    category: args.item.category,
    citationRequirement: args.item.citationRequirement,
    parsed: true,
    citedFactIds: dedupedFacts.values,
    citedEpisodeIds: dedupedEpisodes.values,
    citedFactKeys: factKeys,
    citedEpisodeKeys: episodeKeys,
    hallucinatedCitationIds,
    wrongKindCitationIds,
    unsupportedCitationIds,
    forbiddenFactKeys: surfacedForbiddenFactKeys,
    forbiddenEpisodeKeys: surfacedForbiddenEpisodeKeys,
    matchedExpectedFactKeys,
    matchedExpectedEpisodeKeys,
    missingExpectedFactKeys: args.item.expectedFactKeys.filter(
      (key) => !expectedFactKeys.has(key) || !factKeys.includes(key),
    ),
    missingExpectedEpisodeKeys: args.item.expectedEpisodeKeys.filter(
      (key) => !expectedEpisodeKeys.has(key) || !episodeKeys.includes(key),
    ),
    noCitationViolation,
    overCitation,
    duplicateCitationCount: dedupedFacts.duplicateCount + dedupedEpisodes.duplicateCount,
  };
}

export function buildCitationOutput(payload: {
  citedFactIds?: string[];
  citedEpisodeIds?: string[];
  noCitationReason?: string | null;
}) {
  return [
    "Assistant reply omitted in unit fixture.",
    MEMORY_CITATION_SENTINEL,
    JSON.stringify({
      citedFactIds: payload.citedFactIds ?? [],
      citedEpisodeIds: payload.citedEpisodeIds ?? [],
      noCitationReason: payload.noCitationReason ?? null,
    }),
  ].join("\n");
}

export function summarizeArmScores(
  armScores: MemoryAblationArmScore[],
): Record<MemoryAblationArmName, MemoryAblationArmScore> {
  return Object.fromEntries(
    armScores.map((score) => [score.arm, score]),
  ) as Record<MemoryAblationArmName, MemoryAblationArmScore>;
}

type CitationManifestLookup = {
  factKeyById: Map<string, string>;
  episodeKeyById: Map<string, string>;
};

function buildCitationManifestLookup(
  manifest: SeedLearnerManifest,
): CitationManifestLookup {
  return {
    factKeyById: new Map(
      manifest.facts.map((fact) => [fact.factId, fact.scenarioFactKey]),
    ),
    episodeKeyById: new Map(
      manifest.episodes.map((episode) => [
        episode.episodeId,
        episode.scenarioEpisodeKey,
      ]),
    ),
  };
}

function isCitationPayload(value: unknown): value is {
  citedFactIds: string[];
  citedEpisodeIds: string[];
  noCitationReason?: string | null;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as {
    citedFactIds?: unknown;
    citedEpisodeIds?: unknown;
    noCitationReason?: unknown;
  };

  return (
    Array.isArray(payload.citedFactIds) &&
    payload.citedFactIds.every((item) => typeof item === "string") &&
    Array.isArray(payload.citedEpisodeIds) &&
    payload.citedEpisodeIds.every((item) => typeof item === "string") &&
    (payload.noCitationReason === undefined ||
      payload.noCitationReason === null ||
      typeof payload.noCitationReason === "string")
  );
}

function dedupeWithCount(values: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  let duplicateCount = 0;

  for (const value of values) {
    if (seen.has(value)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }

  return { values: deduped, duplicateCount };
}

function percentile(sortedValues: number[], percentileValue: number) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );

  return sortedValues[index];
}

function rate(value: { numerator: number; denominator: number }): CitationRate {
  return {
    ...value,
    rate: value.denominator === 0 ? 0 : value.numerator / value.denominator,
    wilson95: wilsonInterval(value),
  };
}

function nullableRate(value: {
  numerator: number;
  denominator: number;
}): CitationRate {
  return {
    ...value,
    rate: value.denominator === 0 ? null : value.numerator / value.denominator,
    wilson95: wilsonInterval(value),
  };
}

function wilsonInterval(value: {
  numerator: number;
  denominator: number;
}): CitationRate["wilson95"] {
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
