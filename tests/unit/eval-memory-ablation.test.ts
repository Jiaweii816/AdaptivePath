import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSeedLearner } from "../../evals/seed-learner/runner";
import {
  loadSeedLearnerManifest,
  type SeedLearnerManifest,
} from "../../evals/seed-learner/manifest";
import {
  loadMemoryCitationDataset,
  validateMemoryCitationDatasetAgainstManifest,
  type MemoryCitationDataset,
} from "../../evals/runner/memory-citation-dataset";
import {
  buildCitationOutput,
  calculateTokenReduction,
  scoreMemoryCitationSuite,
  summarizeTokenEstimates,
} from "../../evals/runner/memory-ablation-metrics";
import {
  buildMemoryAblationReport,
  renderMemoryAblationMarkdown,
} from "../../evals/runner/memory-ablation-report";
import { scoreMemoryRetrievalSuite } from "../../evals/runner/memory-retrieval-metrics";
import type { MemoryRetrievalCase } from "../../evals/runner/memory-retrieval-dataset";
import { runMemoryAblationSuite } from "../../evals/runner/memory-ablation-suite";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "pc-memory-ablation-"));
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

function makeQuery(): MemoryRetrievalCase {
  return {
    queryId: "q-ablation",
    category: "mistake_recall",
    problemSlug: "two-sum",
    entry: { kind: "review" },
    userQuestion: "What memory matters?",
    expectedFactKeys: ["fact.expected"],
    expectedEpisodeKeys: ["episode.expected"],
    forbiddenFactKeys: [],
    forbiddenEpisodeKeys: [],
    neutralFactKeys: [],
    neutralEpisodeKeys: [],
    expectedProfilePreferenceMarkers: [],
    distractorKeys: [],
    k: 5,
    notes: "Unit query.",
    limitations: [],
  };
}

function minimalManifest(): SeedLearnerManifest {
  return {
    manifestVersion: "seed-learner-manifest-v1",
    generatedAt: "2026-07-04T12:00:00.000Z",
    scenarioId: "unit",
    scenarioVersion: "seed-learner-scenario-v1",
    scenarioPath: "/tmp/scenario.json",
    dbPath: "/tmp/seed.db",
    learnerId: "learner",
    userId: "user",
    humanReviewStatus: "pending",
    counts: {
      facts: 2,
      episodes: 1,
      staleOrSupersededFacts: 1,
      preferenceFacts: 0,
    },
    facts: [
      {
        scenarioFactKey: "fact.expected",
        factId: "fact-db-expected",
        factType: "mistake",
        tag: "expected",
        label: "Expected fact",
        value: "Expected fact",
        dbStatus: "active",
        scenarioStatus: "current",
        confidence: 0.8,
        expectedRetrievable: true,
        relatedProblemSlugs: ["two-sum"],
        sourceEpisodeKey: "episode.expected",
        sourceEpisodeId: "episode-db-expected",
        source: "review_diagnosis",
        evidenceTraceIds: ["trace"],
        arbitrationPath: [
          {
            episodeKey: "episode.expected",
            evidenceKind: "reinforce",
            source: "review_diagnosis",
            evidenceTraceIds: ["trace"],
          },
        ],
      },
      {
        scenarioFactKey: "fact.forbidden",
        factId: "fact-db-forbidden",
        factType: "mistake",
        tag: "forbidden",
        label: "Forbidden fact",
        value: "Forbidden fact",
        dbStatus: "contradicted",
        scenarioStatus: "superseded",
        confidence: 0.2,
        expectedRetrievable: false,
        relatedProblemSlugs: ["two-sum"],
        sourceEpisodeKey: "episode.expected",
        sourceEpisodeId: "episode-db-expected",
        source: "review_diagnosis",
        evidenceTraceIds: ["trace"],
        arbitrationPath: [
          {
            episodeKey: "episode.expected",
            evidenceKind: "contradict",
            source: "review_diagnosis",
            evidenceTraceIds: ["trace"],
          },
        ],
      },
    ],
    episodes: [
      {
        scenarioEpisodeKey: "episode.expected",
        episodeId: "episode-db-expected",
        kind: "review",
        problemSlug: "two-sum",
        problemPath: "/workbench?problem=two-sum",
        title: "Expected episode",
        summary: "Expected episode summary",
        outcome: "failed",
        expectedRetrievable: true,
        sourceTraceIds: ["trace"],
      },
    ],
    staleFacts: [
      {
        scenarioFactKey: "fact.forbidden",
        factId: "fact-db-forbidden",
        dbStatus: "contradicted",
        scenarioStatus: "superseded",
        reason: "Unit forbidden fact.",
      },
    ],
    preferences: [],
    arbitration: {
      used: true,
      sources: ["review_diagnosis"],
      rejectedCandidateCount: 0,
      deterministicIdUpdates: [],
      fixtureOnlyWrites: [],
    },
    realLlmCalls: false,
    notes: ["Unit manifest."],
    limitations: ["Unit manifest."],
  };
}

function readSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...readSourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(name)) {
      files.push(path);
    }
  }

  return files;
}

describe("memory ablation datasets", () => {
  it("loads citation v1 and validates keys against the seed manifest", () => {
    const dataset = loadMemoryCitationDataset();
    const manifest = loadSeedLearnerManifest(
      "evals/seed-learner/manifests/v1-learner.manifest.json",
    );

    expect(dataset.datasetVersion).toBe("memory-citation-v1");
    expect(dataset.humanReviewStatus).toBe("pending");
    expect(dataset.cases).toHaveLength(9);
    expect(dataset.cases.some((item) => item.citationRequirement === "none_expected")).toBe(
      true,
    );
    expect(() =>
      validateMemoryCitationDatasetAgainstManifest({
        dataset,
        factKeys: new Set(manifest.facts.map((fact) => fact.scenarioFactKey)),
        episodeKeys: new Set(
          manifest.episodes.map((episode) => episode.scenarioEpisodeKey),
        ),
      }),
    ).not.toThrow();
  });
});

describe("memory ablation metrics", () => {
  it("computes focused vs full-history token reduction", () => {
    const reduction = calculateTokenReduction({
      baselineArm: "full_history_l2_eval_only",
      baselineTokens: summarizeTokenEstimates([100, 120, 140]),
      comparisonArm: "focused_l2_fts",
      comparisonTokens: summarizeTokenEstimates([40, 50, 60]),
    });

    expect(reduction.absoluteTokens).toBe(70);
    expect(reduction.percent).toBeCloseTo(70 / 120);
  });

  it("scores structured citations, forbidden citations, and hallucinated ids", () => {
    const manifest = minimalManifest();
    const dataset: MemoryCitationDataset = {
      datasetVersion: "memory-citation-v1",
      name: "unit",
      status: "unit",
      description: "unit",
      humanReviewStatus: "pending",
      limitations: [],
      cases: [
        {
          caseId: "pcite-valid",
          category: "mistake_memory",
          problemSlug: "two-sum",
          userQuestion: "What happened?",
          expectedFactKeys: ["fact.expected"],
          expectedEpisodeKeys: ["episode.expected"],
          forbiddenFactKeys: ["fact.forbidden"],
          forbiddenEpisodeKeys: [],
          neutralFactKeys: [],
          neutralEpisodeKeys: [],
          citationRequirement: "required",
          notes: "unit",
          limitations: [],
        },
      ],
    };
    const score = scoreMemoryCitationSuite({
      dataset,
      manifest,
      runs: [
        {
          caseId: "pcite-valid",
          outputText: buildCitationOutput({
            citedFactIds: [
              "fact-db-expected",
              "fact-db-forbidden",
              "fact-db-forbidden",
              "not-in-manifest",
            ],
            citedEpisodeIds: ["episode-db-expected"],
          }),
          allowedFactIds: ["fact-db-expected"],
          allowedEpisodeIds: ["episode-db-expected"],
        },
      ],
    });

    expect(score.scoringStatus).toBe("deterministic_structured_citations");
    expect(score.hallucinatedMemoryRate).toMatchObject({
      numerator: 1,
      denominator: 4,
      rate: 0.25,
    });
    expect(score.forbiddenCitationRate.numerator).toBe(1);
    expect(score.unsupportedCitationRate.numerator).toBe(1);
    expect(score.expectedCitationRecall.rate).toBe(1);
    expect(score.cases[0].duplicateCitationCount).toBe(1);
  });

  it("marks missing structured citations unscorable instead of hallucination 0%", () => {
    const manifest = minimalManifest();
    const dataset: MemoryCitationDataset = {
      datasetVersion: "memory-citation-v1",
      name: "unit",
      status: "unit",
      description: "unit",
      humanReviewStatus: "pending",
      limitations: [],
      cases: [
        {
          caseId: "pcite-missing",
          category: "mistake_memory",
          problemSlug: "two-sum",
          userQuestion: "What happened?",
          expectedFactKeys: ["fact.expected"],
          expectedEpisodeKeys: [],
          forbiddenFactKeys: [],
          forbiddenEpisodeKeys: [],
          neutralFactKeys: [],
          neutralEpisodeKeys: [],
          citationRequirement: "required",
          notes: "unit",
          limitations: [],
        },
      ],
    };
    const score = scoreMemoryCitationSuite({
      dataset,
      manifest,
      runs: [],
    });

    expect(score.scoringStatus).toBe("unscorable_no_structured_citations");
    expect(score.hallucinatedMemoryRate.rate).toBeNull();
    expect(score.unscorableCaseRate.rate).toBe(1);
    expect(score.noCitationOrUnscorableCount).toBe(1);
  });
});

