import type { SeedLearnerManifest } from "../seed-learner/manifest";
import { resolveRetrievalProfile } from "@/server/memory/retrieval/profiles";
import type {
  MemoryRetrievalCase,
  MemoryRetrievalCategory,
} from "./memory-retrieval-dataset";

const RRF_K = 60;

export type RetrievedMemoryItem = {
  kind: "fact" | "episode";
  id: string;
  key?: string;
  score?: number;
  rankNormalizedScore?: number;
  label: string;
  unknown: boolean;
};

export type MemoryManifestLookup = {
  factKeyById: Map<string, string>;
  episodeKeyById: Map<string, string>;
  factByKey: Map<string, SeedLearnerManifest["facts"][number]>;
  episodeByKey: Map<string, SeedLearnerManifest["episodes"][number]>;
};

export type MemoryRetrievalScoredQuery = {
  queryId: string;
  category: MemoryRetrievalCategory;
  k: number;
  factBudget: number;
  episodeBudget: number;
  expectedFactKeys: string[];
  expectedEpisodeKeys: string[];
  expectedProfilePreferenceMarkers: string[];
  forbiddenFactKeys: string[];
  forbiddenEpisodeKeys: string[];
  neutralFactKeys: string[];
  neutralEpisodeKeys: string[];
  retrieved: RetrievedMemoryItem[];
  injectedItems: RetrievedMemoryItem[];
  injectedForbiddenKeys: string[];
  injectedCount: number;
  hasInjectedMemory: boolean;
  retrievedTopK: RetrievedMemoryItem[];
  retrievedFacts: RetrievedMemoryItem[];
  retrievedEpisodes: RetrievedMemoryItem[];
  rankNormalizedTopK: RetrievedMemoryItem[];
  matchedExpectedFactKeys: string[];
  matchedExpectedEpisodeKeys: string[];
  legacyMatchedExpectedFactKeys: string[];
  legacyMatchedExpectedEpisodeKeys: string[];
  rankNormalizedMatchedExpectedFactKeys: string[];
  rankNormalizedMatchedExpectedEpisodeKeys: string[];
  matchedProfilePreferenceMarkers: string[];
  missingExpectedFactKeys: string[];
  missingExpectedEpisodeKeys: string[];
  legacyMissingExpectedFactKeys: string[];
  legacyMissingExpectedEpisodeKeys: string[];
  rankNormalizedMissingExpectedFactKeys: string[];
  rankNormalizedMissingExpectedEpisodeKeys: string[];
  missingProfilePreferenceMarkers: string[];
  surfacedForbiddenFactKeys: string[];
  surfacedForbiddenEpisodeKeys: string[];
  legacySurfacedForbiddenFactKeys: string[];
  legacySurfacedForbiddenEpisodeKeys: string[];
  rankNormalizedSurfacedForbiddenFactKeys: string[];
  rankNormalizedSurfacedForbiddenEpisodeKeys: string[];
  surfacedNeutralFactKeys: string[];
  surfacedNeutralEpisodeKeys: string[];
  legacySurfacedNeutralFactKeys: string[];
  legacySurfacedNeutralEpisodeKeys: string[];
  rankNormalizedSurfacedNeutralFactKeys: string[];
  rankNormalizedSurfacedNeutralEpisodeKeys: string[];
  unknownRetrievedItems: RetrievedMemoryItem[];
  unknownFactItems: RetrievedMemoryItem[];
  unknownEpisodeItems: RetrievedMemoryItem[];
  precisionAtK: number;
  relevantAtK: number;
  rankNormalizedPrecisionAtK: number;
  rankNormalizedRelevantAtK: number;
  retrievedItemPrecisionNumerator: number;
  retrievedItemPrecisionDenominator: number;
  rankNormalizedPrecisionCeilingNumerator: number;
  rankNormalizedPrecisionCeilingDenominator: number;
  precisionCeilingNumerator: number;
  precisionCeilingDenominator: number;
  staleHitsAtK: number;
  rankNormalizedStaleHitsAtK: number;
  affectedByForbidden: boolean;
  rankNormalizedAffectedByForbidden: boolean;
  factRecallNumerator: number;
  factRecallDenominator: number;
  episodeRecallNumerator: number;
  episodeRecallDenominator: number;
  factRecallCeilingNumerator: number;
  factRecallCeilingDenominator: number;
  episodeRecallCeilingNumerator: number;
  episodeRecallCeilingDenominator: number;
  factPrecisionNumerator: number;
  factPrecisionDenominator: number;
  episodePrecisionNumerator: number;
  episodePrecisionDenominator: number;
  factForbiddenSurfacingNumerator: number;
  factForbiddenSurfacingDenominator: number;
  episodeForbiddenSurfacingNumerator: number;
  episodeForbiddenSurfacingDenominator: number;
  preferenceMarkerRecallNumerator: number;
  preferenceMarkerRecallDenominator: number;
};

export type MemoryRetrievalRate = {
  numerator: number;
  denominator: number;
  rate: number;
  wilson95: {
    lower: number;
    upper: number;
  } | null;
};

