import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  loadSeedLearnerScenario,
  seedLearnerScenarioSchema,
} from "../../evals/seed-learner/scenario";
import {
  loadSeedLearnerManifest,
  writeSeedLearnerManifest,
} from "../../evals/seed-learner/manifest";
import { runSeedLearner } from "../../evals/seed-learner/runner";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "pc-seed-learner-"));
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

describe("seed learner scenario", () => {
  it("loads and validates the v1 scenario", () => {
    const scenario = loadSeedLearnerScenario();

    expect(scenario.scenarioVersion).toBe("seed-learner-scenario-v1");
    expect(scenario.humanReviewStatus).toBe("pending");
    expect(scenario.episodes).toHaveLength(6);
    expect(scenario.facts).toHaveLength(11);
    expect(scenario.expected.staleFactKeys).toHaveLength(4);
    expect(
      scenario.facts.filter((fact) => fact.factType === "preference"),
    ).toHaveLength(2);
    const serialized = JSON.stringify(scenario);
    expect(serialized).not.toContain("no_search_logic");
    expect(serialized).not.toContain("hardcoded_return");
    expect(serialized).not.toContain("hardcoded answer");
    expect(
      scenario.facts.find(
        (fact) => fact.key === "fact.two_sum.same_index_reuse",
      ),
    ).toMatchObject({
      tag: "two_sum_same_index_reuse",
      label:
        "Checks the complement after storing the current value and can reuse one index",
    });
  });

  it("loads the evaluation-only fixture without earned memory", () => {
    const scenario = loadSeedLearnerScenario({
      scenarioPath:
        "evals/seed-learner/scenarios/v1-evaluation-fixture.json",
    });

    expect(scenario.humanReviewStatus).toBe("approved");
    expect(scenario.episodes).toEqual([]);
    expect(scenario.facts).toEqual([]);
  });

  it("rejects duplicate stable keys in scenario files", () => {
    const scenario = structuredClone(loadSeedLearnerScenario());
    scenario.facts[1].key = scenario.facts[0].key;

    const parsed = seedLearnerScenarioSchema.safeParse(scenario);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toContain("Duplicate fact key");
    }
  });
});

describe("seed learner runner", () => {
  it("writes only fixture identity/problem data into an isolated evaluation DB", async () => {
    const dir = tempDir();
    try {
      const dbPath = join(dir, "seed.db");
      const manifestPath = join(dir, "manifest.json");
      const result = await runSeedLearner({
        scenarioPath: "evals/seed-learner/scenarios/v1-evaluation-fixture.json",
        dbInput: dbPath,
        outPath: manifestPath,
        now: new Date("2026-07-04T12:00:00.000Z"),
      });

      expect(result).toMatchObject({
        factsCount: 0,
        episodesCount: 0,
        staleOrSupersededFactsCount: 0,
        preferenceFactsCount: 0,
        arbitrationUsed: false,
        realLlmCalls: false,
      });
      expect(existsSync(dbPath)).toBe(true);
      expect(existsSync(manifestPath)).toBe(true);

      const manifest = loadSeedLearnerManifest(manifestPath);
      expect(manifest.dbPath).toBe(dbPath);
      expect(manifest.facts).toEqual([]);
      expect(manifest.episodes).toEqual([]);
      expect(manifest.staleFacts).toEqual([]);
      expect(manifest.preferences).toEqual([]);
      expect(manifest.arbitration.used).toBe(false);
      expect(manifest.arbitration.sources).toEqual([]);
      expect(manifest.arbitration.fixtureOnlyWrites).toEqual([]);

      expect(countRows(dbPath, "L2MemoryFact")).toBe(0);
      expect(countRows(dbPath, "MemoryEpisode")).toBe(0);
      expect(countRows(dbPath, "L1MemoryEvent")).toBe(0);
      expect(countRows(dbPath, "memory_fts")).toBe(0);
      expect(countRows(dbPath, "User")).toBe(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("refuses to use the configured development DB as the eval DB", async () => {
    const dir = tempDir();
    try {
      const devDbPath = join(dir, "dev.db");
      writeFileSync(devDbPath, "not a real sqlite db", "utf8");

      await expect(
        runSeedLearner({
          scenarioPath: "evals/seed-learner/scenarios/v1-evaluation-fixture.json",
          dbInput: devDbPath,
          outPath: join(dir, "manifest.json"),
          devDatabaseUrl: `file:${devDbPath}`,
        }),
      ).rejects.toThrow("Refusing to use development DB as eval DB");

      expect(existsSync(join(dir, "manifest.json"))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("fails closed before an evaluation scenario can seed earned memory", async () => {
    const dir = tempDir();
    try {
      await expect(
        runSeedLearner({
          scenarioPath: "evals/seed-learner/scenarios/v1-learner.json",
          dbInput: join(dir, "broken.db"),
          outPath: join(dir, "broken-manifest.json"),
        }),
      ).rejects.toThrow("Evaluation origin cannot seed earned learner memory");
      expect(existsSync(join(dir, "broken.db"))).toBe(false);
      expect(existsSync(join(dir, "broken-manifest.json"))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("validates manifests before writing", async () => {
    const dir = tempDir();
    try {
      const manifestPath = join(dir, "manifest.json");
      await runSeedLearner({
        scenarioPath: "evals/seed-learner/scenarios/v1-evaluation-fixture.json",
        dbInput: join(dir, "seed.db"),
        outPath: manifestPath,
        now: new Date("2026-07-04T12:00:00.000Z"),
      });
      const manifest = loadSeedLearnerManifest(manifestPath);

      expect(() =>
        writeSeedLearnerManifest(join(dir, "bad.json"), {
          ...manifest,
          manifestVersion: "wrong-version",
        } as never),
      ).toThrow();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
