import { describe, expect, it } from "vitest";
import {
  buildAgentObservabilityReport,
  computePercentile,
  groupEventsByTraceRunId,
  summarizeTokenCost,
  type AgentObservabilityTraceRow,
} from "@/server/observability/agent-observability";
import {
  renderAgentObservabilityJson,
  renderAgentObservabilityMarkdown,
} from "@/server/observability/agent-observability-report";

const baseDate = new Date("2026-07-02T12:00:00.000Z");

function row(
  index: number,
  input: Partial<Omit<AgentObservabilityTraceRow, "eventJson" | "eventType">> & {
    eventType: string;
    eventJson?: unknown;
    rawEventJson?: string;
  },
): AgentObservabilityTraceRow {
  const { eventJson, rawEventJson, eventType, ...rowInput } = input;

  return {
    id: `row-${index}`,
    userId: "user-1",
    problemId: "problem-1",
    chatSessionId: "chat-1",
    reviewAttemptId: null,
    eventType,
    eventJson:
      rawEventJson ??
      JSON.stringify(eventJson ?? {}),
    content: null,
    source: null,
    occurredAt: new Date(baseDate.getTime() + index * 1000),
    createdAt: new Date(baseDate.getTime() + index * 1000),
    ...rowInput,
  };
}

describe("agent observability", () => {
  it("computes nearest-rank percentiles", () => {
    expect(computePercentile([], 50)).toBeNull();
    expect(computePercentile([100, 200, 300], 50)).toBe(200);
    expect(computePercentile([100, 200, 300, 400], 95)).toBe(400);
  });

  it("aggregates usage-present cost while keeping missing usage out of totals", () => {
    const summary = summarizeTokenCost([
      {
        model: "deepseek-chat",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        usageMissing: false,
      },
      {
        model: "deepseek-chat",
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        usageMissing: true,
      },
    ]);

    expect(summary.usagePresentCount).toBe(1);
    expect(summary.usageMissingCount).toBe(1);
    expect(summary.inputTokens.total).toBe(1000);
    expect(summary.outputTokens.total).toBe(500);
    expect(summary.totalTokens.total).toBe(1500);
    expect(summary.estimatedCostUsd).toBeCloseTo(0.00028);

    const zeroSummary = summarizeTokenCost([
      {
        model: "deepseek-chat",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        usageMissing: false,
      },
    ]);

    expect(zeroSummary.usagePresentCount).toBe(1);
    expect(zeroSummary.usageMissingCount).toBe(0);
    expect(zeroSummary.totalTokens.total).toBe(0);
    expect(zeroSummary.estimatedCostUsd).toBe(0);
  });

  it("groups path costs by traceRunId instead of reviewAttemptId", () => {
    const report = buildAgentObservabilityReport({
      dbPath: "/tmp/dev.db",
      explicitDb: false,
      generatedAt: baseDate,
      rows: [
        row(1, {
          eventType: "coach_reply",
          reviewAttemptId: "review-1",
          eventJson: {
            traceRunId: "trace-a",
            timings: { totalMs: 1000, runnerMs: 100, llmMsTotal: 800 },
          },
        }),
        row(2, {
          eventType: "coach_reply",
          reviewAttemptId: "review-2",
          eventJson: {
            traceRunId: "trace-b",
            timings: { totalMs: 2000, runnerMs: 200, llmMsTotal: 1600 },
          },
        }),
        row(3, {
          eventType: "llm_call",
          reviewAttemptId: null,
          source: "review:review.diagnose_and_reply",
          eventJson: {
            traceRunId: "trace-a",
            path: "review",
            task: "review.diagnose_and_reply",
            model: "deepseek-chat",
            responseModel: "deepseek-chat",
            status: "ok",
            latencyMs: 800,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            usageSource: "provider",
          },
        }),
      ],
    });

    expect(report.review.count).toBe(2);
    expect(report.review.traceRunCount).toBe(2);
    expect(report.review.llmCallCount).toBe(1);
    expect(report.review.tokens.inputTokens.total).toBe(10);
  });

  it("exports a traceRunId grouping helper", () => {
    const grouped = groupEventsByTraceRunId([
      { traceRunId: "a", value: 1 },
      { traceRunId: null, value: 2 },
      { traceRunId: "a", value: 3 },
      { traceRunId: "b", value: 4 },
    ]);

    expect(grouped.get("a")?.map((event) => event.value)).toEqual([1, 3]);
    expect(grouped.get("b")?.map((event) => event.value)).toEqual([4]);
    expect(grouped.has("")).toBe(false);
  });

  it("counts malformed eventJson without crashing the report", () => {
    const report = buildAgentObservabilityReport({
      dbPath: "/tmp/dev.db",
      explicitDb: true,
      generatedAt: baseDate,
      rows: [
        row(1, {
          eventType: "llm_call",
          rawEventJson: "{not json",
        }),
      ],
    });

    expect(report.malformedEventJsonCount).toBe(1);
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.sampleCounts.llmCallCount).toBe(1);
  });

  it("includes mock interview and memory LLM traces without missing traceRunId warnings", () => {
    const report = buildAgentObservabilityReport({
      dbPath: "/tmp/dev.db",
      explicitDb: false,
      generatedAt: baseDate,
      rows: [
        row(1, {
          eventType: "llm_call",
          source: "mock_interview:mock_interview.start",
          eventJson: {
            traceRunId: "mock-trace",
            path: "mock_interview",
            task: "mock_interview.start",
            model: "deepseek-chat",
            responseModel: "deepseek-chat",
            status: "ok",
            latencyMs: 123,
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
            usageSource: "provider",
          },
        }),
        row(2, {
          eventType: "llm_call",
          source: "memory_agent:reflect",
          eventJson: {
            traceRunId: "memory-trace",
            path: "memory",
            task: "memory.reflect",
            model: "qwen3-8b",
            responseModel: "qwen3-8b",
            status: "ok",
            latencyMs: 80,
            usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
            usageSource: "provider",
          },
        }),
      ],
    });

    expect(report.sampleCounts.llmCallCount).toBe(2);
    expect(report.providerUsage.missingCount).toBe(0);
    expect(
      report.llmCalls.find(
        (group) =>
          group.path === "mock_interview" &&
          group.task === "mock_interview.start",
      )?.count,
    ).toBe(1);
    expect(
      report.llmCalls.find(
        (group) => group.path === "memory" && group.task === "memory.reflect",
      )?.count,
    ).toBe(1);
    expect(report.warnings.join("\n")).not.toContain("missing traceRunId");
  });

  it("aggregates tool errors and invalid args rate by toolName", () => {
    const report = buildAgentObservabilityReport({
      dbPath: "/tmp/dev.db",
      explicitDb: false,
      generatedAt: baseDate,
      rows: [
        row(1, {
          eventType: "chat_reply",
          eventJson: {
            traceRunId: "chat-trace",
            timings: { totalMs: 3000, llmMsTotal: 2500, toolMsTotal: 100 },
          },
        }),
        row(2, {
          eventType: "tool_call",
          eventJson: {
            traceRunId: "chat-trace",
            toolName: "run_code",
          },
        }),
        row(3, {
          eventType: "tool_result",
          eventJson: {
            traceRunId: "chat-trace",
            toolName: "run_code",
            status: "error",
            errorKind: "invalid_args",
            latencyMs: 12,
          },
        }),
        row(4, {
          eventType: "tool_call",
          eventJson: {
            traceRunId: "chat-trace",
            toolName: "lookup_api_reference",
          },
        }),
        row(5, {
          eventType: "tool_result",
          eventJson: {
            traceRunId: "chat-trace",
            toolName: "lookup_api_reference",
            status: "ok",
            latencyMs: 20,
            approxResultTokens: 40,
          },
        }),
      ],
    });

    const runCode = report.toolCalls.find((group) => group.toolName === "run_code");
    const lookup = report.toolCalls.find(
      (group) => group.toolName === "lookup_api_reference",
    );

    expect(runCode).toMatchObject({
      callCount: 1,
      successCount: 0,
      errorCount: 1,
      invalidArgsCount: 1,
    });
    expect(runCode?.errorKindBreakdown.invalid_args).toBe(1);
    expect(runCode?.invalidArgsRate).toBe(1);
    expect(lookup?.avgApproxResultTokens).toBe(40);
    expect(report.chat.toolCallsPerChat).toBe(2);
  });

  it("renders markdown and JSON with required header fields", () => {
    const report = buildAgentObservabilityReport({
      dbPath: "/repo/dev.db",
      explicitDb: true,
      generatedAt: baseDate,
      rows: [
        row(1, {
          eventType: "coach_reply",
          eventJson: {
            traceRunId: "review-trace",
            timings: { totalMs: 1000, runnerMs: 100, llmMsTotal: 700 },
          },
        }),
        row(2, {
          eventType: "llm_call",
          eventJson: {
            traceRunId: "review-trace",
            path: "review",
            task: "review.diagnose_and_reply",
            model: "deepseek-chat",
            responseModel: "deepseek-chat",
            status: "ok",
            latencyMs: 700,
            usage: null,
            usageSource: "missing",
            usageMissingReason: "provider_omitted",
          },
        }),
      ],
    });

    const markdown = renderAgentObservabilityMarkdown(report);
    const parsedJson = JSON.parse(renderAgentObservabilityJson(report));

    expect(markdown).toContain("- DB path: /repo/dev.db");
    expect(markdown).toContain("- Explicit --db: yes");
    expect(markdown).toContain("- Review path count: 1");
    expect(markdown).toContain("- Provider usage missing rate: 1/1 (100.0%)");
    expect(parsedJson.db.path).toBe("/repo/dev.db");
    expect(parsedJson.sampleCounts.reviewPathCount).toBe(1);
  });
});
