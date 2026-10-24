import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "patterncoach.runtime-trace.browser-instance.v1",
      "trace-e2e-browser-instance",
    );
  });
  await installRuntimeTraceFixture(page);
});

test("Runtime Trace drawer preserves its diagnostic state and renders all views", async ({
  page,
}) => {
  await page.goto("/workbench?problem=two-sum&language=Python");

  const capsule = page.getByRole("button", {
    name: /Open runtime trace/i,
  });
  await expect(capsule).toBeVisible();
  await capsule.click();
  const traceLabel = page.getByText("Trace · 31", { exact: true });
  await expect(traceLabel).toBeVisible({
    timeout: 10_000,
  });

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("heading", { name: "运行日志 · Two Sum" }),
  ).toBeVisible();
  const summary = drawer.getByRole("region", { name: "Trace session summary" });
  await expect(summary.getByText("Agent busy")).toBeVisible();

  const turn = drawer.getByRole("button", { name: /Turn 1.*Review/i });
  await expect(turn).toHaveAttribute("aria-expanded", "true");
  await expect(drawer.getByText("review this code")).toBeVisible();

  await turn.click();
  await expect(turn).toHaveAttribute("aria-expanded", "false");
  await drawer.getByRole("button", { name: "Close runtime trace" }).click();
  await expect(drawer).toBeHidden();
  await capsule.click();
  await expect(turn).toHaveAttribute("aria-expanded", "false");

  await drawer.getByRole("tab", { name: "metrics" }).click();
  await expect(drawer.getByText("Provider token ledger")).toBeVisible();
  await expect(drawer.getByText("$0.000500").first()).toBeVisible();

  await drawer.getByRole("tab", { name: "raw" }).click();
  await drawer
    .getByLabel("Select a Runtime Trace event")
    .selectOption("trace-event-1");
  await expect(
    drawer.getByRole("region", { name: /Normalized JSON for Diagnose & Coach/ }),
  ).toBeVisible();
  await expect(drawer.getByText(/"providerCachedTokens": 20/)).toBeVisible();

  await drawer.getByRole("button", { name: "History" }).click();
  await drawer.getByRole("tab", { name: "timeline" }).click();
  const history = drawer.getByTestId("runtime-trace-history");
  await expect(history.getByText("Session history")).toBeVisible();
  await expect(history.getByText("Payload pruned")).toBeVisible();
  await expect(history.getByText("Closed · background settled")).toBeVisible();
});

test("Runtime Trace drawer is full-width and keyboard reachable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workbench?problem=two-sum&language=Python");
  await page.getByRole("button", { name: /Open runtime trace/i }).click();

  const box = await page.getByRole("dialog").boundingBox();
  expect(box?.x).toBe(0);
  expect(Math.round(box?.width ?? 0)).toBe(390);
  await expect(
    page.getByRole("button", { name: "Close runtime trace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("separator", { name: "Resize runtime trace drawer" }),
  ).toBeHidden();
});

async function installRuntimeTraceFixture(page: Page) {
  await page.route("**/api/trace/session?*", async (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get("view") ?? "current";
    if (view === "history") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [historySession()],
          nextCursor: null,
          hasMore: false,
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(tracePage()),
    });
  });
}

function tracePage() {
  const events = Array.from({ length: 31 }, (_, index) =>
    traceEvent(index + 1),
  );
  return {
    session: session(),
    turns: [
      {
        turnOrdinal: 1,
        traceRunId: "trace-run-1",
        path: "review",
        actionKind: "review",
        status: "succeeded",
        traceCompleteness: "complete",
        startedAt: "2026-07-12T12:00:01.000Z",
        endedAt: "2026-07-12T12:00:03.000Z",
        durationMs: 2_000,
      },
    ],
    runs: [traceRun()],
    events,
    nextSeq: 31,
    highWaterSeq: 31,
    hasMore: false,
    hasActiveTurn: false,
    backgroundStatus: "settled",
  };
}

function session() {
  return {
    id: "runtime-trace-session-1",
    problemId: "problem-1",
    problem: { id: "problem-1", slug: "two-sum", title: "Two Sum" },
    browserInstanceId: "trace-e2e-browser-instance",
    startTrigger: "review",
    captureLevel: "full",
    foregroundStatus: "active",
    backgroundStatus: "settled",
    startedAt: "2026-07-12T12:00:00.000Z",
    lastActivityAt: "2026-07-12T12:00:03.000Z",
    foregroundEndedAt: null,
    endReason: null,
    settledAt: "2026-07-12T12:00:03.000Z",
  };
}

