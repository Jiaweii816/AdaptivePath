import { describe, expect, it } from "vitest";
import {
  BACKGROUND_JOB_FAILURE_REASONS,
  BACKGROUND_JOB_STATUSES,
  EVENT_KINDS,
  EVENT_STATUSES,
  PAYLOAD_STATES,
  PRICING_STATUSES,
  RUN_STATUSES,
  SESSION_BACKGROUND_STATUSES,
  SESSION_FOREGROUND_STATUSES,
  TRACE_COMPLETENESS_STATES,
  canTransitionBackgroundJobStatus,
  canTransitionEventStatus,
  canTransitionPayloadState,
  canTransitionRunStatus,
  canTransitionSessionBackgroundStatus,
  canTransitionSessionForegroundStatus,
  canTransitionTraceCompleteness,
  normalizedTraceEventSchema,
} from "@/server/observability/runtime-trace-contract";

describe("runtime trace frozen contract", () => {
  it("freezes every v3 enum in one executable owner", () => {
    expect(SESSION_FOREGROUND_STATUSES).toEqual(["active", "closed", "abandoned"]);
    expect(SESSION_BACKGROUND_STATUSES).toEqual(["idle", "pending", "settled", "failed"]);
    expect(RUN_STATUSES).toEqual(["running", "succeeded", "failed", "degraded"]);
    expect(TRACE_COMPLETENESS_STATES).toEqual(["open", "complete", "degraded", "incomplete"]);
    expect(EVENT_KINDS).toEqual([
      "user_input", "workspace_snapshot", "llm", "tool", "runner", "retrieval",
      "memory", "guard", "persistence", "lifecycle", "background_job", "error",
    ]);
    expect(EVENT_STATUSES).toEqual(["started", "succeeded", "failed", "degraded", "skipped"]);
    expect(BACKGROUND_JOB_STATUSES).toEqual(["pending", "running", "succeeded", "failed"]);
    expect(BACKGROUND_JOB_FAILURE_REASONS).toEqual(["process_restart", "timeout", "error"]);
    expect(PAYLOAD_STATES).toEqual(["captured", "summary_only", "pruned", "unavailable"]);
    expect(PRICING_STATUSES).toEqual(["priced", "partial", "unpriced", "not_applicable"]);
  });

  it.each([
    ["foreground", canTransitionSessionForegroundStatus, "active", "closed", true],
    ["foreground", canTransitionSessionForegroundStatus, "active", "abandoned", true],
    ["foreground", canTransitionSessionForegroundStatus, "closed", "active", false],
    ["session background", canTransitionSessionBackgroundStatus, "idle", "pending", true],
    ["session background", canTransitionSessionBackgroundStatus, "pending", "settled", true],
    ["session background", canTransitionSessionBackgroundStatus, "pending", "failed", true],
    ["session background", canTransitionSessionBackgroundStatus, "settled", "pending", true],
    ["session background", canTransitionSessionBackgroundStatus, "failed", "settled", false],
    ["run", canTransitionRunStatus, "running", "succeeded", true],
    ["run", canTransitionRunStatus, "succeeded", "degraded", true],
    ["run", canTransitionRunStatus, "failed", "running", false],
    ["completeness", canTransitionTraceCompleteness, "open", "complete", true],
    ["completeness", canTransitionTraceCompleteness, "complete", "degraded", true],
    ["completeness", canTransitionTraceCompleteness, "incomplete", "complete", false],
    ["event", canTransitionEventStatus, "started", "skipped", true],
    ["event", canTransitionEventStatus, "succeeded", "failed", false],
    ["job", canTransitionBackgroundJobStatus, "pending", "running", true],
    ["job", canTransitionBackgroundJobStatus, "pending", "failed", true],
    ["job", canTransitionBackgroundJobStatus, "running", "succeeded", true],
    ["job", canTransitionBackgroundJobStatus, "failed", "succeeded", false],
    ["payload", canTransitionPayloadState, "captured", "pruned", true],
    ["payload", canTransitionPayloadState, "summary_only", "pruned", true],
    ["payload", canTransitionPayloadState, "pruned", "captured", false],
  ] as const)("checks %s transition %s -> %s", (_label, transition, from, to, expected) => {
    expect(transition(from as never, to as never)).toBe(expected);
    expect(transition(from as never, from as never)).toBe(true);
  });

  it("validates the normalized event envelope without a workspace session", () => {
    const event = normalizedTraceEventSchema.parse({
      identity: {
        eventId: "legacy:l1:mock",
        eventDigest: "a".repeat(64),
        traceRunId: "legacy:run:mock",
      },
      scope: {
        path: "mock_interview",
        stage: "legacy_llm",
        kind: "llm",
        title: "Legacy LLM call",
      },
      lifecycle: {
        status: "succeeded",
        occurredAt: "2026-07-12T12:00:00.000Z",
      },
      capture: { detailLevel: "summary", payloadState: "summary_only" },
    });

    expect(event.identity.workspaceSessionId).toBeUndefined();
  });
});
