import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSeedLearner } from "../../evals/seed-learner/runner";
import type { SeedLearnerManifest } from "../../evals/seed-learner/manifest";
import {
  loadMemoryRetrievalDataset,
  validateMemoryDatasetAgainstManifest,
  type MemoryRetrievalCase,
  type MemoryRetrievalDataset,
} from "../../evals/runner/memory-retrieval-dataset";
import {
  buildMemoryManifestLookup,
  mapRetrievedItemsToManifest,
  scoreMemoryRetrievalQuery,
  scoreMemoryRetrievalSuite,
  type RetrievedMemoryItem,
} from "../../evals/runner/memory-retrieval-metrics";
import {
  buildMemoryRetrievalReport,
  renderMemoryRetrievalMarkdown,
} from "../../evals/runner/memory-retrieval-report";
import { runMemoryRetrievalSuite } from "../../evals/runner/memory-retrieval-suite";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "pc-memory-retrieval-"));
}

function makeCase(overrides: Partial<MemoryRetrievalCase> = {}): MemoryRetrievalCase {
  return {
    queryId: "q-memory",
    category: "mistake_recall",
    problemSlug: "two-sum",
    entry: { kind: "review" },
    userQuestion: "What should I remember?",
    expectedFactKeys: ["fact.expected"],
    expectedEpisodeKeys: [],
    forbiddenFactKeys: [],
    forbiddenEpisodeKeys: [],
    neutralFactKeys: [],
    neutralEpisodeKeys: [],
    expectedProfilePreferenceMarkers: [],
    distractorKeys: [],
    k: 5,
    notes: "Unit test case.",
    limitations: [],
    ...overrides,
  };
}

function makeDataset(cases: MemoryRetrievalCase[]): MemoryRetrievalDataset {
  return {
    datasetVersion: "memory-retrieval-v1",
    name: "unit-memory",
    status: "unit",
    description: "Unit dataset.",
    defaultK: 5,
    humanReviewStatus: "pending",
    cases,
    limitations: ["Unit limitation."],
  };
}

function item(overrides: Partial<RetrievedMemoryItem>): RetrievedMemoryItem {
  return {
    kind: "fact",
    id: "db-fact",
    key: "fact.expected",
    score: 1,
    label: "expected",
    unknown: false,
    ...overrides,
  };
}

function countRows(dbPath: string, tableName: string) {
  const db = new Database(dbPath);
  try {
    return db.prepare(`select count(*) as count from "${tableName}"`).get()
      .count as number;
  } finally {
    db.close();
  }
}