describe("memory ablation report", () => {
  it("renders token reduction, hallucination caveat, deferred arms, and limitations", () => {
    const query = makeQuery();
    const retrieval = scoreMemoryRetrievalSuite({
      cases: [query],
      defaultK: 5,
      runs: [
        {
          queryId: query.queryId,
          retrieved: [
            {
              kind: "fact",
              id: "fact-db-expected",
              key: "fact.expected",
              label: "Expected",
              unknown: false,
            },
          ],
        },
      ],
    });
    const citationDataset = loadMemoryCitationDataset();
    const citationScore = scoreMemoryCitationSuite({
      dataset: citationDataset,
      manifest: loadSeedLearnerManifest(
        "evals/seed-learner/manifests/v1-learner.manifest.json",
      ),
      runs: [],
    });
    const report = buildMemoryAblationReport({
      runId: "eval-memory-ablation-unit",
      generatedAt: new Date("2026-07-04T12:00:00.000Z"),
      seedDbPath: "/tmp/seed.db",
      runDbPath: "/tmp/run.db",
      manifestPath: "/tmp/manifest.json",
      queryDatasetPath: "/tmp/queries.json",
      citationDatasetPath: "/tmp/citations.json",
      retrievalNow: new Date("2026-07-04T12:00:00.000Z"),
      dbKept: false,
      queryDataset: {
        datasetVersion: "memory-retrieval-v1",
        name: "unit",
        status: "unit",
        description: "unit",
        defaultK: 5,
        humanReviewStatus: "pending",
        cases: [query],
        limitations: ["Query limitation."],
      },
      citationDataset,
      arms: [
        {
          arm: "focused_l2_fts",
          label: "focused",
          evalOnly: false,
          includeL2Facts: true,
          retrievalMode: "fts_only",
          retrieval,
          promptTokens: summarizeTokenEstimates([50]),
        },
        {
          arm: "full_history_l2_eval_only",
          label: "full",
          evalOnly: true,
          includeL2Facts: true,
          retrievalMode: "prompt_order",
          retrieval,
          promptTokens: summarizeTokenEstimates([100]),
        },
      ],
      deferredArms: [{ arm: "focused_l2_hybrid", reason: "unit deferred" }],
      tokenReductions: [
        calculateTokenReduction({
          baselineArm: "full_history_l2_eval_only",
          baselineTokens: summarizeTokenEstimates([100]),
          comparisonArm: "focused_l2_fts",
          comparisonTokens: summarizeTokenEstimates([50]),
        }),
      ],
      citationScore,
      citationRuns: [],
      llmUsed: false,
      runs: [],
      warnings: [],
      reportPaths: {
        markdown: "/tmp/report.md",
        json: "/tmp/report.json",
      },
    });
    const markdown = renderMemoryAblationMarkdown(report);

    expect(markdown).toContain("Focused Vs Full-History Token Reduction");
    expect(markdown).toContain("Hallucinated memory rate: unscorable");
    expect(markdown).toContain("focused_l2_hybrid");
    expect(markdown).toContain("Full-history builders are eval-only");
    expect(markdown).toContain("/tmp/seed.db");
  });
});

