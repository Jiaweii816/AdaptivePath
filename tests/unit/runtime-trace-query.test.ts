import { afterEach, describe, expect, it } from "vitest";
import {
  getCurrentTraceSessionPage,
  getTraceSessionDetailPage,
  listTraceSessionHistory,
} from "@/server/observability/trace-query";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((database) => database.cleanup())));

describe("runtime trace read projection", () => {
  it("returns null current state and never revives closed history", async () => {
    const fixture = await createFixture();
    await createSession(fixture, { id: "closed-session", browserInstanceId: "tab-a", foregroundStatus: "closed" });

    const page = await getCurrentTraceSessionPage(fixture.prisma, {
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      browserInstanceId: "tab-a",
      since: 0,
      limit: 200,
    });

    expect(page).toEqual({
      session: null,
      turns: [],
      runs: [],
      events: [],
      nextSeq: 0,
      highWaterSeq: 0,
      hasMore: false,
      hasActiveTurn: false,
      backgroundStatus: null,
    });
  });

  it("drains cursor pages without gaps across identical timestamps", async () => {
    const fixture = await createFixture();
    const session = await createSession(fixture, { id: "active-session", browserInstanceId: "tab-a" });
    const run = await createRun(fixture, session.id, "run-1", 1);
    const occurredAt = new Date("2026-07-12T12:00:00.000Z");
    for (let seq = 1; seq <= 5; seq += 1) {
      await fixture.prisma.agentTraceEvent.create({
        data: {
          eventId: `event-${seq}`,
          eventDigest: String(seq).repeat(64),
          seq,
          workspaceSessionId: session.id,
          traceRunId: run.id,
          turnOrdinal: 1,
          path: "review",
          stage: "fixture",
          kind: "lifecycle",
          title: `Event ${seq}`,
          status: "succeeded",
          occurredAt,
        },
      });
    }

    const observed: number[] = [];
    let since = 0;
    do {
      const page = await getCurrentTraceSessionPage(fixture.prisma, {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        browserInstanceId: "tab-a",
        since,
        limit: 2,
      });
      observed.push(...page.events.map((event) => event.seq!));
      expect(page.highWaterSeq).toBe(5);
      expect(page.nextSeq).toBe(page.events.at(-1)?.seq ?? since);
      since = page.nextSeq;
      if (!page.hasMore) break;
    } while (true);

    expect(observed).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(observed).size).toBe(5);
  });

  it("returns turns, run activity, payload projection, and detail for an owned session", async () => {
    const fixture = await createFixture();
    const session = await createSession(fixture, { id: "detail-session", browserInstanceId: "tab-detail", backgroundStatus: "pending" });
    const run = await createRun(fixture, session.id, "running-turn", 1);
    await fixture.prisma.agentTraceRun.update({
      where: { id: run.id },
      data: {
        providerInputTokens: 120,
        providerOutputTokens: 30,
        providerTotalTokens: 150,
        providerReasoningTokens: 10,
        providerCachedTokens: 20,
        estimatedCostUsd: 0.00042,
        pricingVersion: "pricing-v1",
        pricingStatus: "partial",
        unpricedLlmCallCount: 1,
        traceOverheadMs: 7,
      },
    });
    await fixture.prisma.agentTraceEvent.create({
      data: {
        eventId: "payload-event",
        eventDigest: "a".repeat(64),
        seq: 1,
        workspaceSessionId: session.id,
        traceRunId: run.id,
        turnOrdinal: 1,
        path: "review",
        stage: "fixture",
        kind: "llm",
        title: "LLM",
        status: "succeeded",
        occurredAt: new Date("2026-07-12T12:00:00.000Z"),
        startedAt: new Date("2026-07-12T11:59:59.900Z"),
        endedAt: new Date("2026-07-12T12:00:00.000Z"),
        durationMs: 100,
        model: "deepseek-chat",
        responseModel: "deepseek-chat-2026-07",
        providerInputTokens: 120,
        providerOutputTokens: 30,
        providerTotalTokens: 150,
        providerReasoningTokens: 10,
        providerCachedTokens: 20,
        usageSource: "provider",
        estimatedCostUsd: 0.00042,
        pricingVersion: "pricing-v1",
        pricingStatus: "priced",
        memoryRssBytes: 1024,
        memoryHeapUsedBytes: 512,
        resourceScope: "process_sample",
        payloadState: "captured",
        metadataJson: JSON.stringify({ eventRole: "call" }),
        payload: {
          create: {
            workspaceSessionId: session.id,
            outputJson: JSON.stringify({ reply: "ok" }),
            byteSize: 14,
          },
        },
      },
    });

    const page = await getTraceSessionDetailPage(fixture.prisma, {
      userId: fixture.user.id,
      sessionId: session.id,
      since: 0,
      limit: 10,
    });

    expect(page).not.toBeNull();
    expect(page).toMatchObject({ hasActiveTurn: true, backgroundStatus: "pending", highWaterSeq: 1 });
    expect(page?.turns).toHaveLength(1);
    expect(page?.session.problem).toEqual({
      id: fixture.problem.id,
      slug: fixture.problem.slug,
      title: fixture.problem.title,
    });
    expect(page?.runs[0]).toMatchObject({
      providerInputTokens: 120,
      providerOutputTokens: 30,
      providerTotalTokens: 150,
      providerReasoningTokens: 10,
      providerCachedTokens: 20,
      pricingVersion: "pricing-v1",
      pricingStatus: "partial",
      unpricedLlmCallCount: 1,
      traceOverheadMs: 7,
    });
    expect(page?.events[0]).toMatchObject({
      seq: 1,
      responseModel: "deepseek-chat-2026-07",
      providerInputTokens: 120,
      providerOutputTokens: 30,
      providerTotalTokens: 150,
      providerReasoningTokens: 10,
      providerCachedTokens: 20,
      usageSource: "provider",
      pricingVersion: "pricing-v1",
      pricingStatus: "priced",
      memoryRssBytes: 1024,
      memoryHeapUsedBytes: 512,
      resourceScope: "process_sample",
      metadata: { eventRole: "call" },
      payload: { output: { reply: "ok" }, byteSize: 14 },
    });
    expect(await getTraceSessionDetailPage(fixture.prisma, {
      userId: "another-user",
      sessionId: session.id,
      since: 0,
      limit: 10,
    })).toBeNull();
  });

  it("paginates terminal history and excludes active sessions", async () => {
    const fixture = await createFixture();
    await createSession(fixture, { id: "history-1", browserInstanceId: "tab-1", foregroundStatus: "closed", startedAt: new Date("2026-07-12T10:00:00Z") });
    await createSession(fixture, { id: "history-2", browserInstanceId: "tab-2", foregroundStatus: "abandoned", startedAt: new Date("2026-07-12T11:00:00Z") });
    await createSession(fixture, { id: "current", browserInstanceId: "tab-3", foregroundStatus: "active", startedAt: new Date("2026-07-12T12:00:00Z") });

    const first = await listTraceSessionHistory(fixture.prisma, { userId: fixture.user.id, limit: 1 });
    const second = await listTraceSessionHistory(fixture.prisma, { userId: fixture.user.id, limit: 1, cursor: first.nextCursor! });

    expect(first.sessions.map((session) => session.id)).toEqual(["history-2"]);
    expect(first).toMatchObject({ hasMore: true, nextCursor: "history-2" });
    expect(first.sessions[0]).toMatchObject({
      problem: {
        id: fixture.problem.id,
        slug: fixture.problem.slug,
        title: fixture.problem.title,
      },
      foregroundStatus: "abandoned",
      backgroundStatus: "idle",
      traceCompleteness: "incomplete",
      payloadState: "unavailable",
      outcome: "unknown",
    });
    expect(second.sessions.map((session) => session.id)).toEqual(["history-1"]);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("names mixed retained and pruned History payloads partially_pruned", async () => {
    const fixture = await createFixture();
    const session = await createSession(fixture, {
      id: "mixed-payload-history",
      browserInstanceId: "tab-mixed",
      foregroundStatus: "closed",
    });
    const run = await createRun(fixture, session.id, "mixed-run", 1);
    await fixture.prisma.agentTraceRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        traceCompleteness: "complete",
        endedAt: new Date(),
        finalFlushAt: new Date(),
      },
    });
    for (const [seq, payloadState] of [[1, "captured"], [2, "pruned"]] as const) {
      await fixture.prisma.agentTraceEvent.create({
        data: {
          eventId: `mixed-event-${seq}`,
          eventDigest: String(seq).repeat(64),
          seq,
          workspaceSessionId: session.id,
          traceRunId: run.id,
          turnOrdinal: 1,
          path: "review",
          stage: "fixture",
          kind: "lifecycle",
          title: `Mixed event ${seq}`,
          status: "succeeded",
          payloadState,
        },
      });
    }

    const history = await listTraceSessionHistory(fixture.prisma, {
      userId: fixture.user.id,
      limit: 10,
    });

    expect(history.sessions[0]).toMatchObject({
      id: session.id,
      payloadState: "partially_pruned",
      traceCompleteness: "complete",
    });
  });

  it("omits payload fields that were never captured", async () => {
    const fixture = await createFixture();
    const session = await createSession(fixture, { id: "null-payload-session", browserInstanceId: "tab-a" });
    const run = await createRun(fixture, session.id, "null-payload-run", 1);

    await fixture.prisma.agentTraceEvent.create({
      data: {
        eventId: "null-payload-event",
        eventDigest: "b".repeat(64),
        seq: 1,
        workspaceSessionId: session.id,
        traceRunId: run.id,
        turnOrdinal: 1,
        path: "chat",
        stage: "bounded_agent_loop",
        kind: "tool",
        title: "Tool call · run_current_code",
        status: "started",
        occurredAt: new Date("2026-07-13T12:00:00.000Z"),
        payloadState: "captured",
        payload: {
          create: {
            workspaceSessionId: session.id,
            // 只有 input 被采集。其余列在库里就是 NULL —— 这是 78%~98% 事件的真实形态。
            inputJson: JSON.stringify({}),
            byteSize: 2,
          },
        },
      },
    });

    const page = await getTraceSessionDetailPage(fixture.prisma, {
      userId: fixture.user.id,
      sessionId: session.id,
      since: 0,
      limit: 10,
    });

    const payload = page?.events[0]?.payload;
    expect(payload?.input).toEqual({});          // `{}` 有意义：该工具不收参数
    // 未采集的字段必须整个 key 消失，而不是变成 null
    expect(payload).not.toHaveProperty("output");
    expect(payload).not.toHaveProperty("retrieval");
    expect(payload).not.toHaveProperty("stateDelta");
    expect(payload).not.toHaveProperty("memoryDelta");
  });
});

