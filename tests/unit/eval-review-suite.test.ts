import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadReviewDataset } from "../../evals/runner/review-dataset";
import {
  canonicalizeReviewTags,
  computeReviewSuiteScore,
  evidenceMarkerMatchesReply,
  normalizeReviewTags,
} from "../../evals/runner/review-metrics";
import { renderReviewSuiteMarkdown } from "../../evals/runner/review-report";
import { runReviewSuite } from "../../evals/runner/review-suite";
import type {
  CoachProvider,
  CoachReviewInput,
} from "@/server/agents/coach-agent/coach-agent.types";
import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
} from "@/server/llm/trace-context";
import type { CoachDiagnosis } from "@/types/coach";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "pc-eval-review-suite-"));
}

function reviewDatasetPath(fileName: string) {
  return join(process.cwd(), "evals/datasets/review", fileName);
}

function reviewFixtureDir(dirName: string) {
  return join(process.cwd(), "evals/fixtures/run-evidence", dirName);
}

function loadLegacyReviewDataset() {
  return loadReviewDataset({
    datasetPath: reviewDatasetPath("review-v1.json"),
    fixtureDir: reviewFixtureDir("review-v1"),
  });
}

function tagsForSlug(slug: string) {
  switch (slug) {
    case "two-sum":
      return ["missing_search_logic", "hardcoded_answer"];
    case "search-insert-position":
      return ["binary_search_return", "off_by_one"];
    case "longest-substring-without-repeating-characters":
      return ["sliding_window_boundary", "stale_duplicate_boundary"];
    default:
      return [];
  }
}

function replyForSlug(slug: string) {
  switch (slug) {
    case "two-sum":
      return "根因:代码固定返回 [0, 1]。第一个失败证据是 nums = [3, 2, 4], target = 6, expected [1, 2], actual [0, 1]。";
    case "search-insert-position":
      return "根因:边界返回多加了一位。失败证据 nums = [1, 3, 5, 6], target = 2, expected=1, actual=2。";
    case "longest-substring-without-repeating-characters":
      return "根因:left 遇到旧重复字符会回退。失败证据 s='abba', expected=2, actual=3。";
    default:
      return "根因:回放证据显示当前实现失败。";
  }
}

function diagnosisForInput(input: CoachReviewInput): CoachDiagnosis {
  return {
    problemSlug: input.problem.slug,
    runStatus: input.runResult.status,
    userIssueSummary: "Replay evidence exposes the bug.",
    coachSummary: "Use the first failed visible case and make one focused repair.",
    mistakeTags: tagsForSlug(input.problem.slug),
    skillTags: input.problem.tags.map((tag) =>
      tag.toLowerCase().replace(/\W+/g, "_"),
    ),
    selfCheck: null,
    memoryUpdateCandidate: {
      facts: [],
      summary: "Eval-only fake provider summary.",
    },
  };
}

function createFakeReviewProvider(): CoachProvider {
  return {
    async review(input) {
      const step = startTraceStep(input.traceContext, { spanKind: "llm" });
      addTraceLlmMs(input.traceContext, 10);
      await appendLlmCallTrace({
        traceContext: input.traceContext,
        step,
        task: "review.eval_fake",
        model: "deepseek-chat",
        responseModel: "deepseek-chat",
        latencyMs: 10,
        status: "ok",
        finishReason: "stop",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
        },
      });

      return {
        diagnosis: diagnosisForInput(input),
        coachReply: replyForSlug(input.problem.slug),
      };
    },

    async chat() {
      throw new Error("not used");
    },
  };
}

