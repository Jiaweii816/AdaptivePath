import { describe, expect, it } from "vitest";
import type { RuntimeTraceExport } from "@/server/observability/runtime-trace-export";
import {
  evaluateTraceArchitectureInvariants,
  type TraceArchitectureInvariantName,
} from "../../evals/runner/trace-architecture-invariants";

describe("runtime trace architecture invariant gates", () => {
  it("passes a complete successful Review with one LLM and runner evidence", () => {
    const artifact = artifactFor(
      [run({ id: "review-root", path: "review", llmCallCount: 1 })],
      [
        event({ id: "runner", runId: "review-root", kind: "runner" }),
        event({ id: "llm-1", runId: "review-root", kind: "llm" }),
      ],
    );

    const report = evaluateTraceArchitectureInvariants(artifact);

    expect(report.passed).toBe(true);
    expect(verdict(report, "review_exactly_one_llm")).toBe("pass");
    expect(verdict(report, "review_runner_present")).toBe("pass");
  });

  it("fails when a second Review LLM event is introduced", () => {
    const artifact = artifactFor(
      [run({ id: "review-root", path: "review", llmCallCount: 2 })],
      [
        event({ id: "runner", runId: "review-root", kind: "runner" }),
        event({ id: "llm-1", runId: "review-root", kind: "llm" }),
        event({ id: "llm-2", runId: "review-root", kind: "llm" }),
      ],
    );

    const report = evaluateTraceArchitectureInvariants(artifact);

    expect(verdict(report, "review_exactly_one_llm")).toBe("fail");
    expect(report.passed).toBe(false);
  });

  it("still gates a guard-degraded Review while allowing a pure runner failure to skip the LLM count", () => {
    const guardDegraded = artifactFor(
      [
        run({
          id: "review-root",
          path: "review",
          status: "degraded",
          llmCallCount: 1,
        }),
      ],
      [
        event({ id: "runner", runId: "review-root", kind: "runner" }),
        event({ id: "llm", runId: "review-root", kind: "llm" }),
      ],
    );
    expect(
      verdict(
        evaluateTraceArchitectureInvariants(guardDegraded),
        "review_exactly_one_llm",
      ),
    ).toBe("pass");

    const runnerFailure = artifactFor(
      [run({ id: "review-root", path: "review", llmCallCount: 0 })],
      [
        event({
          id: "runner-failed",
          runId: "review-root",
          kind: "runner",
          status: "failed",
        }),
      ],
    );
    const failureReport = evaluateTraceArchitectureInvariants(runnerFailure);
    expect(
      failureReport.results.some(
        (result) => result.invariant === "review_exactly_one_llm",
      ),
    ).toBe(false);
    expect(verdict(failureReport, "review_runner_present")).toBe("pass");
  });

  it("turns a dropped event into completeness failure instead of a false pass", () => {
    const artifact = artifactFor(
      [run({ id: "review-root", path: "review", llmCallCount: 2 })],
      [
        event({ id: "runner", runId: "review-root", kind: "runner" }),
        event({ id: "llm-1", runId: "review-root", kind: "llm" }),
      ],
    );

    const report = evaluateTraceArchitectureInvariants(artifact);
    const oneCall = finding(report, "review_exactly_one_llm");

    expect(oneCall.verdict).toBe("fail");
    expect(oneCall.reason).toContain("trace_not_complete");
    expect(oneCall.reason).toContain("llm_rollup_mismatch(2/1)");
  });

  it("fails an over-bound Chat loop", () => {
    const artifact = artifactFor(
      [
        run({
          id: "chat-root",
          path: "chat",
          llmCallCount: 3,
          toolCallCount: 1,
        }),
      ],
      [
        event({ id: "llm-0", runId: "chat-root", kind: "llm", iteration: 0 }),
        event({ id: "tool-2", runId: "chat-root", kind: "tool", iteration: 2 }),
        event({ id: "llm-1", runId: "chat-root", kind: "llm", iteration: 1 }),
        event({ id: "llm-2", runId: "chat-root", kind: "llm", iteration: 2 }),
      ],
    );

    const report = evaluateTraceArchitectureInvariants(artifact, {
      chatMaxToolIterations: 1,
    });

    expect(verdict(report, "chat_tool_loop_bounded")).toBe("fail");
  });

  it("allows multiple Tool Calls in the same legal agent iteration", () => {
    const artifact = artifactFor(
      [
        run({
          id: "chat-root",
          path: "chat",
          llmCallCount: 2,
          toolCallCount: 2,
        }),
      ],
      [
        event({ id: "llm-0", runId: "chat-root", kind: "llm", iteration: 0 }),
        event({ id: "tool-a", runId: "chat-root", kind: "tool", iteration: 1 }),
        event({ id: "tool-b", runId: "chat-root", kind: "tool", iteration: 1 }),
        event({ id: "llm-1", runId: "chat-root", kind: "llm", iteration: 1 }),
      ],
    );

    const report = evaluateTraceArchitectureInvariants(artifact, {
      chatMaxToolIterations: 1,
    });

    expect(verdict(report, "chat_tool_loop_bounded")).toBe("pass");
  });

  it("requires opcode and decision arbitration before each durable L2 write", () => {
    const missing = artifactFor(
      [run({ id: "review-root", path: "review", llmCallCount: 1 })],
      [
        event({ id: "runner", runId: "review-root", kind: "runner" }),
        event({ id: "llm", runId: "review-root", kind: "llm" }),
        event({
          id: "fact-write",
          runId: "review-root",
          kind: "memory",
          metadata: { operation: "chat_consolidation_persistence" },
          output: { acceptedFactIds: ["fact-1"] },
        }),
      ],
    );
    expect(
      verdict(
        evaluateTraceArchitectureInvariants(missing),
        "l2_write_preceded_by_arbitration",
      ),
    ).toBe("fail");

    const valid = artifactFor(
      missing.runs,
      [
        missing.events[0]!,
        missing.events[1]!,
        event({
          id: "arbitration",
          runId: "review-root",
          kind: "memory",
          metadata: {
            operation: "arbitration",
            opcode: "reinforce",
            decision: "pending",
          },
        }),
        missing.events[2]!,
      ],
    );
    expect(
      verdict(
        evaluateTraceArchitectureInvariants(valid),
        "l2_write_preceded_by_arbitration",
      ),
    ).toBe("pass");
  });

  it("gates root invariants on relevant child Run completeness", () => {
    const artifact = artifactFor(
      [
        run({ id: "review-root", path: "review", llmCallCount: 1 }),
        run({
          id: "memory-child",
          path: "memory_background",
          status: "degraded",
          completeness: "incomplete",
          finalFlushAt: null,
          parentTraceRunId: "review-root",
          originatingTraceRunId: "review-root",
        }),
      ],
      [
        event({ id: "runner", runId: "review-root", kind: "runner" }),
        event({ id: "llm", runId: "review-root", kind: "llm" }),
      ],
    );

    const report = evaluateTraceArchitectureInvariants(artifact);

    expect(report.results.every((result) => result.verdict === "fail")).toBe(
      true,
    );
    expect(report.results[0]?.reason).toContain("memory-child:incomplete");
  });
});