async function createFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  return { prisma: database.prisma, user, problem };
}

async function createSession(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: {
    id: string;
    browserInstanceId: string;
    foregroundStatus?: "active" | "closed" | "abandoned";
    backgroundStatus?: "idle" | "pending";
    startedAt?: Date;
  },
) {
  const foregroundStatus = input.foregroundStatus ?? "active";
  return fixture.prisma.problemWorkspaceSession.create({
    data: {
      id: input.id,
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      browserInstanceId: input.browserInstanceId,
      activeIdentityKey: foregroundStatus === "active" ? `${fixture.user.id}:${fixture.problem.id}:${input.browserInstanceId}` : null,
      startTrigger: "review",
      captureLevel: "full",
      foregroundStatus,
      backgroundStatus: input.backgroundStatus ?? "idle",
      startedAt: input.startedAt,
      foregroundEndedAt: foregroundStatus === "active" ? null : input.startedAt ?? new Date(),
    },
  });
}

async function createRun(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  sessionId: string,
  id: string,
  turnOrdinal: number,
) {
  return fixture.prisma.agentTraceRun.create({
    data: {
      id,
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      workspaceSessionId: sessionId,
      turnOrdinal,
      path: "review",
      status: "running",
      processInstanceId: "fixture-process",
    },
  });
}
