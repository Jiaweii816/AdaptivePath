import type OpenAI from "openai";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTwoCallReviewProvider } from "../../evals/experiments/two-call-review-provider";
import { parseArgs } from "../../evals/runner/cli";
import {
  EvalRunnerError,
  runEvalCoach,
} from "../../evals/runner/eval-coach-runner";
import { loadReviewReplayCases } from "../../evals/runner/replay-run-evidence";
import {
  computeDiagnosisTagStability,
  computeMutualDiagnosisTagConsistency,
} from "../../evals/runner/review-comparison-metrics";
import {
  DIAGNOSIS_F1_LIMITATION,
  SMALL_SAMPLE_LIMITATION,
} from "../../evals/runner/review-comparison-report";
import {
  resolveReviewComparisonArmDbConfigs,
  runReviewComparisonSuite,
} from "../../evals/runner/review-comparison-suite";
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
import {
  createTestForegroundTraceContext,
  createMemoryTestDb,
  seedMinimalUserAndProblem,
} from "./memory-test-helpers";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "pc-eval-review-"));
}

function baseDiagnosis(input: CoachReviewInput, tags: string[]): CoachDiagnosis {
  return {
    problemSlug: input.problem.slug,
    runStatus: input.runResult.status,
    userIssueSummary: "Visible replay evidence shows a deterministic bug.",
    coachSummary: "Use the first failed visible case to repair the current approach.",
    mistakeTags: tags,
    skillTags: input.problem.tags.map((tag) => tag.toLowerCase().replace(/\W+/g, "_")),
    selfCheck: null,
    memoryUpdateCandidate: {
      facts: [],
      summary: "Eval-only fake provider summary.",
    },
  };
}

function reviewInputFromFirstFixture(
  traceContext?: CoachReviewInput["traceContext"],
): CoachReviewInput {
  const reviewCase = loadReviewReplayCases()[0];

  return {
    problem: reviewCase.problem,
    user: {
      displayName: "Eval Learner",
      strongPatterns: [],
      weakPatterns: [],
      outputPreferences: [],
    },
    memory: {
      profileId: "eval-review-comparison",
      teachableMemories: [],
      outputPreferences: [],
      domainReferences: [],
      retrievalStatus: "lexical_only",
    },
    language: reviewCase.language,
    code: reviewCase.code,
    runResult: reviewCase.runResult,
    evidenceVerdict: reviewCase.evidenceVerdict,
    userQuestion: reviewCase.userQuestion,
    userState: reviewCase.userState,
    responseLanguage: "zh",
    traceContext,
  };
}

function createTracingFakeProvider(tags: string[]): CoachProvider {
  return {
    async review(input) {
      const step = startTraceStep(input.traceContext, { spanKind: "llm" });
      addTraceLlmMs(input.traceContext, 25);
      await appendLlmCallTrace({
        traceContext: input.traceContext,
        step,
        task: "review.eval_fake",
        model: "deepseek-chat",
        responseModel: "deepseek-chat",
        latencyMs: 25,
        status: "ok",
        finishReason: "stop",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
        },
      });

      return {
        diagnosis: baseDiagnosis(input, tags),
        coachReply: "根因:可见回放用例暴露了当前实现的局部错误。先修第一个失败用例,再重跑同一组回放证据。",
      };
    },

    async chat() {
      throw new Error("not used");
    },
  };
}