function artifactFor(
  runs: RuntimeTraceExport["runs"],
  events: RuntimeTraceExport["events"],
): Pick<RuntimeTraceExport, "runs" | "events"> {
  return { runs, events };
}

function run(overrides: {
  id: string;
  path: RuntimeTraceExport["runs"][number]["path"];
  status?: RuntimeTraceExport["runs"][number]["status"];
  completeness?: RuntimeTraceExport["runs"][number]["traceCompleteness"];
  finalFlushAt?: string | null;
  parentTraceRunId?: string | null;
  originatingTraceRunId?: string | null;
  llmCallCount?: number;
  toolCallCount?: number;
}): RuntimeTraceExport["runs"][number] {
  return {
    id: overrides.id,
    workspaceSessionId: "session-1",
    parentTraceRunId: overrides.parentTraceRunId ?? null,
    originatingTraceRunId: overrides.originatingTraceRunId ?? null,
    turnOrdinal: overrides.parentTraceRunId ? null : 1,
    originatingTurnOrdinal: overrides.parentTraceRunId ? 1 : null,
    path: overrides.path,
    actionKind: overrides.path,
    status: overrides.status ?? "succeeded",
    startedAt: "2026-07-12T12:00:00.000Z",
    endedAt: "2026-07-12T12:00:01.000Z",
    durationMs: 1000,
    providerInputTokens: null,
    providerOutputTokens: null,
    providerTotalTokens: null,
    providerReasoningTokens: null,
    providerCachedTokens: null,
    estimatedCostUsd: null,
    pricingVersion: null,
    pricingStatus: "not_applicable",
    unpricedLlmCallCount: 0,
    llmCallCount: overrides.llmCallCount ?? 0,
    toolCallCount: overrides.toolCallCount ?? 0,
    errorCount: 0,
    traceOverheadMs: 0,
    traceCompleteness: overrides.completeness ?? "complete",
    finalFlushAt:
      overrides.finalFlushAt === undefined
        ? "2026-07-12T12:00:01.000Z"
        : overrides.finalFlushAt,
    reviewAttemptId: null,
    chatSessionId: "chat-1",
    runId: null,
  };
}

function event(args: {
  id: string;
  runId: string;
  kind: RuntimeTraceExport["events"][number]["scope"]["kind"];
  iteration?: number;
  metadata?: Record<string, unknown>;
  output?: unknown;
  status?: RuntimeTraceExport["events"][number]["lifecycle"]["status"];
}): RuntimeTraceExport["events"][number] {
  const isTool = args.kind === "tool";
  return {
    identity: {
      eventId: args.id,
      eventDigest: args.id.padEnd(64, "0").slice(0, 64),
      workspaceSessionId: "session-1",
      traceRunId: args.runId,
      turnOrdinal: args.runId.endsWith("root") ? 1 : undefined,
      agentIteration: args.iteration,
    },
    scope: {
      path: args.runId.startsWith("chat") ? "chat" : "review",
      stage: "test",
      kind: args.kind,
      title: isTool ? "Tool Call · fixture" : `Fixture ${args.kind}`,
    },
    lifecycle: {
      status: args.status ?? (isTool ? "started" : "succeeded"),
      occurredAt: "2026-07-12T12:00:00.000Z",
    },
    details: {
      output: args.output,
      metadata: {
        ...(isTool ? { eventRole: "call" } : {}),
        ...args.metadata,
      },
    },
    capture: { detailLevel: "full", payloadState: "captured" },
  };
}

function finding(
  report: ReturnType<typeof evaluateTraceArchitectureInvariants>,
  invariant: TraceArchitectureInvariantName,
) {
  const result = report.results.find((item) => item.invariant === invariant);
  if (!result) throw new Error(`Missing invariant result ${invariant}.`);
  return result;
}

function verdict(
  report: ReturnType<typeof evaluateTraceArchitectureInvariants>,
  invariant: TraceArchitectureInvariantName,
) {
  return finding(report, invariant).verdict;
}