describe("review CoachBench eval", () => {
  it("loads and validates the default review-v1.1 dataset against replay fixtures", () => {
    const dataset = loadReviewDataset();

    expect(dataset.datasetVersion).toBe("review-coachbench-v1.1");
    expect(dataset.cases).toHaveLength(30);
    expect(dataset.cases.every((item) => item.humanReviewStatus === "approved")).toBe(true);
    expect(dataset.cases.every((item) => item.source === "synthetic")).toBe(true);
    expect(dataset.cases[0].fixture.runResult.status).toBe("failed");
    expect(countBy(dataset.cases.map((item) => item.bugCategory))).toMatchObject({
      state_update_order_error: 5,
      binary_search_boundary_invariant_error: 5,
      sliding_window_boundary_error: 5,
      duplicate_or_frequency_count_error: 5,
      boundary_condition_error: 5,
      dp_transition_error: 5,
    });
  });

  it("still loads the legacy review-v1 seed dataset explicitly", () => {
    const dataset = loadLegacyReviewDataset();

    expect(dataset.datasetVersion).toBe("review-coachbench-v1");
    expect(dataset.cases).toHaveLength(3);
    expect(dataset.cases.map((item) => item.caseId).sort()).toEqual([
      "review-v1-longest-substring-duplicate-window-bug",
      "review-v1-search-insert-off-by-one-boundary",
      "review-v1-two-sum-hardcoded-no-search",
    ]);
  });

  it("normalizes tags for exact-match scoring", () => {
    expect(normalizeReviewTags([" b ", "", "a", "b", "a"])).toEqual([
      "a",
      "b",
    ]);
    expect(
      canonicalizeReviewTags({
        bugCategory: "binary_search_return_off_by_one",
        tags: [" binary_search_return ", "off_by_one", "off_by_one"],
      }),
    ).toEqual(["binary_search_return_off_by_one"]);
  });

  it("computes micro-F1 with duplicate tags, empty predictions, and multi-tag cases", () => {
    const dataset = loadLegacyReviewDataset();
    const [first, second] = dataset.cases;
    const score = computeReviewSuiteScore({
      cases: dataset.cases,
      runs: [
        {
          caseId: first.caseId,
          repeatIndex: 0,
          bugCategory: first.bugCategory,
          predictedTags: [first.goldenMistakeTags[0], first.goldenMistakeTags[0], "extra"],
          goldenTags: first.goldenMistakeTags,
          coachReply: "No evidence marker here.",
        },
        {
          caseId: second.caseId,
          repeatIndex: 0,
          bugCategory: second.bugCategory,
          predictedTags: [],
          goldenTags: second.goldenMistakeTags,
          coachReply: "No evidence marker here.",
        },
      ],
    });

    expect(score.micro).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 2,
    });
    expect(score.micro.precision).toBe(0.5);
    expect(score.micro.recall).toBeCloseTo(1 / 3);
    expect(score.micro.f1).toBeCloseTo(0.4);
  });

  it("computes per-category metrics independently", () => {
    const dataset = loadLegacyReviewDataset();
    const [first, second] = dataset.cases;
    const score = computeReviewSuiteScore({
      cases: dataset.cases,
      runs: [
        {
          caseId: first.caseId,
          repeatIndex: 0,
          bugCategory: first.bugCategory,
          predictedTags: first.goldenMistakeTags,
          goldenTags: first.goldenMistakeTags,
          coachReply: replyForSlug(first.fixture.problem.slug),
        },
        {
          caseId: second.caseId,
          repeatIndex: 0,
          bugCategory: second.bugCategory,
          predictedTags: ["wrong_tag"],
          goldenTags: second.goldenMistakeTags,
          coachReply: replyForSlug(second.fixture.problem.slug),
        },
      ],
    });

    const perfectCategory = score.perBugCategory.find(
      (item) => item.bugCategory === first.bugCategory,
    );
    const missedCategory = score.perBugCategory.find(
      (item) => item.bugCategory === second.bugCategory,
    );

    expect(perfectCategory?.f1).toBe(1);
    expect(missedCategory).toMatchObject({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 1,
      f1: 0,
    });
  });

  it("checks evidence markers without relying on line numbers", () => {
    expect(
      evidenceMarkerMatchesReply("失败用例 nums = [3, 2, 4], target = 6", {
        label: "input",
        value: "nums=[3,2,4]",
        match: "compact_substring",
      }),
    ).toBe(true);
    expect(
      evidenceMarkerMatchesReply("失败用例是 s='abba'", {
        label: "input",
        value: "ABBA",
        match: "case_insensitive_substring",
      }),
    ).toBe(true);
    expect(
      evidenceMarkerMatchesReply("泛泛而谈，没有证据字段", {
        label: "input",
        value: "nums=[3,2,4]",
        match: "compact_substring",
      }),
    ).toBe(false);
  });

  it("runs the review suite with a fake provider and writes a report", async () => {
    const dir = tempDir();

    try {
      const report = await runReviewSuite({
        provider: createFakeReviewProvider(),
        datasetPath: reviewDatasetPath("review-v1.json"),
        fixtureDir: reviewFixtureDir("review-v1"),
        repeats: 1,
        keepDb: true,
        dbInput: join(dir, "review.db"),
        outputDir: join(dir, "reports"),
        now: new Date(2026, 6, 3, 12, 0, 0),
      });

      expect(report.suiteName).toBe("review");
      expect(report.dataset.caseCount).toBe(3);
      expect(report.score.micro.f1).toBe(1);
      expect(report.score.evidenceGrounded.rate).toBe(1);
      expect(report.failedRuns).toHaveLength(0);
      expect(report.observability.providerUsage.missingCount).toBe(0);
      expect(existsSync(report.reportPaths.markdown)).toBe(true);
      expect(existsSync(report.reportPaths.json)).toBe(true);

      const markdown = readFileSync(report.reportPaths.markdown, "utf8");
      expect(markdown).toContain("Diagnosis Tag Micro-F1");
      expect(markdown).toContain("Case count: 3");
      expect(markdown).toContain("Golden labels were agent-drafted");
      expect(renderReviewSuiteMarkdown(report)).toContain("Evidence-Grounded Reply Rate");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects invalid repeats and record mode explicitly", async () => {
    await expect(
      runReviewSuite({
        provider: createFakeReviewProvider(),
        repeats: 0,
      }),
    ).rejects.toThrow("--repeats must be a positive integer");

    await expect(
      runReviewSuite({
        provider: createFakeReviewProvider(),
        recordRunEvidence: true,
      }),
    ).rejects.toThrow("Record mode is not implemented");
  });
});

function countBy(values: string[]) {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}