describe("review comparison eval", () => {
  it("loads replay fixtures with normalized run evidence", () => {
    const cases = loadReviewReplayCases();

    expect(cases).toHaveLength(3);
    expect(cases.map((reviewCase) => reviewCase.id).sort()).toEqual([
      "review-v1-longest-substring-duplicate-window-bug",
      "review-v1-search-insert-off-by-one-boundary",
      "review-v1-two-sum-hardcoded-no-search",
    ]);
    expect(cases[0].runResult.status).toBe("failed");
    expect(cases[0].evidenceVerdict.status).toBe(cases[0].runResult.status);
    expect(cases[0].injectedBugLabel).toContain(cases[0].case.bugPattern);
  });

  it("emits two llm_call traces from the eval-only two-call provider", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem, chatSession } = await seedMinimalUserAndProblem(
        db.prisma,
      );
      const traceContext = await createTestForegroundTraceContext({
        prisma: db.prisma,
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        path: "review",
        task: "review.two_call",
        traceRunId: "two-call-test-trace",
      });
      const input = reviewInputFromFirstFixture(traceContext);
      const diagnosis = baseDiagnosis(input, ["binary_search_boundary"]);
      const create = vi
        .fn()
        .mockResolvedValueOnce({
          model: "deepseek-chat",
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(diagnosis) },
            },
          ],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 10,
            total_tokens: 60,
          },
        })
        .mockResolvedValueOnce({
          model: "deepseek-chat",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  "根因:边界更新偏了一位。走第一个失败用例定位变量,只改返回边界后重跑。",
              },
            },
          ],
          usage: {
            prompt_tokens: 70,
            completion_tokens: 20,
            total_tokens: 90,
          },
        });
      const fakeClient = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      const provider = createTwoCallReviewProvider({
        reviewClient: fakeClient,
        reviewModel: "deepseek-chat",
      });

      await provider.review(input);

      const rows = await loadFormalTraceProjection(db.prisma, {
        eventTypes: ["llm_call"],
        order: "asc",
      });

      expect(create).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => JSON.parse(row.eventJson).task)).toEqual([
        "review.two_call.diagnose",
        "review.two_call.reply",
      ]);
      expect(rows.map((row) => JSON.parse(row.eventJson).stepIndex)).toEqual([
        1,
        2,
      ]);
    } finally {
      await db.cleanup();
    }
  });

  it("computes per-arm diagnosis tag stability", () => {
    expect(
      computeDiagnosisTagStability([
        { caseId: "a", repeatIndex: 0, mistakeTags: ["x", "y"] },
        { caseId: "a", repeatIndex: 1, mistakeTags: ["y", "x"] },
        { caseId: "b", repeatIndex: 0, mistakeTags: ["z"] },
        { caseId: "b", repeatIndex: 1, mistakeTags: ["other"] },
      ]),
    ).toMatchObject({
      matchingComparisons: 3,
      totalComparisons: 4,
      rate: 0.75,
    });
  });

  it("computes mutual diagnosis tag consistency", () => {
    expect(
      computeMutualDiagnosisTagConsistency({
        oneCallRuns: [
          { caseId: "a", repeatIndex: 0, mistakeTags: ["x"] },
          { caseId: "b", repeatIndex: 0, mistakeTags: ["y"] },
        ],
        twoCallRuns: [
          { caseId: "a", repeatIndex: 0, mistakeTags: ["x"] },
          { caseId: "b", repeatIndex: 0, mistakeTags: ["z"] },
        ],
      }),
    ).toMatchObject({
      matchingComparisons: 1,
      totalComparisons: 2,
      rate: 0.5,
    });
  });

  it("runs the suite with isolated arm DBs and writes the limitation to reports", async () => {
    const dir = tempDir();

    try {
      const report = await runReviewComparisonSuite({
        keepDb: true,
        dbInput: join(dir, "review-comparison"),
        outputDir: join(dir, "reports"),
        now: new Date(2026, 6, 2, 18, 0, 0),
        repeats: 1,
        providers: {
          "one-call": createTracingFakeProvider(["boundary_bug"]),
          "two-call": createTracingFakeProvider(["boundary_bug"]),
        },
      });

      expect(report.arms["one-call"].dbPath).not.toBe(
        report.arms["two-call"].dbPath,
      );
      expect(existsSync(report.arms["one-call"].dbPath)).toBe(true);
      expect(existsSync(report.arms["two-call"].dbPath)).toBe(true);
      expect(report.arms["one-call"].observabilitySampleCounts).toMatchObject({
        reviewPathCount: 3,
        llmCallCount: 3,
      });
      expect(report.mutualDiagnosisTagConsistency.rate).toBe(1);
      expect(readFileSync(report.reportPaths.markdown, "utf8")).toContain(
        DIAGNOSIS_F1_LIMITATION,
      );
      expect(readFileSync(report.reportPaths.markdown, "utf8")).toContain(
        "Small replay sample caveat",
      );
      expect(readFileSync(report.reportPaths.json, "utf8")).toContain(
        DIAGNOSIS_F1_LIMITATION,
      );
      expect(readFileSync(report.reportPaths.json, "utf8")).toContain(
        SMALL_SAMPLE_LIMITATION,
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("records failed case/repeat runs instead of silently skipping them", async () => {
    const dir = tempDir();
    const failingProvider: CoachProvider = {
      async review() {
        throw new Error("intentional eval provider failure");
      },
      async chat() {
        throw new Error("not used");
      },
    };

    try {
      const report = await runReviewComparisonSuite({
        keepDb: true,
        dbInput: join(dir, "failed-review-comparison"),
        outputDir: join(dir, "reports"),
        now: new Date(2026, 6, 2, 18, 0, 0),
        repeats: 1,
        providers: {
          "one-call": failingProvider,
          "two-call": createTracingFakeProvider(["boundary_bug"]),
        },
      });

      expect(report.failedRuns).toHaveLength(3);
      expect(report.warnings).toContain("3 case/repeat runs failed.");
      expect(existsSync(report.reportPaths.markdown)).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects unknown suite and invalid repeats", async () => {
    await expect(
      runEvalCoach({
        suiteName: "not-a-suite",
        outputDir: tempDir(),
      }),
    ).rejects.toThrow(EvalRunnerError);

    expect(() =>
      parseArgs([
        "--suite",
        "review-1call-vs-2call",
        "--repeats",
        "0",
      ]),
    ).toThrow("--repeats must be a positive integer.");
  });

  it("resolves one-call and two-call DBs to different paths", () => {
    const dir = tempDir();

    try {
      const configs = resolveReviewComparisonArmDbConfigs({
        dbInput: join(dir, "arms"),
        timestamp: new Date(2026, 6, 2, 18, 0, 0),
      });

      expect(configs["one-call"].dbPath).not.toBe(configs["two-call"].dbPath);
      expect(configs["one-call"].dbPath).toContain("one-call.db");
      expect(configs["two-call"].dbPath).toContain("two-call.db");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