describe("memory retrieval dataset", () => {
  it("loads the v1 query dataset and keeps preference facts diagnostic-only", () => {
    const dataset = loadMemoryRetrievalDataset();

    expect(dataset.datasetVersion).toBe("memory-retrieval-v1");
    expect(dataset.humanReviewStatus).toBe("pending");
    expect(dataset.cases).toHaveLength(12);
    expect(new Set(dataset.cases.map((item) => item.category))).toContain(
      "preference",
    );
    expect(
      dataset.cases
        .filter((item) => item.category === "preference")
        .every(
          (item) =>
            item.expectedFactKeys.length === 0 &&
            item.expectedProfilePreferenceMarkers.length > 0,
        ),
    ).toBe(true);
  });

  it("rejects duplicate query ids", () => {
    const dir = tempDir();
    try {
      const dataset = structuredClone(loadMemoryRetrievalDataset());
      dataset.cases[1].queryId = dataset.cases[0].queryId;
      const datasetPath = join(dir, "duplicate-memory-dataset.json");
      writeFileSync(datasetPath, JSON.stringify(dataset), "utf8");

      expect(() => loadMemoryRetrievalDataset({ datasetPath })).toThrow(
        "Duplicate memory queryId",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("validates expected and forbidden keys against the manifest key space", () => {
    const dataset = makeDataset([
      makeCase({
        expectedFactKeys: ["fact.a"],
        expectedEpisodeKeys: ["episode.a"],
        forbiddenFactKeys: ["fact.stale"],
        forbiddenEpisodeKeys: ["episode.stale"],
        neutralFactKeys: ["fact.neutral"],
        neutralEpisodeKeys: ["episode.neutral"],
      }),
    ]);

    expect(() =>
      validateMemoryDatasetAgainstManifest({
        dataset,
        factKeys: new Set(["fact.a", "fact.stale", "fact.neutral"]),
        episodeKeys: new Set(["episode.a", "episode.stale", "episode.neutral"]),
      }),
    ).not.toThrow();

    expect(() =>
      validateMemoryDatasetAgainstManifest({
        dataset,
        factKeys: new Set(["fact.a"]),
        episodeKeys: new Set(["episode.a", "episode.stale"]),
      }),
    ).toThrow("unknown forbiddenFactKey fact.stale");
  });
});

describe("memory retrieval manifest mapping", () => {
  it("maps retrieved DB ids back to stable manifest keys and flags unknown ids", () => {
    const manifest = {
      facts: [
        {
          factId: "db-fact-a",
          scenarioFactKey: "fact.a",
        },
      ],
      episodes: [
        {
          episodeId: "db-episode-a",
          scenarioEpisodeKey: "episode.a",
        },
      ],
    } as SeedLearnerManifest;
    const lookup = buildMemoryManifestLookup(manifest);
    const mapped = mapRetrievedItemsToManifest({
      lookup,
      facts: [
        { id: "db-fact-a", tag: "hashmap", score: 1 },
        { id: "db-fact-unknown", tag: "unknown", score: 0.9 },
      ],
      episodes: [{ id: "db-episode-a", title: "Episode A", score: 0.8 }],
    });

    expect(mapped.map((result) => result.key)).toEqual([
      "fact.a",
      undefined,
      "episode.a",
    ]);
    expect(mapped.find((result) => result.id === "db-fact-unknown")?.unknown).toBe(
      true,
    );
  });
});

describe("memory retrieval metrics", () => {
  it("computes precision@5 with a fixed denominator, fewer than K results, and deduped hits", () => {
    const query = makeCase({
      expectedFactKeys: ["fact.expected"],
      expectedEpisodeKeys: ["episode.expected"],
    });
    const scored = scoreMemoryRetrievalQuery({
      query,
      defaultK: 5,
      retrieved: [
        item({ id: "db-fact-1", key: "fact.expected" }),
        item({ id: "db-fact-1", key: "fact.expected", score: 0.5 }),
        item({
          kind: "episode",
          id: "db-episode-1",
          key: "episode.expected",
          label: "expected episode",
        }),
      ],
    });

    expect(scored.retrievedTopK).toHaveLength(2);
    expect(scored.relevantAtK).toBe(2);
    expect(scored.precisionAtK).toBe(0.4);

    const sparse = scoreMemoryRetrievalQuery({
      query,
      defaultK: 5,
      retrieved: [item({ id: "db-fact-1", key: "fact.expected" })],
    });
    expect(sparse.precisionAtK).toBe(0.2);
    expect(sparse.missingExpectedEpisodeKeys).toEqual(["episode.expected"]);
  });

  it("scores fact and episode recall within separate channels before legacy mixed top-K truncation", () => {
    const query = makeCase({
      expectedFactKeys: ["fact.expected"],
      expectedEpisodeKeys: ["episode.expected"],
    });
    const scored = scoreMemoryRetrievalQuery({
      query,
      defaultK: 5,
      retrieved: [
        item({ id: "db-fact-1", key: "fact.a", score: 2 }),
        item({ id: "db-fact-2", key: "fact.b", score: 1.9 }),
        item({ id: "db-fact-3", key: "fact.c", score: 1.8 }),
        item({ id: "db-fact-4", key: "fact.d", score: 1.7 }),
        item({ id: "db-fact-5", key: "fact.expected", score: 1.6 }),
        item({
          kind: "episode",
          id: "db-episode-1",
          key: "episode.expected",
          label: "expected episode",
          score: 0.02,
        }),
      ],
    });

    expect(scored.retrievedTopK.map((hit) => hit.kind)).toEqual([
      "fact",
      "fact",
      "fact",
      "fact",
      "fact",
    ]);
    expect(scored.legacyMatchedExpectedEpisodeKeys).toEqual([]);
    expect(scored.matchedExpectedEpisodeKeys).toEqual(["episode.expected"]);
    expect(scored.episodeRecallNumerator).toBe(1);
    expect(scored.episodeRecallDenominator).toBe(1);
    expect(scored.rankNormalizedTopK.map((hit) => hit.kind)).toContain(
      "episode",
    );
  });

  it("computes planted-fact recall and excludes empty-expected-fact queries from the denominator", () => {
    const multiFact = makeCase({
      queryId: "q-multi",
      expectedFactKeys: ["fact.a", "fact.b"],
    });
    const noExpectedFacts = makeCase({
      queryId: "q-empty",
      expectedFactKeys: [],
      expectedEpisodeKeys: ["episode.a"],
    });
    const score = scoreMemoryRetrievalSuite({
      cases: [multiFact, noExpectedFacts],
      defaultK: 5,
      runs: [
        {
          queryId: "q-multi",
          retrieved: [item({ id: "db-a", key: "fact.a" })],
        },
        {
          queryId: "q-empty",
          retrieved: [
            item({
              kind: "episode",
              id: "db-episode",
              key: "episode.a",
              label: "episode",
            }),
          ],
        },
      ],
    });

    expect(score.plantedFactRecall).toMatchObject({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
    expect(score.plantedEpisodeRecall).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
    expect(score.factPrecision.numerator).toBe(1);
    expect(score.episodePrecision.numerator).toBe(1);
    expect(score.noExpectedFactQueryIds).toEqual(["q-empty"]);
  });

  it("reports precision ceiling, ceiling-normalized precision, and retrieved-item precision", () => {
    const query = makeCase({
      expectedFactKeys: ["fact.a"],
      expectedEpisodeKeys: ["episode.a"],
    });
    const score = scoreMemoryRetrievalSuite({
      cases: [query],
      defaultK: 5,
      runs: [
        {
          queryId: query.queryId,
          retrieved: [
            item({ id: "db-a", key: "fact.a" }),
            item({
              kind: "episode",
              id: "db-noise",
              key: "episode.noise",
              label: "noise",
            }),
          ],
        },
      ],
    });

    expect(score.precisionAtK).toMatchObject({
      numerator: 1,
      denominator: 5,
      rate: 0.2,
    });
    expect(score.precisionCeiling).toMatchObject({
      numerator: 2,
      denominator: 5,
      rate: 0.4,
    });
    expect(score.ceilingNormalizedPrecisionAtK).toMatchObject({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
    expect(score.retrievedItemPrecision).toMatchObject({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
  });

  it("scores forbidden stale hits and unknown retrieved items separately", () => {
    const query = makeCase({
      forbiddenFactKeys: ["fact.stale"],
      forbiddenEpisodeKeys: ["episode.stale"],
      neutralFactKeys: ["fact.neutral"],
    });
    const score = scoreMemoryRetrievalQuery({
      query,
      defaultK: 5,
      retrieved: [
        item({ id: "db-stale", key: "fact.stale" }),
        item({
          kind: "episode",
          id: "db-episode-stale",
          key: "episode.stale",
          label: "stale episode",
        }),
        item({
          id: "db-unknown",
          key: undefined,
          unknown: true,
          label: "unknown",
        }),
        item({ id: "db-neutral", key: "fact.neutral" }),
      ],
    });

    expect(score.staleHitsAtK).toBe(2);
    expect(score.affectedByForbidden).toBe(true);
    expect(score.surfacedNeutralFactKeys).toEqual(["fact.neutral"]);
    expect(score.unknownRetrievedItems.map((result) => result.id)).toEqual([
      "db-unknown",
    ]);

    const suiteScore = scoreMemoryRetrievalSuite({
      cases: [query],
      defaultK: 5,
      runs: [{ queryId: query.queryId, retrieved: score.retrieved }],
    });
    expect(suiteScore.staleSurfacing).toMatchObject({
      numerator: 2,
      denominator: 5,
      rate: 0.4,
    });
    expect(suiteScore.unknownRetrievedItemRate).toMatchObject({
      numerator: 1,
      denominator: 4,
      rate: 1 / 4,
    });
  });

  it("counts an injected forbidden key as an irrelevant injection", () => {
    const query = makeCase({
      queryId: "q-same-tag-different-mechanism",
      forbiddenFactKeys: ["unrelated_dp_fact"],
    });
    const score = scoreMemoryRetrievalQuery({
      query,
      defaultK: 5,
      retrieved: [item({ id: "db-unrelated", key: "unrelated_dp_fact" })],
      injected: [item({ id: "db-unrelated", key: "unrelated_dp_fact" })],
    });

    expect(score.injectedCount).toBe(1);
    expect(score.injectedForbiddenKeys).toEqual(["unrelated_dp_fact"]);
    expect(score.hasInjectedMemory).toBe(true);

    const suiteScore = scoreMemoryRetrievalSuite({
      cases: [query],
      defaultK: 5,
      runs: [
        {
          queryId: query.queryId,
          retrieved: score.retrieved,
          injected: score.injectedItems,
        },
      ],
    });
    expect(suiteScore.irrelevantInjectionRate).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
    expect(suiteScore.injectedPrecision).toMatchObject({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
  });

  it("treats an empty injection set as a valid no-memory turn", () => {
    const query = makeCase({
      queryId: "q-no-suitable-history",
      expectedFactKeys: [],
    });
    const score = scoreMemoryRetrievalQuery({
      query,
      defaultK: 5,
      retrieved: [item({ id: "db-some", key: "some_fact" })],
      injected: [],
    });

    expect(score.injectedCount).toBe(0);
    expect(score.hasInjectedMemory).toBe(false);
    expect(score.injectedForbiddenKeys).toEqual([]);

    const suiteScore = scoreMemoryRetrievalSuite({
      cases: [query],
      defaultK: 5,
      runs: [
        {
          queryId: query.queryId,
          retrieved: score.retrieved,
          injected: score.injectedItems,
        },
      ],
    });
    expect(suiteScore.noMemoryRate).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
  });

  it("scores absent or empty retrieval as zero hits with fixed precision denominator", () => {
    const query = makeCase({
      queryId: "q-empty-retrieval",
      expectedFactKeys: ["fact.expected"],
      expectedEpisodeKeys: ["episode.expected"],
    });
    const score = scoreMemoryRetrievalSuite({
      cases: [query],
      defaultK: 5,
      runs: [],
    });

    expect(score.precisionAtK).toMatchObject({
      numerator: 0,
      denominator: 5,
      rate: 0,
    });
    expect(score.plantedFactRecall).toMatchObject({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
    expect(score.unknownRetrievedItemRate).toMatchObject({
      numerator: 0,
      denominator: 0,
      rate: 0,
    });
    expect(score.queries[0].missingExpectedFactKeys).toEqual(["fact.expected"]);
    expect(score.queries[0].missingExpectedEpisodeKeys).toEqual([
      "episode.expected",
    ]);
  });
});

describe("memory retrieval report", () => {
  it("renders core metrics, paths, and limitations into markdown", () => {
    const query = makeCase();
    const dataset = makeDataset([query]);
    const score = scoreMemoryRetrievalSuite({
      cases: [query],
      defaultK: 5,
      runs: [
        {
          queryId: query.queryId,
          retrieved: [item({ id: "db-fact", key: "fact.expected" })],
        },
      ],
    });
    const report = buildMemoryRetrievalReport({
      runId: "eval-memory-retrieval-unit",
      generatedAt: new Date("2026-07-04T12:00:00.000Z"),
      seedDbPath: "/tmp/seed.db",
      runDbPath: "/tmp/run.db",
      manifestPath: "/tmp/manifest.json",
      datasetPath: "/tmp/dataset.json",
      retrievalNow: new Date("2026-07-04T12:00:00.000Z"),
      dbKept: false,
      dataset,
      score,
      runs: [],
      itemLabels: {
        "fact.expected": "Expected readable fact",
      },
      warnings: [],
      reportPaths: {
        markdown: "/tmp/report.md",
        json: "/tmp/report.json",
      },
    });
    const markdown = renderMemoryRetrievalMarkdown(report);

    expect(markdown).toContain("factRecall@factBudget");
    expect(markdown).toContain("irrelevantInjectionRate");
    expect(markdown).toContain("injectedPrecision");
    expect(markdown).toContain("episodeRecall@episodeBudget");
    expect(markdown).toContain("rank-normalized precision@5");
    expect(markdown).toContain("legacy raw-score mixed precision@5");
    expect(markdown).toContain("Wilson 95% CI");
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("Expected readable fact");
    expect(markdown).toContain("/tmp/seed.db");
    expect(markdown).toContain("/tmp/manifest.json");
    expect(markdown).toContain("## Limitations");
    expect(markdown).toContain("Query ground truth pending human review: yes");
  });
});

describe("memory retrieval runner", () => {
  it("copies the seed DB for scoring and does not rebuild or delete it", async () => {
    const dir = tempDir();
    try {
      const seedDbPath = join(dir, "memory-seed.db");
      const manifestPath = join(dir, "manifest.json");
      const datasetPath = join(dir, "memory-retrieval-fixture.json");
      writeFileSync(
        datasetPath,
        JSON.stringify({
          datasetVersion: "memory-retrieval-v1",
          name: "evaluation isolation lifecycle fixture",
          status: "unit",
          description: "Exercises copy and cleanup without earned memory.",
          defaultK: 5,
          humanReviewStatus: "approved",
          cases: [
            {
              queryId: "evaluation-isolation-no-memory",
              category: "stale_suppression",
              problemSlug: "two-sum",
              entry: { kind: "review" },
              userQuestion: "What prior learner memory is available?",
              expectedFactKeys: [],
              expectedEpisodeKeys: [],
              forbiddenFactKeys: [],
              forbiddenEpisodeKeys: [],
              neutralFactKeys: [],
              neutralEpisodeKeys: [],
              expectedProfilePreferenceMarkers: [],
              k: 5,
              notes: "No earned memory is expected in an evaluation fixture.",
              limitations: ["Lifecycle coverage only."],
            },
          ],
          limitations: ["This fixture does not measure retrieval quality."],
        }),
        "utf8",
      );
      await runSeedLearner({
        scenarioPath: "evals/seed-learner/scenarios/v1-evaluation-fixture.json",
        dbInput: seedDbPath,
        outPath: manifestPath,
        now: new Date("2026-07-04T12:00:00.000Z"),
      });
      const seedUserCount = countRows(seedDbPath, "User");
      const seedFactCount = countRows(seedDbPath, "L2MemoryFact");

      const report = await runMemoryRetrievalSuite({
        dbInput: seedDbPath,
        manifestPath,
        datasetPath,
        outputDir: join(dir, "reports"),
        now: new Date("2026-07-04T13:00:00.000Z"),
      });
      const secondReport = await runMemoryRetrievalSuite({
        dbInput: seedDbPath,
        manifestPath,
        datasetPath,
        outputDir: join(dir, "reports"),
        now: new Date("2026-07-04T13:00:01.000Z"),
      });

      expect(report.llmUsed).toBe(false);
      expect(report.seedDbPath).toBe(seedDbPath);
      expect(report.runDbPath).not.toBe(seedDbPath);
      expect(report.retrievalNow).toBe("2026-07-04T12:00:00.000Z");
      expect(secondReport.retrievalNow).toBe(report.retrievalNow);
      expect(report.queryCount).toBe(1);
      expect(report.score.precisionAtK.denominator).toBe(5);
      expect(secondReport.score.precisionAtK).toEqual(report.score.precisionAtK);
      expect(secondReport.score.plantedFactRecall).toEqual(
        report.score.plantedFactRecall,
      );
      expect(secondReport.score.staleSurfacing).toEqual(
        report.score.staleSurfacing,
      );
      expect(
        secondReport.score.queries.map((query) => ({
          queryId: query.queryId,
          surfacedForbiddenFactKeys: query.surfacedForbiddenFactKeys,
          surfacedForbiddenEpisodeKeys: query.surfacedForbiddenEpisodeKeys,
        })),
      ).toEqual(
        report.score.queries.map((query) => ({
          queryId: query.queryId,
          surfacedForbiddenFactKeys: query.surfacedForbiddenFactKeys,
          surfacedForbiddenEpisodeKeys: query.surfacedForbiddenEpisodeKeys,
        })),
      );
      expect(existsSync(seedDbPath)).toBe(true);
      expect(countRows(seedDbPath, "User")).toBe(seedUserCount);
      expect(countRows(seedDbPath, "L2MemoryFact")).toBe(seedFactCount);
      expect(existsSync(report.runDbPath)).toBe(false);
      expect(existsSync(secondReport.runDbPath)).toBe(false);
      expect(existsSync(report.reportPaths.markdown)).toBe(true);
      expect(existsSync(report.reportPaths.json)).toBe(true);

      const reportJson = JSON.parse(
        readFileSync(report.reportPaths.json, "utf8"),
      ) as typeof report;
      expect(reportJson.seedDbPath).toBe(seedDbPath);
      expect(reportJson.manifestPath).toBe(manifestPath);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