export type MemoryRetrievalCategoryScore = {
  category: MemoryRetrievalCategory;
  queryCount: number;
  precisionAtK: MemoryRetrievalRate;
  precisionCeiling: MemoryRetrievalRate;
  ceilingNormalizedPrecisionAtK: MemoryRetrievalRate;
  retrievedItemPrecision: MemoryRetrievalRate;
  rankNormalizedPrecisionAtK: MemoryRetrievalRate;
  rankNormalizedPrecisionCeiling: MemoryRetrievalRate;
  rankNormalizedCeilingNormalizedPrecisionAtK: MemoryRetrievalRate;
  plantedFactRecall: MemoryRetrievalRate;
  plantedEpisodeRecall: MemoryRetrievalRate;
  factRecallCeiling: MemoryRetrievalRate;
  episodeRecallCeiling: MemoryRetrievalRate;
  factPrecision: MemoryRetrievalRate;
  episodePrecision: MemoryRetrievalRate;
  factForbiddenSurfacing: MemoryRetrievalRate;
  episodeForbiddenSurfacing: MemoryRetrievalRate;
  preferenceMarkerRecall: MemoryRetrievalRate;
  staleSurfacing: MemoryRetrievalRate;
  rankNormalizedStaleSurfacing: MemoryRetrievalRate;
  affectedQueryRate: MemoryRetrievalRate;
  rankNormalizedAffectedQueryRate: MemoryRetrievalRate;
  unknownRetrievedItemRate: MemoryRetrievalRate;
  unknownFactItemRate: MemoryRetrievalRate;
  unknownEpisodeItemRate: MemoryRetrievalRate;
  injectedPrecision: MemoryRetrievalRate;
  irrelevantInjectionRate: MemoryRetrievalRate;
  noMemoryRate: MemoryRetrievalRate;
};

export type MemoryRetrievalSuiteScore = {
  queryCount: number;
  k: number;
  precisionAtK: MemoryRetrievalRate;
  precisionCeiling: MemoryRetrievalRate;
  ceilingNormalizedPrecisionAtK: MemoryRetrievalRate;
  retrievedItemPrecision: MemoryRetrievalRate;
  rankNormalizedPrecisionAtK: MemoryRetrievalRate;
  rankNormalizedPrecisionCeiling: MemoryRetrievalRate;
  rankNormalizedCeilingNormalizedPrecisionAtK: MemoryRetrievalRate;
  plantedFactRecall: MemoryRetrievalRate;
  plantedEpisodeRecall: MemoryRetrievalRate;
  factRecallCeiling: MemoryRetrievalRate;
  episodeRecallCeiling: MemoryRetrievalRate;
  factPrecision: MemoryRetrievalRate;
  episodePrecision: MemoryRetrievalRate;
  factForbiddenSurfacing: MemoryRetrievalRate;
  episodeForbiddenSurfacing: MemoryRetrievalRate;
  preferenceMarkerRecall: MemoryRetrievalRate;
  staleSurfacing: MemoryRetrievalRate;
  rankNormalizedStaleSurfacing: MemoryRetrievalRate;
  affectedQueryRate: MemoryRetrievalRate;
  rankNormalizedAffectedQueryRate: MemoryRetrievalRate;
  unknownRetrievedItemRate: MemoryRetrievalRate;
  unknownFactItemRate: MemoryRetrievalRate;
  unknownEpisodeItemRate: MemoryRetrievalRate;
  injectedPrecision: MemoryRetrievalRate;
  irrelevantInjectionRate: MemoryRetrievalRate;
  noMemoryRate: MemoryRetrievalRate;
  noExpectedFactQueryIds: string[];
  perCategory: MemoryRetrievalCategoryScore[];
  queries: MemoryRetrievalScoredQuery[];
};

export function buildMemoryManifestLookup(
  manifest: SeedLearnerManifest,
): MemoryManifestLookup {
  return {
    factKeyById: new Map(manifest.facts.map((fact) => [fact.factId, fact.scenarioFactKey])),
    episodeKeyById: new Map(
      manifest.episodes.map((episode) => [
        episode.episodeId,
        episode.scenarioEpisodeKey,
      ]),
    ),
    factByKey: new Map(manifest.facts.map((fact) => [fact.scenarioFactKey, fact])),
    episodeByKey: new Map(
      manifest.episodes.map((episode) => [
        episode.scenarioEpisodeKey,
        episode,
      ]),
    ),
  };
}

