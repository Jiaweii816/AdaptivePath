import { describe, expect, it } from "vitest";
import {
  captureNormalizedTraceEvent,
  collectEnvironmentSecretValues,
  computeTraceEventDigest,
  truncateUtf8HeadTail,
  type PreCaptureTraceEvent,
} from "@/server/observability/runtime-trace-capture";
import { normalizedTraceEventSchema } from "@/server/observability/runtime-trace-contract";

describe("runtime trace capture policy", () => {
  it("deeply redacts named and inline secrets before computing the digest", () => {
    const event = captureNormalizedTraceEvent(
      baseEvent({
        details: {
          input: {
            headers: {
              Authorization: "Bearer auth-token-123",
              Cookie: "LEETCODE_SESSION=leetcode-cookie-secret",
              "x-api-key": "header-api-secret",
            },
            nested: {
              apiKey: "deep-api-secret",
              note: "configured=environment-secret-123",
              inline: "Authorization: Bearer inline-token-456",
            },
          },
          output: {
            answer: "safe answer",
            reasoning_content: "private model chain of thought",
            rawResponse:
              '{"reasoning_content":"private raw reasoning","answer":"ok"}',
          },
        },
        metrics: {
          providerReasoningTokens: 17,
          providerTotalTokens: 42,
        },
      }),
      {
        detailLevel: "full",
        env: { LLM_CHAT_API_KEY: "environment-secret-123" },
        secretValues: ["inline-token-456"],
      },
    );

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("auth-token-123");
    expect(serialized).not.toContain("leetcode-cookie-secret");
    expect(serialized).not.toContain("header-api-secret");
    expect(serialized).not.toContain("deep-api-secret");
    expect(serialized).not.toContain("environment-secret-123");
    expect(serialized).not.toContain("inline-token-456");
    expect(serialized).not.toContain("private model chain of thought");
    expect(serialized).not.toContain("private raw reasoning");
    expect(event.metrics?.providerReasoningTokens).toBe(17);
    expect(event.capture.redactedFields).toEqual(
      expect.arrayContaining([
        '$.details.input.headers["x-api-key"]',
        "$.details.input.headers.Authorization",
        "$.details.input.headers.Cookie",
        "$.details.input.nested.apiKey",
        "$.details.input.nested.inline",
        "$.details.input.nested.note",
        "$.details.output.rawResponse",
        "$.details.output.reasoning_content",
      ]),
    );
    expect(normalizedTraceEventSchema.safeParse(event).success).toBe(true);
  });

  it("discovers only plausibly secret environment values", () => {
    expect(
      collectEnvironmentSecretValues({
        LLM_CHAT_API_KEY: "chat-secret-value",
        LEETCODE_SESSION: "leetcode-session-value",
        AUTH_TOKEN: "short",
        HOME: "/home/iris",
        NODE_ENV: "test",
      }),
    ).toEqual(["chat-secret-value", "leetcode-session-value"]);
  });

  it("keeps non-text thinking mode while redacting reasoning text", () => {
    const event = captureNormalizedTraceEvent(
      baseEvent({
        details: {
          metadata: {
            thinking: true,
            reasoning: "private reasoning text",
          },
        },
      }),
      { detailLevel: "full", env: {} },
    );

    expect(event.details?.metadata?.thinking).toBe(true);
    expect(event.details?.metadata?.reasoning).toBe(
      "[REDACTED: reasoning text not captured]",
    );
  });

  it("truncates multilingual content by UTF-8 bytes with head and tail intact", () => {
    const original = `开头-${"🙂汉字".repeat(80)}-结尾`;
    const truncated = truncateUtf8HeadTail(original, 128);

    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(128);
    expect(truncated).toContain("TRUNCATED");
    expect(truncated.startsWith("开头-")).toBe(true);
    expect(truncated.endsWith("-结尾")).toBe(true);
    expect(truncated).not.toContain("�");
  });

  it("enforces field-aware full-capture limits and records every truncated path", () => {
    const event = captureNormalizedTraceEvent(
      baseEvent({
        scope: {
          path: "practice_run",
          stage: "execution",
          kind: "runner",
          title: "Runner result",
        },
        details: {
          input: {
            code: `def solve():\n${"    pass # 🙂\n".repeat(80)}`,
          },
          output: {
            stdout: `HEAD-${"输出🙂".repeat(80)}-TAIL`,
            stderr: `ERR-${"错误🙂".repeat(80)}-END`,
          },
          retrieval: Array.from({ length: 8 }, (_, index) => ({
            id: `episode-${index}`,
            summary: `${index}:${"记忆🙂".repeat(30)}`,
          })),
        },
      }),
      {
        detailLevel: "full",
        env: {},
        limits: {
          codeSnapshotBytes: 128,
          stdoutBytes: 128,
          stderrBytes: 128,
          retrievalItemCount: 4,
          retrievalItemBytes: 96,
        },
      },
    );

    const details = event.details as {
      input: { code: string };
      output: { stdout: string; stderr: string };
      retrieval: unknown[];
    };
    expect(Buffer.byteLength(details.input.code, "utf8")).toBeLessThanOrEqual(128);
    expect(Buffer.byteLength(details.output.stdout, "utf8")).toBeLessThanOrEqual(128);
    expect(Buffer.byteLength(details.output.stderr, "utf8")).toBeLessThanOrEqual(128);
    expect(details.input.code).toContain("TRUNCATED");
    expect(details.output.stdout).toContain("TRUNCATED");
    expect(details.retrieval).toHaveLength(4);
    expect(details.retrieval[0]).toBeTypeOf("string");
    expect(details.retrieval[2]).toMatchObject({
      traceCaptureElision: expect.stringContaining("RETRIEVAL ITEMS"),
    });
    expect(event.capture.truncatedFields).toEqual(
      expect.arrayContaining([
        "$.details.input.code",
        "$.details.output.stderr",
        "$.details.output.stdout",
        "$.details.retrieval",
        "$.details.retrieval[0]",
      ]),
    );
  });

  it("shares one retrieval item budget across nested hit collections", () => {
    const event = captureNormalizedTraceEvent(
      baseEvent({
        details: {
          retrieval: {
            factHits: Array.from({ length: 30 }, (_, id) => ({ id })),
            episodeHits: Array.from({ length: 30 }, (_, id) => ({ id })),
            kbHits: Array.from({ length: 30 }, (_, id) => ({ id })),
          },
        },
      }),
      {
        detailLevel: "full",
        env: {},
        limits: { retrievalItemCount: 50 },
      },
    );

    const retrieval = event.details?.retrieval as Record<string, unknown[]>;
    const retainedItems = Object.values(retrieval)
      .flat()
      .filter(
        (item) =>
          !item ||
          typeof item !== "object" ||
          !("traceCaptureElision" in item),
      );
    expect(retainedItems.length).toBeLessThanOrEqual(50);
    expect(event.capture.truncatedFields).toEqual(
      expect.arrayContaining([
        "$.details.retrieval.episodeHits",
        "$.details.retrieval.kbHits",
      ]),
    );
  });

  it("keeps role-separated payloads in full capture and shapes summary capture", () => {
    const source = baseEvent({
      details: {
        input: { code: "unique-sensitive-code", language: "Python" },
        prompt: [
          { role: "system", content: "unique-system-prompt", estimatedTokens: 4 },
          { role: "user", content: "unique-user-prompt", estimatedTokens: 4 },
        ],
        output: { raw: "unique-model-output", visible: "safe reply" },
        metadata: { model: "deepseek-chat", nested: { hidden: true } },
      },
    });
    const full = captureNormalizedTraceEvent(source, {
      detailLevel: "full",
      env: {},
    });
    const summary = captureNormalizedTraceEvent(source, {
      detailLevel: "summary",
      env: {},
    });

    expect(full.capture).toMatchObject({
      detailLevel: "full",
      payloadState: "captured",
    });
    expect(JSON.stringify(full.details)).toContain("unique-system-prompt");
    expect(summary.capture).toMatchObject({
      detailLevel: "summary",
      payloadState: "summary_only",
    });
    const serializedSummary = JSON.stringify(summary.details);
    expect(serializedSummary).not.toContain("unique-sensitive-code");
    expect(serializedSummary).not.toContain("unique-system-prompt");
    expect(serializedSummary).not.toContain("unique-user-prompt");
    expect(serializedSummary).not.toContain("unique-model-output");
    expect(summary.details?.metadata).toEqual({ model: "deepseek-chat" });
    expect(summary.identity.eventDigest).not.toBe(full.identity.eventDigest);
  });

  it("uses a canonical post-redaction digest independent of key order and secret value", () => {
    const first = captureNormalizedTraceEvent(
      baseEvent({
        details: {
          input: { z: 1, apiKey: "first-secret", a: 2 },
        },
      }),
      { detailLevel: "full", env: {} },
    );
    const second = captureNormalizedTraceEvent(
      baseEvent({
        details: {
          input: { a: 2, apiKey: "second-secret", z: 1 },
        },
      }),
      { detailLevel: "full", env: {} },
    );

    expect(first.identity.eventDigest).toBe(second.identity.eventDigest);
    expect(first.identity.eventDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(computeTraceEventDigest(first)).toBe(first.identity.eventDigest);
    expect(JSON.stringify(first)).not.toContain("first-secret");
    expect(JSON.stringify(second)).not.toContain("second-secret");
  });

  it("keeps tool call names alive in summary-detail metadata (arguments may be summarized)", () => {
    const source = baseEvent({
      details: {
        metadata: {
          toolCalls: [
            { id: "call-1", name: "verify_proposed_repair", arguments: { code: "print(1)" } },
          ],
        },
      },
    });

    const summary = captureNormalizedTraceEvent(source, {
      detailLevel: "summary",
      env: {},
    });

    const toolCalls = summary.details?.metadata?.toolCalls as
      | Array<{ id?: string; name?: string }>
      | undefined;
    expect(toolCalls?.[0]?.name).toBe("verify_proposed_repair");
    expect(toolCalls?.[0]?.id).toBe("call-1");
    expect(JSON.stringify(summary.details)).not.toContain("print(1)");
  });

  it("limits each prompt message and preserves prompt head/tail under the total cap", () => {
    const event = captureNormalizedTraceEvent(
      baseEvent({
        details: {
          prompt: Array.from({ length: 12 }, (_, index) => ({
            role: index === 0 ? "system" : "user",
            content: `message-${index}-HEAD-${"字🙂".repeat(80)}-TAIL-${index}`,
          })),
        },
      }),
      {
        detailLevel: "full",
        env: {},
        limits: {
          promptMessageBytes: 192,
          promptTotalBytes: 1024,
        },
      },
    );

    const prompt = event.details?.prompt ?? [];
    expect(Buffer.byteLength(JSON.stringify(prompt), "utf8")).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(prompt)).toContain("PROMPT MESSAGES");
    expect(JSON.stringify(prompt[0])).toContain("message-0-HEAD");
    expect(JSON.stringify(prompt.at(-1))).toContain("TAIL-11");
    expect(event.capture.truncatedFields).toContain("$.details.prompt");
  });
});

function baseEvent(
  overrides: Partial<PreCaptureTraceEvent> = {},
): PreCaptureTraceEvent {
  return {
    identity: {
      eventId: "event-capture-1",
      traceRunId: "run-capture-1",
      stepIndex: 1,
      ...overrides.identity,
    },
    scope: overrides.scope ?? {
      path: "review",
      stage: "diagnose_and_coach",
      kind: "llm",
      title: "Diagnose and coach",
    },
    lifecycle: overrides.lifecycle ?? {
      status: "succeeded",
      occurredAt: "2026-07-12T12:00:00.000Z",
      durationMs: 250,
    },
    details: overrides.details,
    metrics: overrides.metrics,
    capture: overrides.capture,
  };
}
