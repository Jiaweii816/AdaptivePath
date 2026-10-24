import { describe, expect, it } from "vitest";
import { loadTrajectoryDataset } from "../../evals/runner/trajectory-dataset";
import {
  computeTrajectorySuiteScore,
  findMatchedIntegrationMarkers,
  integrationMarkerMatches,
  isSubsequence,
} from "../../evals/runner/trajectory-metrics";
import {
  renderTrajectorySuiteMarkdown,
  TRAJECTORY_SUITE_NAME,
  type TrajectorySuiteReport,
} from "../../evals/runner/trajectory-report";

const TRAJECTORY_V1_DATASET_PATH =
  "evals/datasets/chat-trajectory/trajectory-v1.json";

function loadV1TrajectoryDataset() {
  return loadTrajectoryDataset({ datasetPath: TRAJECTORY_V1_DATASET_PATH });
}

describe("trajectory eval suite", () => {
  it("loads and validates the trajectory dataset", () => {
    const dataset = loadTrajectoryDataset();

    expect(dataset.datasetVersion).toBe("chat-trajectory-v2");
    expect(dataset.cases).toHaveLength(42);
    expect(dataset.cases.map((item) => item.category)).toEqual(
      expect.arrayContaining([
        "concept_question_no_tool",
        "run_case_requires_run_code",
        "history_question_requires_memory_tool",
        "api_question_requires_lookup_api_reference",
        "preference_requires_note_memory",
        "knowledge_note_requires_save_knowledge_note",
        "practice_request_requires_find_practice_problem",
        "hint_request_requires_algorithm_hint",
        "multi_step_tool_chain",
      ]),
    );
    expect(
      dataset.cases.every((item) => item.humanReviewStatus === "approved"),
    ).toBe(true);
    expect(
      dataset.cases.every((item) => item.intentStyle === "natural_intent"),
    ).toBe(true);
    expect(
      dataset.cases.filter((item) => item.orderedSubsequence.length > 1),
    ).toHaveLength(7);
    expect(
      dataset.cases.find(
        (item) => item.caseId === "traj-v2-natural-multi-debug-run-then-history",
      ),
    ).toMatchObject({
      expectedTools: ["run_current_code", "past_mistake_recall"],
      expectedToolGroups: [],
      orderedSubsequence: [
        "run_current_code",
        "past_mistake_recall",
      ],
    });
    expect(
      dataset.cases.find((item) => item.caseId === "traj-v2-natural-api-deque-for-bfs"),
    ).toMatchObject({
      expectedTools: ["lookup_api_reference"],
      optionalTools: ["save_knowledge_note"],
      orderedSubsequence: ["lookup_api_reference"],
    });

    const coveredTools = new Set(
      dataset.cases.flatMap((item) => [
        ...item.expectedTools,
        ...item.expectedToolGroups.flatMap((group) => group.anyOf),
      ]),
    );

    expect([...coveredTools].sort()).toEqual(
      [
        "find_practice_problem",
        "get_algorithm_hint",
        "lookup_api_reference",
        "note_memory",
        "past_mistake_recall",
        "past_problem_recall",
        "run_current_code",
        "save_knowledge_note",
      ].sort(),
    );
  });

  it("still loads the v1 explicit-instruction seed dataset by override", () => {
    const dataset = loadV1TrajectoryDataset();

    expect(dataset.datasetVersion).toBe("chat-trajectory-v1");
    expect(dataset.cases).toHaveLength(8);
    expect(
      dataset.cases.every((item) => item.intentStyle === "explicit_instruction"),
    ).toBe(true);
  });

  it("keeps mistake, prior-problem, and compound recall intents atomic", () => {
    const dataset = loadTrajectoryDataset();
    const casesById = new Map(
      dataset.cases.map((trajectoryCase) => [
        trajectoryCase.caseId,
        trajectoryCase,
      ]),
    );
    const mistakeOnlyCaseIds = [
      "traj-v2-natural-history-binary-return",
      "traj-v2-natural-history-sliding-left",
      "traj-v2-natural-history-dp-transition",
      "traj-v2-natural-history-api-confusion",
      "traj-v2-natural-multi-history-api",
      "traj-v2-natural-multi-history-api-run",
      "traj-v2-natural-multi-debug-run-then-history",
    ];

    for (const caseId of mistakeOnlyCaseIds) {
      expect(casesById.get(caseId)?.expectedTools).toContain(
        "past_mistake_recall",
      );
      expect(casesById.get(caseId)?.expectedTools).not.toContain(
        "past_problem_recall",
      );
    }

    expect(
      casesById.get("traj-v2-natural-history-similar-problem")?.expectedTools,
    ).toContain("past_problem_recall");
    expect(
      casesById.get("traj-v2-natural-history-similar-problem")?.expectedTools,
    ).not.toContain("past_mistake_recall");
    expect(
      casesById.get("traj-v2-natural-multi-history-run-abba")?.expectedTools,
    ).toEqual(
      expect.arrayContaining([
        "past_problem_recall",
        "past_mistake_recall",
      ]),
    );
    expect(
      dataset.cases.every((trajectoryCase) =>
        trajectoryCase.expectedToolGroups.every(
          (group) =>
            !group.anyOf.includes("past_problem_recall") &&
            !group.anyOf.includes("past_mistake_recall"),
        ),
      ),
    ).toBe(true);
  });

  it("scores expected and forbidden tools deterministically", () => {
    const dataset = loadV1TrajectoryDataset();
    const conceptCase = dataset.cases.find(
      (item) => item.caseId === "traj-v1-concept-no-tool-binary-search",
    );
    const runCase = dataset.cases.find(
      (item) => item.caseId === "traj-v1-run-code-abba",
    );

    if (!conceptCase || !runCase) {
      throw new Error("Missing test cases.");
    }

    const score = computeTrajectorySuiteScore({
      cases: [conceptCase, runCase],
      runs: [
        {
          caseId: conceptCase.caseId,
          repeatIndex: 0,
          category: conceptCase.category,
          toolCalls: [],
          toolResults: [],
          finalReply: "概念解释，不需要工具。",
          failed: false,
        },
        {
          caseId: runCase.caseId,
          repeatIndex: 0,
          category: runCase.category,
          toolCalls: ["run_current_code", "lookup_api_reference"],
          toolResults: [
            { toolName: "run_current_code", status: "ok", errorKind: null },
            { toolName: "lookup_api_reference", status: "ok", errorKind: null },
          ],
          finalReply: "s='abba' 这个 case 失败。",
          failed: false,
        },
      ],
    });

    expect(score.expectedToolMatch).toMatchObject({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
    expect(score.unnecessaryToolCalls).toMatchObject({
      unnecessaryCount: 1,
      totalToolCallCount: 2,
      rate: 0.5,
    });
  });

  it("scores ordered subsequences and wrong order", () => {
    expect(
      isSubsequence(
        ["lookup_api_reference", "save_knowledge_note", "run_current_code"],
        ["lookup_api_reference", "run_current_code"],
      ),
    ).toBe(true);
    expect(
      isSubsequence(
        ["run_current_code", "lookup_api_reference"],
        ["lookup_api_reference", "run_current_code"],
      ),
    ).toBe(false);

    const dataset = loadV1TrajectoryDataset();
    const multiCase = dataset.cases.find(
      (item) => item.caseId === "traj-v1-multistep-api-run",
    );
    if (!multiCase) {
      throw new Error("Missing multi-step case.");
    }

    const score = computeTrajectorySuiteScore({
      cases: [multiCase],
      runs: [
        {
          caseId: multiCase.caseId,
          repeatIndex: 0,
          category: multiCase.category,
          toolCalls: ["run_current_code", "lookup_api_reference"],
          toolResults: [
            { toolName: "run_current_code", status: "ok", errorKind: null },
            { toolName: "lookup_api_reference", status: "ok", errorKind: null },
          ],
          finalReply: "abba and collections both appeared.",
          failed: false,
        },
      ],
    });

    expect(score.multiStepSubsequenceMatch.rate).toBe(0);
    expect(score.wrongOrder).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
  });

  it("scores the atomic mistake-history tool as required and not unnecessary", () => {
    const dataset = loadV1TrajectoryDataset();
    const memoryRunCase = dataset.cases.find(
      (item) => item.caseId === "traj-v1-multistep-memory-run",
    );

    if (!memoryRunCase) {
      throw new Error("Missing memory-run case.");
    }

    const score = computeTrajectorySuiteScore({
      cases: [memoryRunCase],
      runs: [
        {
          caseId: memoryRunCase.caseId,
          repeatIndex: 0,
          category: memoryRunCase.category,
          toolCalls: ["past_mistake_recall", "run_current_code"],
          toolResults: [
            {
              toolName: "past_mistake_recall",
              status: "ok",
              errorKind: null,
            },
            { toolName: "run_current_code", status: "ok", errorKind: null },
          ],
          finalReply: "actual 3",
          failed: false,
        },
      ],
    });

    expect(score.expectedToolMatch.rate).toBe(1);
    expect(score.multiStepSubsequenceMatch.rate).toBe(1);
    expect(score.unnecessaryToolCalls).toMatchObject({
      unnecessaryCount: 0,
      totalToolCallCount: 2,
      rate: 0,
    });
  });

  it("computes invalid args rate only from tool_result error traces", () => {
    const dataset = loadV1TrajectoryDataset();
    const runCase = dataset.cases.find(
      (item) => item.caseId === "traj-v1-run-code-abba",
    );
    if (!runCase) {
      throw new Error("Missing run case.");
    }

    const score = computeTrajectorySuiteScore({
      cases: [runCase],
      runs: [
        {
          caseId: runCase.caseId,
          repeatIndex: 0,
          category: runCase.category,
          toolCalls: ["run_current_code", "run_current_code"],
          toolResults: [
            { toolName: "run_current_code", status: "error", errorKind: "invalid_args" },
            { toolName: "run_current_code", status: "error", errorKind: "handler_error" },
          ],
          finalReply: "",
          failed: true,
        },
      ],
    });

    expect(score.invalidArgs).toMatchObject({
      invalidArgsCount: 1,
      totalToolResultCount: 2,
      rate: 0.5,
    });
  });

  it("checks integration markers with substring, compact, and regex modes", () => {
    expect(
      integrationMarkerMatches("工具返回里有 collections.deque", {
        label: "deque",
        value: "collections",
        match: "case_insensitive_substring",
        source: "tool",
      }),
    ).toBe(true);
    expect(
      integrationMarkerMatches("失败输入 nums = [3, 2, 4]", {
        label: "nums",
        value: "nums=[3,2,4]",
        match: "compact_substring",
        source: "tool",
      }),
    ).toBe(true);
    expect(
      findMatchedIntegrationMarkers("actual 3 expected 2", [
        {
          label: "numbers",
          value: "actual\\s+3",
          match: "regex",
          source: "tool",
        },
      ]),
    ).toEqual(["numbers"]);
  });

  it("renders trajectory metrics, case count, and limitations", () => {
    const dataset = loadV1TrajectoryDataset();
    const score = computeTrajectorySuiteScore({
      cases: [dataset.cases[0]],
      runs: [
        {
          caseId: dataset.cases[0].caseId,
          repeatIndex: 0,
          category: dataset.cases[0].category,
          toolCalls: [],
          toolResults: [],
          finalReply: "概念解释",
          failed: false,
        },
      ],
    });
    const report: TrajectorySuiteReport = {
      suiteName: TRAJECTORY_SUITE_NAME,
      runId: "eval-trajectory-test",
      generatedAt: "2026-07-04T00:00:00.000Z",
      dbPath: "/tmp/eval-trajectory.db",
      dbExplicit: true,
      dbKept: true,
      repeats: 1,
      dataset: {
        name: "trajectory-v1-seed",
        version: "chat-trajectory-v1",
        status: "agent_drafted_needs_human_review",
        caseCount: 1,
        categoryCounts: { concept_question_no_tool: 1 },
        intentStyleCounts: { explicit_instruction: 1 },
        humanReviewPendingCount: 1,
      },
      backgroundJobsPolicy: "disabled",
      traceOptions: { enabled: true },
      successfulRunCount: 1,
      failedRunCount: 0,
      score,
      observability: {
        sampleCounts: {
          reviewPathCount: 0,
          chatPathCount: 1,
          llmCallCount: 1,
          toolCallCount: 0,
        },
        providerUsage: {
          presentCount: 1,
          missingCount: 0,
          missingRate: 0,
        },
        chat: {
          count: 1,
          traceRunCount: 1,
          llmCallCount: 1,
          tokens: {
            usagePresentCount: 1,
            usageMissingCount: 0,
            usageMissingRate: 0,
            inputTokens: { total: 10, avg: 10 },
            outputTokens: { total: 5, avg: 5 },
            totalTokens: { total: 15, avg: 15 },
            estimatedCostUsd: 0.00001,
            unpricedUsageCount: 0,
            pricedUsageCount: 1,
          },
          latency: {
            totalMs: { count: 1, missingCount: 0, p50Ms: 100, p95Ms: 100 },
            llmMsTotal: { count: 1, missingCount: 0, p50Ms: 90, p95Ms: 90 },
          },
          toolCallsPerChat: 0,
        },
        toolCalls: [],
        warningCount: 0,
        warnings: [],
      },
      runs: [],
      failedRuns: [],
      limitations: ["Current dataset is a v1 seed set."],
      warnings: [],
      reportPaths: {
        markdown: "/tmp/report.md",
        json: "/tmp/report.json",
      },
    };

    const markdown = renderTrajectorySuiteMarkdown(report);

    expect(markdown).toContain("expected tool match rate");
    expect(markdown).toContain("Case count: 1");
    expect(markdown).toContain("Current dataset is a v1 seed set.");
  });
});