export function mapRetrievedItemsToManifest(
  args: {
    lookup: MemoryManifestLookup;
    facts: Array<{ id: string; tag: string; score?: number }>;
    episodes: Array<{ id: string; title: string; score?: number }>;
  },
): RetrievedMemoryItem[] {
  const items: RetrievedMemoryItem[] = [];

  for (const fact of args.facts) {
    const key = args.lookup.factKeyById.get(fact.id);
    items.push({
      kind: "fact",
      id: fact.id,
      key,
      score: fact.score,
      label: fact.tag,
      unknown: !key,
    });
  }

  for (const episode of args.episodes) {
    const key = args.lookup.episodeKeyById.get(episode.id);
    items.push({
      kind: "episode",
      id: episode.id,
      key,
      score: episode.score,
      label: episode.title,
      unknown: !key,
    });
  }

  return dedupeRetrievedItems(items).sort((a, b) => {
    const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    if (a.kind !== b.kind) {
      return a.kind === "fact" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

export function scoreMemoryRetrievalSuite(args: {
  cases: MemoryRetrievalCase[];
  runs: Array<{
    queryId: string;
    retrieved: RetrievedMemoryItem[];
    injected?: RetrievedMemoryItem[];
    profilePreferenceMarkersMatched?: string[];
  }>;
  defaultK: number;
}): MemoryRetrievalSuiteScore {
  const runsByQueryId = new Map(args.runs.map((run) => [run.queryId, run]));
  const queries = args.cases.map((query) =>
    scoreMemoryRetrievalQuery({
      query,
      retrieved: runsByQueryId.get(query.queryId)?.retrieved ?? [],
      injected: runsByQueryId.get(query.queryId)?.injected ?? [],
      profilePreferenceMarkersMatched:
        runsByQueryId.get(query.queryId)?.profilePreferenceMarkersMatched ?? [],
      defaultK: args.defaultK,
    }),
  );

  return {
    queryCount: queries.length,
    k: args.defaultK,
    precisionAtK: sumRate(
      queries.map((query) => ({
        numerator: query.relevantAtK,
        denominator: query.k,
      })),
    ),
    precisionCeiling: sumRate(
      queries.map((query) => ({
        numerator: query.precisionCeilingNumerator,
        denominator: query.precisionCeilingDenominator,
      })),
    ),
    ceilingNormalizedPrecisionAtK: sumRate(
      queries.map((query) => ({
        numerator: query.relevantAtK,
        denominator: query.precisionCeilingNumerator,
      })),
    ),
    retrievedItemPrecision: sumRate(
      queries.map((query) => ({
        numerator: query.retrievedItemPrecisionNumerator,
        denominator: query.retrievedItemPrecisionDenominator,
      })),
    ),
    rankNormalizedPrecisionAtK: sumRate(
      queries.map((query) => ({
        numerator: query.rankNormalizedRelevantAtK,
        denominator: query.k,
      })),
    ),
    rankNormalizedPrecisionCeiling: sumRate(
      queries.map((query) => ({
        numerator: query.rankNormalizedPrecisionCeilingNumerator,
        denominator: query.rankNormalizedPrecisionCeilingDenominator,
      })),
    ),
    rankNormalizedCeilingNormalizedPrecisionAtK: sumRate(
      queries.map((query) => ({
        numerator: query.rankNormalizedRelevantAtK,
        denominator: query.rankNormalizedPrecisionCeilingNumerator,
      })),
    ),
    plantedFactRecall: sumRate(
      queries.map((query) => ({
        numerator: query.factRecallNumerator,
        denominator: query.factRecallDenominator,
      })),
    ),
    plantedEpisodeRecall: sumRate(
      queries.map((query) => ({
        numerator: query.episodeRecallNumerator,
        denominator: query.episodeRecallDenominator,
      })),
    ),
    factRecallCeiling: sumRate(
      queries.map((query) => ({
        numerator: query.factRecallCeilingNumerator,
        denominator: query.factRecallCeilingDenominator,
      })),
    ),
    episodeRecallCeiling: sumRate(
      queries.map((query) => ({
        numerator: query.episodeRecallCeilingNumerator,
        denominator: query.episodeRecallCeilingDenominator,
      })),
    ),
    factPrecision: sumRate(
      queries.map((query) => ({
        numerator: query.factPrecisionNumerator,
        denominator: query.factPrecisionDenominator,
      })),
    ),
    episodePrecision: sumRate(
      queries.map((query) => ({
        numerator: query.episodePrecisionNumerator,
        denominator: query.episodePrecisionDenominator,
      })),
    ),
    factForbiddenSurfacing: sumRate(
      queries
        .filter((query) => query.forbiddenFactKeys.length > 0)
        .map((query) => ({
          numerator: query.factForbiddenSurfacingNumerator,
          denominator: query.factForbiddenSurfacingDenominator,
        })),
    ),
    episodeForbiddenSurfacing: sumRate(
      queries
        .filter((query) => query.forbiddenEpisodeKeys.length > 0)
        .map((query) => ({
          numerator: query.episodeForbiddenSurfacingNumerator,
          denominator: query.episodeForbiddenSurfacingDenominator,
        })),
    ),
    preferenceMarkerRecall: sumRate(
      queries.map((query) => ({
        numerator: query.preferenceMarkerRecallNumerator,
        denominator: query.preferenceMarkerRecallDenominator,
      })),
    ),
    staleSurfacing: sumRate(
      queries
        .filter(hasForbiddenKeys)
        .map((query) => ({
          numerator: query.staleHitsAtK,
          denominator: query.k,
        })),
    ),
    rankNormalizedStaleSurfacing: sumRate(
      queries
        .filter(hasForbiddenKeys)
        .map((query) => ({
          numerator: query.rankNormalizedStaleHitsAtK,
          denominator: query.k,
        })),
    ),
    affectedQueryRate: rate({
      numerator: queries.filter(
        (query) => hasForbiddenKeys(query) && query.affectedByForbidden,
      ).length,
      denominator: queries.filter(hasForbiddenKeys).length,
    }),
    rankNormalizedAffectedQueryRate: rate({
      numerator: queries.filter(
        (query) => hasForbiddenKeys(query) && query.rankNormalizedAffectedByForbidden,
      ).length,
      denominator: queries.filter(hasForbiddenKeys).length,
    }),
    unknownRetrievedItemRate: sumRate(
      queries.map((query) => ({
        numerator: query.unknownRetrievedItems.length,
        denominator: query.retrievedTopK.length,
      })),
    ),
    unknownFactItemRate: sumRate(
      queries.map((query) => ({
        numerator: query.unknownFactItems.length,
        denominator: query.retrievedFacts.length,
      })),
    ),
    unknownEpisodeItemRate: sumRate(
      queries.map((query) => ({
        numerator: query.unknownEpisodeItems.length,
        denominator: query.retrievedEpisodes.length,
      })),
    ),
    injectedPrecision: sumRate(
      queries.map((query) => ({
        numerator: query.injectedCount - query.injectedForbiddenKeys.length,
        denominator: query.injectedCount,
      })),
    ),
    irrelevantInjectionRate: sumRate(
      queries.map((query) => ({
        numerator: query.injectedForbiddenKeys.length,
        denominator: query.injectedCount,
      })),
    ),
    noMemoryRate: rate({
      numerator: queries.filter((query) => !query.hasInjectedMemory).length,
      denominator: queries.length,
    }),
    noExpectedFactQueryIds: queries
      .filter((query) => query.expectedFactKeys.length === 0)
      .map((query) => query.queryId),
    perCategory: scoreByCategory(queries),
    queries,
  };
}

export function scoreMemoryRetrievalQuery(args: {
  query: MemoryRetrievalCase;
  retrieved: RetrievedMemoryItem[];
  injected?: RetrievedMemoryItem[];
  profilePreferenceMarkersMatched?: string[];
  defaultK: number;
}): MemoryRetrievalScoredQuery {
  const k = args.query.k ?? args.defaultK;
  const injectedItems = dedupeRetrievedItems(args.injected ?? []);
  const retrievedTopK = dedupeRetrievedItems(args.retrieved).slice(0, k);
  const retrievalProfile = resolveRetrievalProfile(args.query.entry);
  const factBudget = retrievalProfile.budgets.facts;
  const episodeBudget = retrievalProfile.budgets.episodes;
  const retrievedFacts = dedupeRetrievedItems(
    args.retrieved.filter((item) => item.kind === "fact"),
  );
  const retrievedEpisodes = dedupeRetrievedItems(
    args.retrieved.filter((item) => item.kind === "episode"),
  );
  const rankNormalizedTopK = buildRankNormalizedTopK({
    facts: retrievedFacts,
    episodes: retrievedEpisodes,
    k,
  });
  const expectedFactKeys = new Set(args.query.expectedFactKeys);
  const expectedEpisodeKeys = new Set(args.query.expectedEpisodeKeys);
  const forbiddenFactKeys = new Set(args.query.forbiddenFactKeys);
  const forbiddenEpisodeKeys = new Set(args.query.forbiddenEpisodeKeys);
  const retrievedFactKeys = new Set(
    retrievedFacts
      .filter((item) => item.key)
      .map((item) => item.key as string),
  );
  const retrievedEpisodeKeys = new Set(
    retrievedEpisodes
      .filter((item) => item.key)
      .map((item) => item.key as string),
  );
  const legacyRetrievedFactKeys = new Set(
    retrievedTopK
      .filter((item) => item.kind === "fact" && item.key)
      .map((item) => item.key as string),
  );
  const legacyRetrievedEpisodeKeys = new Set(
    retrievedTopK
      .filter((item) => item.kind === "episode" && item.key)
      .map((item) => item.key as string),
  );
  const rankNormalizedRetrievedFactKeys = new Set(
    rankNormalizedTopK
      .filter((item) => item.kind === "fact" && item.key)
      .map((item) => item.key as string),
  );
  const rankNormalizedRetrievedEpisodeKeys = new Set(
    rankNormalizedTopK
      .filter((item) => item.kind === "episode" && item.key)
      .map((item) => item.key as string),
  );
  const matchedExpectedFactKeys = args.query.expectedFactKeys.filter((key) =>
    retrievedFactKeys.has(key),
  );
  const matchedExpectedEpisodeKeys = args.query.expectedEpisodeKeys.filter((key) =>
    retrievedEpisodeKeys.has(key),
  );
  const legacyMatchedExpectedFactKeys = args.query.expectedFactKeys.filter((key) =>
    legacyRetrievedFactKeys.has(key),
  );
  const legacyMatchedExpectedEpisodeKeys = args.query.expectedEpisodeKeys.filter(
    (key) => legacyRetrievedEpisodeKeys.has(key),
  );
  const rankNormalizedMatchedExpectedFactKeys = args.query.expectedFactKeys.filter(
    (key) => rankNormalizedRetrievedFactKeys.has(key),
  );
  const rankNormalizedMatchedExpectedEpisodeKeys =
    args.query.expectedEpisodeKeys.filter((key) =>
      rankNormalizedRetrievedEpisodeKeys.has(key),
    );
  const surfacedForbiddenFactKeys = args.query.forbiddenFactKeys.filter((key) =>
    retrievedFactKeys.has(key),
  );
  const surfacedForbiddenEpisodeKeys = args.query.forbiddenEpisodeKeys.filter((key) =>
    retrievedEpisodeKeys.has(key),
  );
  const legacySurfacedForbiddenFactKeys = args.query.forbiddenFactKeys.filter((key) =>
    legacyRetrievedFactKeys.has(key),
  );
  const legacySurfacedForbiddenEpisodeKeys = args.query.forbiddenEpisodeKeys.filter(
    (key) => legacyRetrievedEpisodeKeys.has(key),
  );
  const rankNormalizedSurfacedForbiddenFactKeys =
    args.query.forbiddenFactKeys.filter((key) =>
      rankNormalizedRetrievedFactKeys.has(key),
    );
  const rankNormalizedSurfacedForbiddenEpisodeKeys =
    args.query.forbiddenEpisodeKeys.filter((key) =>
      rankNormalizedRetrievedEpisodeKeys.has(key),
    );
  const surfacedNeutralFactKeys = args.query.neutralFactKeys.filter((key) =>
    retrievedFactKeys.has(key),
  );
  const surfacedNeutralEpisodeKeys = args.query.neutralEpisodeKeys.filter((key) =>
    retrievedEpisodeKeys.has(key),
  );
  const legacySurfacedNeutralFactKeys = args.query.neutralFactKeys.filter((key) =>
    legacyRetrievedFactKeys.has(key),
  );
  const legacySurfacedNeutralEpisodeKeys = args.query.neutralEpisodeKeys.filter(
    (key) => legacyRetrievedEpisodeKeys.has(key),
  );
  const rankNormalizedSurfacedNeutralFactKeys = args.query.neutralFactKeys.filter(
    (key) => rankNormalizedRetrievedFactKeys.has(key),
  );
  const rankNormalizedSurfacedNeutralEpisodeKeys =
    args.query.neutralEpisodeKeys.filter((key) =>
      rankNormalizedRetrievedEpisodeKeys.has(key),
    );
  const injectedForbiddenKeys = resolveInjectedForbiddenKeys({
    injectedItems,
    forbiddenFactKeys,
    forbiddenEpisodeKeys,
  });
  const relevantAtK = retrievedTopK.filter(
    (item) =>
      (item.kind === "fact" && item.key && expectedFactKeys.has(item.key)) ||
      (item.kind === "episode" &&
        item.key &&
        expectedEpisodeKeys.has(item.key)),
  ).length;
  const rankNormalizedRelevantAtK = rankNormalizedTopK.filter(
    (item) =>
      (item.kind === "fact" && item.key && expectedFactKeys.has(item.key)) ||
      (item.kind === "episode" &&
        item.key &&
        expectedEpisodeKeys.has(item.key)),
  ).length;
  const staleHitsAtK = retrievedTopK.filter(
    (item) =>
      (item.kind === "fact" && item.key && forbiddenFactKeys.has(item.key)) ||
      (item.kind === "episode" &&
        item.key &&
        forbiddenEpisodeKeys.has(item.key)),
  ).length;
  const rankNormalizedStaleHitsAtK = rankNormalizedTopK.filter(
    (item) =>
      (item.kind === "fact" && item.key && forbiddenFactKeys.has(item.key)) ||
      (item.kind === "episode" &&
        item.key &&
        forbiddenEpisodeKeys.has(item.key)),
  ).length;
  const expectedPositiveCount =
    args.query.expectedFactKeys.length + args.query.expectedEpisodeKeys.length;
  const matchedProfilePreferenceMarkers =
    args.query.expectedProfilePreferenceMarkers.filter((marker) =>
      (args.profilePreferenceMarkersMatched ?? []).some(
        (matched) => matched.toLowerCase() === marker.toLowerCase(),
      ),
    );

  return {
    queryId: args.query.queryId,
    category: args.query.category,
    k,
    factBudget,
    episodeBudget,
    expectedFactKeys: args.query.expectedFactKeys,
    expectedEpisodeKeys: args.query.expectedEpisodeKeys,
    expectedProfilePreferenceMarkers: args.query.expectedProfilePreferenceMarkers,
    forbiddenFactKeys: args.query.forbiddenFactKeys,
    forbiddenEpisodeKeys: args.query.forbiddenEpisodeKeys,
    neutralFactKeys: args.query.neutralFactKeys,
    neutralEpisodeKeys: args.query.neutralEpisodeKeys,
    retrieved: args.retrieved,
    injectedItems,
    injectedForbiddenKeys,
    injectedCount: injectedItems.length,
    hasInjectedMemory: injectedItems.length > 0,
    retrievedTopK,
    retrievedFacts,
    retrievedEpisodes,
    rankNormalizedTopK,
    matchedExpectedFactKeys,
    matchedExpectedEpisodeKeys,
    legacyMatchedExpectedFactKeys,
    legacyMatchedExpectedEpisodeKeys,
    rankNormalizedMatchedExpectedFactKeys,
    rankNormalizedMatchedExpectedEpisodeKeys,
    matchedProfilePreferenceMarkers,
    missingExpectedFactKeys: args.query.expectedFactKeys.filter(
      (key) => !retrievedFactKeys.has(key),
    ),
    missingExpectedEpisodeKeys: args.query.expectedEpisodeKeys.filter(
      (key) => !retrievedEpisodeKeys.has(key),
    ),
    legacyMissingExpectedFactKeys: args.query.expectedFactKeys.filter(
      (key) => !legacyRetrievedFactKeys.has(key),
    ),
    legacyMissingExpectedEpisodeKeys: args.query.expectedEpisodeKeys.filter(
      (key) => !legacyRetrievedEpisodeKeys.has(key),
    ),
    rankNormalizedMissingExpectedFactKeys: args.query.expectedFactKeys.filter(
      (key) => !rankNormalizedRetrievedFactKeys.has(key),
    ),
    rankNormalizedMissingExpectedEpisodeKeys:
      args.query.expectedEpisodeKeys.filter(
        (key) => !rankNormalizedRetrievedEpisodeKeys.has(key),
      ),
    missingProfilePreferenceMarkers:
      args.query.expectedProfilePreferenceMarkers.filter(
        (marker) => !matchedProfilePreferenceMarkers.includes(marker),
      ),
    surfacedForbiddenFactKeys,
    surfacedForbiddenEpisodeKeys,
    legacySurfacedForbiddenFactKeys,
    legacySurfacedForbiddenEpisodeKeys,
    rankNormalizedSurfacedForbiddenFactKeys,
    rankNormalizedSurfacedForbiddenEpisodeKeys,
    surfacedNeutralFactKeys,
    surfacedNeutralEpisodeKeys,
    legacySurfacedNeutralFactKeys,
    legacySurfacedNeutralEpisodeKeys,
    rankNormalizedSurfacedNeutralFactKeys,
    rankNormalizedSurfacedNeutralEpisodeKeys,
    unknownRetrievedItems: retrievedTopK.filter((item) => item.unknown),
    unknownFactItems: retrievedFacts.filter((item) => item.unknown),
    unknownEpisodeItems: retrievedEpisodes.filter((item) => item.unknown),
    precisionAtK: relevantAtK / k,
    relevantAtK,
    rankNormalizedPrecisionAtK: rankNormalizedRelevantAtK / k,
    rankNormalizedRelevantAtK,
    retrievedItemPrecisionNumerator: relevantAtK,
    retrievedItemPrecisionDenominator: retrievedTopK.length,
    rankNormalizedPrecisionCeilingNumerator: Math.min(expectedPositiveCount, k),
    rankNormalizedPrecisionCeilingDenominator: k,
    precisionCeilingNumerator: Math.min(expectedPositiveCount, k),
    precisionCeilingDenominator: k,
    staleHitsAtK,
    rankNormalizedStaleHitsAtK,
    affectedByForbidden:
      legacySurfacedForbiddenFactKeys.length > 0 ||
      legacySurfacedForbiddenEpisodeKeys.length > 0,
    rankNormalizedAffectedByForbidden:
      rankNormalizedSurfacedForbiddenFactKeys.length > 0 ||
      rankNormalizedSurfacedForbiddenEpisodeKeys.length > 0,
    factRecallNumerator: matchedExpectedFactKeys.length,
    factRecallDenominator: args.query.expectedFactKeys.length,
    episodeRecallNumerator: matchedExpectedEpisodeKeys.length,
    episodeRecallDenominator: args.query.expectedEpisodeKeys.length,
    factRecallCeilingNumerator: Math.min(
      args.query.expectedFactKeys.length,
      factBudget,
    ),
    factRecallCeilingDenominator: args.query.expectedFactKeys.length,
    episodeRecallCeilingNumerator: Math.min(
      args.query.expectedEpisodeKeys.length,
      episodeBudget,
    ),
    episodeRecallCeilingDenominator: args.query.expectedEpisodeKeys.length,
    factPrecisionNumerator: retrievedFacts.filter(
      (item) => item.key && expectedFactKeys.has(item.key),
    ).length,
    factPrecisionDenominator: retrievedFacts.length,
    episodePrecisionNumerator: retrievedEpisodes.filter(
      (item) => item.key && expectedEpisodeKeys.has(item.key),
    ).length,
    episodePrecisionDenominator: retrievedEpisodes.length,
    factForbiddenSurfacingNumerator: surfacedForbiddenFactKeys.length,
    factForbiddenSurfacingDenominator: retrievedFacts.length,
    episodeForbiddenSurfacingNumerator: surfacedForbiddenEpisodeKeys.length,
    episodeForbiddenSurfacingDenominator: retrievedEpisodes.length,
    preferenceMarkerRecallNumerator: matchedProfilePreferenceMarkers.length,
    preferenceMarkerRecallDenominator:
      args.query.expectedProfilePreferenceMarkers.length,
  };
}

function resolveInjectedForbiddenKeys(args: {
  injectedItems: RetrievedMemoryItem[];
  forbiddenFactKeys: Set<string>;
  forbiddenEpisodeKeys: Set<string>;
}) {
  return [
    ...new Set(
      args.injectedItems
        .filter((item) => {
          if (!item.key) return false;
          if (item.kind === "fact") return args.forbiddenFactKeys.has(item.key);
          return args.forbiddenEpisodeKeys.has(item.key);
        })
        .map((item) => item.key as string),
    ),
  ];
}

function scoreByCategory(
  queries: MemoryRetrievalScoredQuery[],
): MemoryRetrievalCategoryScore[] {
  const categories = [...new Set(queries.map((query) => query.category))].sort();

  return categories.map((category) => {
    const scoped = queries.filter((query) => query.category === category);

    return {
      category,
      queryCount: scoped.length,
      precisionAtK: sumRate(
        scoped.map((query) => ({
          numerator: query.relevantAtK,
          denominator: query.k,
        })),
      ),
      precisionCeiling: sumRate(
        scoped.map((query) => ({
          numerator: query.precisionCeilingNumerator,
          denominator: query.precisionCeilingDenominator,
        })),
      ),
      ceilingNormalizedPrecisionAtK: sumRate(
        scoped.map((query) => ({
          numerator: query.relevantAtK,
          denominator: query.precisionCeilingNumerator,
        })),
      ),
      retrievedItemPrecision: sumRate(
        scoped.map((query) => ({
          numerator: query.retrievedItemPrecisionNumerator,
          denominator: query.retrievedItemPrecisionDenominator,
        })),
      ),
      rankNormalizedPrecisionAtK: sumRate(
        scoped.map((query) => ({
          numerator: query.rankNormalizedRelevantAtK,
          denominator: query.k,
        })),
      ),
      rankNormalizedPrecisionCeiling: sumRate(
        scoped.map((query) => ({
          numerator: query.rankNormalizedPrecisionCeilingNumerator,
          denominator: query.rankNormalizedPrecisionCeilingDenominator,
        })),
      ),
      rankNormalizedCeilingNormalizedPrecisionAtK: sumRate(
        scoped.map((query) => ({
          numerator: query.rankNormalizedRelevantAtK,
          denominator: query.rankNormalizedPrecisionCeilingNumerator,
        })),
      ),
      plantedFactRecall: sumRate(
        scoped.map((query) => ({
          numerator: query.factRecallNumerator,
          denominator: query.factRecallDenominator,
        })),
      ),
      plantedEpisodeRecall: sumRate(
        scoped.map((query) => ({
          numerator: query.episodeRecallNumerator,
          denominator: query.episodeRecallDenominator,
        })),
      ),
      factRecallCeiling: sumRate(
        scoped.map((query) => ({
          numerator: query.factRecallCeilingNumerator,
          denominator: query.factRecallCeilingDenominator,
        })),
      ),
      episodeRecallCeiling: sumRate(
        scoped.map((query) => ({
          numerator: query.episodeRecallCeilingNumerator,
          denominator: query.episodeRecallCeilingDenominator,
        })),
      ),
      factPrecision: sumRate(
        scoped.map((query) => ({
          numerator: query.factPrecisionNumerator,
          denominator: query.factPrecisionDenominator,
        })),
      ),
      episodePrecision: sumRate(
        scoped.map((query) => ({
          numerator: query.episodePrecisionNumerator,
          denominator: query.episodePrecisionDenominator,
        })),
      ),
      factForbiddenSurfacing: sumRate(
        scoped
          .filter((query) => query.forbiddenFactKeys.length > 0)
          .map((query) => ({
            numerator: query.factForbiddenSurfacingNumerator,
            denominator: query.factForbiddenSurfacingDenominator,
          })),
      ),
      episodeForbiddenSurfacing: sumRate(
        scoped
          .filter((query) => query.forbiddenEpisodeKeys.length > 0)
          .map((query) => ({
            numerator: query.episodeForbiddenSurfacingNumerator,
            denominator: query.episodeForbiddenSurfacingDenominator,
          })),
      ),
      preferenceMarkerRecall: sumRate(
        scoped.map((query) => ({
          numerator: query.preferenceMarkerRecallNumerator,
          denominator: query.preferenceMarkerRecallDenominator,
        })),
      ),
      staleSurfacing: sumRate(
        scoped
          .filter(hasForbiddenKeys)
          .map((query) => ({
            numerator: query.staleHitsAtK,
            denominator: query.k,
          })),
      ),
      rankNormalizedStaleSurfacing: sumRate(
        scoped
          .filter(hasForbiddenKeys)
          .map((query) => ({
            numerator: query.rankNormalizedStaleHitsAtK,
            denominator: query.k,
          })),
      ),
      affectedQueryRate: rate({
        numerator: scoped.filter(
          (query) => hasForbiddenKeys(query) && query.affectedByForbidden,
        ).length,
        denominator: scoped.filter(hasForbiddenKeys).length,
      }),
      rankNormalizedAffectedQueryRate: rate({
        numerator: scoped.filter(
          (query) => hasForbiddenKeys(query) && query.rankNormalizedAffectedByForbidden,
        ).length,
        denominator: scoped.filter(hasForbiddenKeys).length,
      }),
      unknownRetrievedItemRate: sumRate(
        scoped.map((query) => ({
          numerator: query.unknownRetrievedItems.length,
          denominator: query.retrievedTopK.length,
        })),
      ),
      unknownFactItemRate: sumRate(
        scoped.map((query) => ({
          numerator: query.unknownFactItems.length,
          denominator: query.retrievedFacts.length,
        })),
      ),
      unknownEpisodeItemRate: sumRate(
        scoped.map((query) => ({
          numerator: query.unknownEpisodeItems.length,
          denominator: query.retrievedEpisodes.length,
        })),
      ),
      injectedPrecision: sumRate(
        scoped.map((query) => ({
          numerator: query.injectedCount - query.injectedForbiddenKeys.length,
          denominator: query.injectedCount,
        })),
      ),
      irrelevantInjectionRate: sumRate(
        scoped.map((query) => ({
          numerator: query.injectedForbiddenKeys.length,
          denominator: query.injectedCount,
        })),
      ),
      noMemoryRate: rate({
        numerator: scoped.filter((query) => !query.hasInjectedMemory).length,
        denominator: scoped.length,
      }),
    };
  });
}

function hasForbiddenKeys(query: MemoryRetrievalScoredQuery) {
  return (
    query.forbiddenFactKeys.length > 0 ||
    query.forbiddenEpisodeKeys.length > 0
  );
}

function dedupeRetrievedItems(items: RetrievedMemoryItem[]) {
  const seen = new Set<string>();
  const deduped: RetrievedMemoryItem[] = [];

  for (const item of items) {
    const dedupeKey = `${item.kind}:${item.id}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push(item);
  }

  return deduped;
}

function buildRankNormalizedTopK(args: {
  facts: RetrievedMemoryItem[];
  episodes: RetrievedMemoryItem[];
  k: number;
}) {
  const normalized: RetrievedMemoryItem[] = [];

  for (const [index, fact] of args.facts.entries()) {
    normalized.push({
      ...fact,
      rankNormalizedScore: rrfRank(index),
    });
  }
  for (const [index, episode] of args.episodes.entries()) {
    normalized.push({
      ...episode,
      rankNormalizedScore: rrfRank(index),
    });
  }

  return normalized
    .sort((a, b) => {
      const scoreDelta =
        (b.rankNormalizedScore ?? 0) - (a.rankNormalizedScore ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const rankDelta = channelRank(a, args) - channelRank(b, args);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      if (a.kind !== b.kind) {
        return a.kind === "fact" ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, args.k);
}

function channelRank(
  item: RetrievedMemoryItem,
  args: { facts: RetrievedMemoryItem[]; episodes: RetrievedMemoryItem[] },
) {
  const channel = item.kind === "fact" ? args.facts : args.episodes;
  const index = channel.findIndex(
    (candidate) => candidate.id === item.id && candidate.kind === item.kind,
  );

  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function rrfRank(rank: number) {
  return 1 / (RRF_K + rank);
}

function sumRate(values: Array<{ numerator: number; denominator: number }>) {
  const total = values.reduce(
    (acc, item) => ({
      numerator: acc.numerator + item.numerator,
      denominator: acc.denominator + item.denominator,
    }),
    { numerator: 0, denominator: 0 },
  );

  return rate(total);
}

function rate(value: { numerator: number; denominator: number }): MemoryRetrievalRate {
  return {
    ...value,
    rate: value.denominator === 0 ? 0 : value.numerator / value.denominator,
    wilson95:
      value.denominator === 0
        ? null
        : wilsonInterval(value.numerator, value.denominator),
  };
}

function wilsonInterval(numerator: number, denominator: number) {
  const z = 1.959963984540054;
  const p = numerator / denominator;
  const z2 = z * z;
  const center = (p + z2 / (2 * denominator)) / (1 + z2 / denominator);
  const halfWidth =
    (z /
      (1 + z2 / denominator)) *
    Math.sqrt((p * (1 - p)) / denominator + z2 / (4 * denominator * denominator));

  return {
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
  };
}