function traceRun() {
  return {
    id: "trace-run-1",
    workspaceSessionId: "runtime-trace-session-1",
    parentTraceRunId: null,
    originatingTraceRunId: null,
    turnOrdinal: 1,
    originatingTurnOrdinal: null,
    path: "review",
    actionKind: "review",
    status: "succeeded",
    startedAt: "2026-07-12T12:00:01.000Z",
    endedAt: "2026-07-12T12:00:03.000Z",
    durationMs: 2_000,
    providerInputTokens: 100,
    providerOutputTokens: 50,
    providerTotalTokens: 150,
    providerReasoningTokens: 10,
    providerCachedTokens: 20,
    estimatedCostUsd: 0.0005,
    pricingVersion: "runtime-trace-pricing-v1",
    pricingStatus: "priced",
    unpricedLlmCallCount: 0,
    llmCallCount: 1,
    toolCallCount: 0,
    errorCount: 0,
    traceOverheadMs: 4,
    traceCompleteness: "complete",
    finalFlushAt: "2026-07-12T12:00:03.000Z",
  };
}

function traceEvent(seq: number) {
  const isLlm = seq === 1;
  return {
    id: `trace-event-row-${seq}`,
    eventId: `trace-event-${seq}`,
    eventDigest: String(seq % 10).repeat(64),
    seq,
    traceRunId: "trace-run-1",
    parentTraceRunId: null,
    turnOrdinal: 1,
    stepId: `step-${seq}`,
    parentStepId: null,
    stepIndex: seq - 1,
    agentIteration: null,
    path: "review",
    stage: isLlm ? "diagnose_coach" : "persistence",
    kind: isLlm ? "llm" : "persistence",
    title: isLlm ? "Diagnose & Coach" : `Persist trace ${seq}`,
    status: isLlm ? "degraded" : "succeeded",
    occurredAt: "2026-07-12T12:00:02.000Z",
    clientOccurredAt: null,
    startedAt: "2026-07-12T12:00:01.000Z",
    endedAt: "2026-07-12T12:00:02.000Z",
    durationMs: isLlm ? 1_000 : 4,
    model: isLlm ? "deepseek-chat" : null,
    responseModel: isLlm ? "deepseek-chat" : null,
    providerInputTokens: isLlm ? 100 : null,
    providerOutputTokens: isLlm ? 50 : null,
    providerTotalTokens: isLlm ? 150 : null,
    providerReasoningTokens: isLlm ? 10 : null,
    providerCachedTokens: isLlm ? 20 : null,
    usageSource: isLlm ? "provider" : null,
    usageMissingReason: null,
    estimatedTokens: null,
    estimatedCostUsd: isLlm ? 0.0005 : null,
    pricingVersion: isLlm ? "runtime-trace-pricing-v1" : null,
    pricingStatus: isLlm ? "priced" : "not_applicable",
    memoryRssBytes: null,
    memoryHeapUsedBytes: null,
    resourceScope: null,
    detailLevel: "full",
    payloadState: "captured",
    redactedFields: [],
    truncatedFields: [],
    unavailableFields: [],
    metadata: null,
    payload: isLlm
      ? {
          prompt: [
            { role: "system", content: "policy" },
            { role: "user", content: "review this code" },
          ],
          input: { codeHash: "abc" },
          output: { coachReply: "focus on the invariant" },
          retrieval: null,
          stateDelta: null,
          memoryDelta: null,
          metadata: null,
          stdout: null,
          stderr: null,
          byteSize: 200,
        }
      : null,
  };
}

function historySession() {
  return {
    ...session(),
    id: "runtime-trace-history-1",
    foregroundStatus: "closed",
    foregroundEndedAt: "2026-07-12T12:00:03.000Z",
    durationMs: 3_000,
    turnCount: 1,
    runCount: 1,
    eventCount: 31,
    outcome: "succeeded",
    traceCompleteness: "complete",
    payloadState: "pruned",
    llmCallCount: 1,
    providerTotalTokens: 150,
    knownCostUsd: 0.0005,
    unpricedLlmCallCount: 0,
  };
}