describe("memory ablation runner", () => {
  it("keeps full-history builder out of product source imports", () => {
    const sourceFiles = readSourceFiles("src");
    const offenders = sourceFiles.filter((filePath) => {
      const text = readFileSync(filePath, "utf8");

      return (
        text.includes("memory-ablation-full-history") ||
        text.includes("evals/runner/memory-ablation")
      );
    });

    expect(offenders).toEqual([]);
  });

  it("copies the seed DB and removes only the run DB after success", async () => {
    const dir = tempDir();
    try {
      const seedDbPath = join(dir, "memory-seed.db");
      const manifestPath = join(dir, "manifest.json");
      const datasetPath = join(dir, "memory-retrieval-fixture.json");
      const citationDatasetPath = join(dir, "memory-citation-fixture.json");
      writeFileSync(
        datasetPath,
        JSON.stringify({
          datasetVersion: "memory-retrieval-v1",
          name: "evaluation isolation lifecycle fixture",
          status: "unit",
          description: "Exercises ablation DB lifecycle without earned memory.",
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
      writeFileSync(
        citationDatasetPath,
        JSON.stringify({
          datasetVersion: "memory-citation-v1",
          name: "evaluation isolation citation fixture",
          status: "unit",
          description: "Confirms that no citation is expected without earned memory.",
          humanReviewStatus: "approved",
          cases: [
            {
              caseId: "evaluation-isolation-no-citation",
              category: "no_memory_evidence",
              problemSlug: "two-sum",
              userQuestion: "What do you remember about my earlier work?",
              expectedFactKeys: [],
              expectedEpisodeKeys: [],
              forbiddenFactKeys: [],
              forbiddenEpisodeKeys: [],
              neutralFactKeys: [],
              neutralEpisodeKeys: [],
              citationRequirement: "none_expected",
              notes: "Evaluation fixtures must not invent earned learner memory.",
              limitations: ["Lifecycle coverage only."],
            },
          ],
          limitations: ["No LLM scoring is performed in this unit test."],
        }),
        "utf8",
      );
      await runSeedLearner({
        scenarioPath: "evals/seed-learner/scenarios/v1-evaluation-fixture.json",
        dbInput: seedDbPath,
        outPath: manifestPath,
        now: new Date("2026-07-04T12:00:00.000Z"),
      });
      const seedFactCount = countRows(seedDbPath, "L2MemoryFact");

      const report = await runMemoryAblationSuite({
        dbInput: seedDbPath,
        manifestPath,
        datasetPath,
        citationDatasetPath,
        outputDir: join(dir, "reports"),
        now: new Date("2026-07-04T13:00:00.000Z"),
        skipCitationLlm: true,
      });

      expect(report.llmUsed).toBe(false);
      expect(report.seedDbPath).toBe(seedDbPath);
      expect(report.runDbPath).not.toBe(seedDbPath);
      expect(report.armNames).toEqual([
        "focused_l2_fts",
        "focused_no_l2_fts",
        "full_history_l2_eval_only",
        "full_history_no_l2_eval_only",
      ]);
      expect(report.deferredArms.map((item) => item.arm)).toContain(
        "focused_l2_hybrid",
      );
      expect(report.queryCount).toBe(1);
      expect(report.citationCaseCount).toBe(1);
      expect(report.citation.score.hallucinatedMemoryRate.rate).toBeNull();
      expect(report.citation.score.noCitationOrUnscorableCount).toBe(1);
      expect(existsSync(seedDbPath)).toBe(true);
      expect(countRows(seedDbPath, "L2MemoryFact")).toBe(seedFactCount);
      expect(existsSync(report.runDbPath)).toBe(false);
      expect(existsSync(report.reportPaths.markdown)).toBe(true);
      expect(existsSync(report.reportPaths.json)).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
