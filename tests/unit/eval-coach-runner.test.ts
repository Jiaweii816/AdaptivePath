import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EvalRunnerError,
  runEvalCoach,
} from "../../evals/runner/eval-coach-runner";
import { resolveEvalDatabaseConfig } from "../../evals/runner/db";
import { parseArgs } from "../../evals/runner/cli";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "pc-eval-runner-"));
}

describe("eval coach runner", () => {
  it("runs the placeholder suite and writes a passing report", async () => {
    const dir = tempDir();
    try {
      const report = await runEvalCoach({
        suiteName: "placeholder",
        keepDb: true,
        dbInput: join(dir, "placeholder.db"),
        outputDir: join(dir, "reports"),
        now: new Date(2026, 6, 2, 18, 0, 0),
      });

      expect(report.score).toMatchObject({
        caseCount: 1,
        passCount: 1,
        failCount: 0,
      });
      expect(report.suiteName).toBe("placeholder");
      expect(report.dbKept).toBe(true);
      expect(existsSync(report.dbPath)).toBe(true);
      expect(existsSync(report.reportPaths.markdown)).toBe(true);
      expect(existsSync(report.reportPaths.json)).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects an unknown suite", async () => {
    await expect(
      runEvalCoach({
        suiteName: "does-not-exist",
        outputDir: tempDir(),
      }),
    ).rejects.toThrow("Unknown eval suite: does-not-exist");
  });

  it("keeps the default eval DB path away from the development DB", () => {
    const cwd = "/repo";
    const config = resolveEvalDatabaseConfig({
      suiteName: "placeholder",
      timestamp: new Date(2026, 6, 2, 18, 0, 0),
      cwd,
      devDatabaseUrl: "file:./dev.db",
    });

    expect(config.dbPath).toBe(
      "/repo/evals/tmp/eval-placeholder-20260702-180000.db",
    );
    expect(config.dbPath).not.toBe("/repo/dev.db");
    expect(() =>
      resolveEvalDatabaseConfig({
        suiteName: "placeholder",
        dbInput: "./dev.db",
        timestamp: new Date(2026, 6, 2, 18, 0, 0),
        cwd,
        devDatabaseUrl: "file:./dev.db",
      }),
    ).toThrow("Refusing to use development DB as eval DB");
  });

  it("lets observability read the placeholder seeded trace", async () => {
    const dir = tempDir();
    try {
      const report = await runEvalCoach({
        suiteName: "placeholder",
        keepDb: true,
        dbInput: join(dir, "observability.db"),
        outputDir: join(dir, "reports"),
        now: new Date(2026, 6, 2, 18, 0, 0),
      });

      expect(report.observability.sampleCounts).toMatchObject({
        reviewPathCount: 1,
        chatPathCount: 1,
        llmCallCount: 2,
        toolCallCount: 1,
      });
      expect(report.observability.malformedEventJsonCount).toBe(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("does not silently skip malformed trace rows", async () => {
    const dir = tempDir();
    try {
      let error: unknown;
      try {
        await runEvalCoach({
          suiteName: "placeholder",
          keepDb: true,
          dbInput: join(dir, "malformed.db"),
          outputDir: join(dir, "reports"),
          now: new Date(2026, 6, 2, 18, 0, 0),
          seedOptions: {
            includeMalformedTrace: true,
          },
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(EvalRunnerError);
      expect((error as EvalRunnerError).details.report?.dbKept).toBe(true);
      const report = (error as EvalRunnerError).details.report;
      expect(
        report &&
          "score" in report &&
          "failCount" in report.score
          ? report.score.failCount
          : null,
      ).toBe(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects unknown CLI arguments", () => {
    expect(() => parseArgs(["--suite", "placeholder", "--bogus"])).toThrow(
      "Unknown argument: --bogus",
    );
  });

  it("parses memory ablation citation dataset CLI argument", () => {
    expect(
      parseArgs([
        "--suite",
        "memory-ablation",
        "--dataset",
        "evals/datasets/memory/memory-retrieval-v1.1.json",
        "--citation-dataset",
        "evals/datasets/memory/memory-citation-v1.1.json",
      ]),
    ).toMatchObject({
      suiteName: "memory-ablation",
      datasetPath: "evals/datasets/memory/memory-retrieval-v1.1.json",
      citationDatasetPath: "evals/datasets/memory/memory-citation-v1.1.json",
    });
  });
});
