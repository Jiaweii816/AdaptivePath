import { afterEach, describe, expect, it } from "vitest";
import { getCurrentTraceSessionPage, getTraceSessionDetailPage } from "@/server/observability/trace-query";
import { runtimeTraceEventSchema, runtimeTracePageSchema } from "@/features/runtime-trace/runtime-trace-api";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

// This is the line the 2026-07-13 regression slipped through: the server-side
// projection (trace-query.ts) started omitting never-captured payload keys
// entirely instead of filling them with `null`, but the client-side zod
// schema (runtime-trace-api.ts) still required every key to be present.
// Neither side's own unit tests caught it — they each tested their own half
// of the wire. This file parses a *real* server projection with the *real*
// client schema so that contract can't silently drift apart again.

const databases: MemoryTestDb[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((database) => database.cleanup())));

describe("runtime trace wire contract (server projection -> client schema)", () => {
  it("parses a page whose payload only has `input` captured (the 78-98% real-world shape)", async () => {
    const fixture = await createFixture();
    const session = await fixture.prisma.problemWorkspaceSession.create({
      data: {
        id: "wire-contract-session",
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        browserInstanceId: "tab-wire",
        activeIdentityKey: `${fixture.user.id}:${fixture.problem.id}:tab-wire`,
        startTrigger: "review",
        captureLevel: "full",
        foregroundStatus: "active",
        backgroundStatus: "idle",
      },
    });
    const run = await fixture.prisma.agentTraceRun.create({
      data: {
        id: "wire-contract-run",
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        workspaceSessionId: session.id,
        turnOrdinal: 1,
        path: "chat",
        status: "running",
        processInstanceId: "fixture-process",
      },
    });
    await fixture.prisma.agentTraceEvent.create({
      data: {
        eventId: "wire-contract-event",
        eventDigest: "c".repeat(64),
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
            // Only `input` was ever captured. Every other payload column is
            // NULL in the DB, which projectEvent()/compactObject() now
            // renders as an *absent key*, not `"key": null`.
            inputJson: JSON.stringify({}),
            byteSize: 2,
          },
        },
      },
    });

    const page = await getCurrentTraceSessionPage(fixture.prisma, {
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      browserInstanceId: "tab-wire",
      since: 0,
      limit: 200,
    });

    // Prove the server really does omit the keys (this is the shape the
    // client actually receives over HTTP as JSON).
    expect(Object.keys(page.events[0]?.payload ?? {})).toEqual(["input", "byteSize"]);

    const eventResult = runtimeTraceEventSchema.safeParse(page.events[0]);
    expect(eventResult.success).toBe(true);

    const pageResult = runtimeTracePageSchema.safeParse(page);
    expect(pageResult.success).toBe(true);
  });

  it("parses a detail page event where zero payload fields were ever captured", async () => {
    const fixture = await createFixture();
    const session = await fixture.prisma.problemWorkspaceSession.create({
      data: {
        id: "wire-contract-detail-session",
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        browserInstanceId: "tab-wire-detail",
        startTrigger: "review",
        captureLevel: "full",
        foregroundStatus: "closed",
        backgroundStatus: "settled",
        foregroundEndedAt: new Date(),
      },
    });
    const run = await fixture.prisma.agentTraceRun.create({
      data: {
        id: "wire-contract-detail-run",
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        workspaceSessionId: session.id,
        turnOrdinal: 1,
        path: "review",
        status: "succeeded",
        processInstanceId: "fixture-process",
      },
    });
    await fixture.prisma.agentTraceEvent.create({
      data: {
        eventId: "wire-contract-detail-event",
        eventDigest: "d".repeat(64),
        seq: 1,
        workspaceSessionId: session.id,
        traceRunId: run.id,
        turnOrdinal: 1,
        path: "review",
        stage: "lifecycle",
        kind: "lifecycle",
        title: "Session started",
        status: "succeeded",
        occurredAt: new Date("2026-07-13T12:00:00.000Z"),
        payloadState: "unavailable",
        // No `payload` row at all — this must stay `payload: null`, which the
        // client schema already accepted before this fix.
      },
    });

    const page = await getTraceSessionDetailPage(fixture.prisma, {
      userId: fixture.user.id,
      sessionId: session.id,
      since: 0,
      limit: 200,
    });

    const pageResult = runtimeTracePageSchema.safeParse(page);
    expect(pageResult.success).toBe(true);
  });
});

async function createFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  return { prisma: database.prisma, user, problem };
}
