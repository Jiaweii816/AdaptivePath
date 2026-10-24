import { afterEach, describe, expect, it } from "vitest";
import {
  classifyOperationalOutcome,
  normalizeProviderFamily,
  operationalPreconditionForResult,
  recomputeOperationalNotes,
} from "@/server/memory/operational-memory";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((database) => database.cleanup())));

describe("operational memory Phase 1 boundary", () => {
  it("learns only non-verdict execution outcomes and preserves useful counters", () => {
    expect(classifyOperationalOutcome("run_current_code", { result: { status: "failed" } })).toBe("useful");
    expect(classifyOperationalOutcome("run_current_code", { result: { status: "evidence_unavailable" } })).toBe("non_verdict");
    expect(classifyOperationalOutcome("verify_proposed_repair", { repairValidated: false })).toBe("not_applicable");
    expect(classifyOperationalOutcome("verify_proposed_repair", { repairValidated: true, evidenceVerdict: { capabilities: { canVerdict: false } } })).toBe("non_verdict");
  });

  it("uses actual known provider metadata and treats an empty test list as the selected suite", () => {
    expect(normalizeProviderFamily("remote_unavailable_local_fallback")).toBe("piston");
    expect(operationalPreconditionForResult({
      toolName: "run_current_code",
      toolArguments: { tests: [] },
      selectedSuiteHasVisibleTests: true,
      result: { result: { rawResult: { providerUsed: "lc_run" } } },
    })).toEqual({ selectedSuiteHasVisibleTests: true, executionInputMode: "selected_suite", executorProviderFamily: "leetcode" });
  });

  it("validates only diversified support and invalidates after three exact useful counters", async () => {
    const database = await createMemoryTestDb();
    databases.push(database);
    const { prisma } = database;
    const { user, problem } = await seedMinimalUserAndProblem(prisma);
    const secondProblem = await prisma.problem.create({
      data: {
        slug: "second-operational-problem",
        title: "Second operational problem",
        statementMarkdown: "fixture",
        methodName: "solve",
        tags: "[]",
      },
    });
    const first = await createTraceFixture(prisma, user.id, problem.id, "one");
    const second = await createTraceFixture(prisma, user.id, secondProblem.id, "two");
    await Promise.all([
      ...Array.from({ length: 3 }, (_, index) => writeOperationalEvent(prisma, first, `support-one-${index}`, "non_verdict")),
      ...Array.from({ length: 2 }, (_, index) => writeOperationalEvent(prisma, second, `support-two-${index}`, "non_verdict")),
      writeOperationalEvent(prisma, first, "counter-one", "useful"),
    ]);

    await recomputeOperationalNotes(prisma);
    expect(await prisma.operationalNote.findFirst()).toMatchObject({
      status: "validated",
      supportCount: 5,
      counterCount: 1,
      distinctProblemCount: 2,
      distinctSessionCount: 2,
    });

    await Promise.all([
      writeOperationalEvent(prisma, first, "counter-two", "useful"),
      writeOperationalEvent(prisma, second, "counter-three", "useful"),
    ]);
    await recomputeOperationalNotes(prisma);
    expect(await prisma.operationalNote.findFirst()).toMatchObject({
      status: "invalidated",
      supportCount: 5,
      counterCount: 3,
    });
  });
});

async function createTraceFixture(
  prisma: MemoryTestDb["prisma"],
  userId: string,
  problemId: string,
  suffix: string,
) {
  const session = await prisma.problemWorkspaceSession.create({
    data: {
      id: `operational-run-${suffix}`,
      userId,
      problemId,
      browserInstanceId: `operational-${suffix}`,
      activeIdentityKey: `${userId}:${problemId}:operational-${suffix}`,
      startTrigger: "chat",
      captureLevel: "full",
      foregroundStatus: "active",
      backgroundStatus: "idle",
    },
  });
  const run = await prisma.agentTraceRun.create({
    data: {
      id: `operational-trace-run-${suffix}`,
      userId,
      problemId,
      workspaceSessionId: session.id,
      path: "chat",
      status: "running",
      processInstanceId: "operational-memory-test",
      memoryOrigin: "learner",
    },
  });
  return { sessionId: session.id, runId: run.id };
}

async function writeOperationalEvent(
  prisma: MemoryTestDb["prisma"],
  fixture: { sessionId: string; runId: string },
  suffix: string,
  outcomeUtility: "useful" | "non_verdict",
) {
  await prisma.agentTraceEvent.create({
    data: {
      eventId: `operational-${suffix}`,
      eventDigest: suffix.padEnd(64, "0").slice(0, 64),
      workspaceSessionId: fixture.sessionId,
      traceRunId: fixture.runId,
      path: "chat",
      stage: "bounded_agent_loop",
      kind: "tool",
      title: "Tool result · run_current_code",
      status: "succeeded",
      metadataJson: JSON.stringify({
        eventRole: "result",
        toolName: "run_current_code",
        runtimeDisposition: "executed",
        outcomeUtility,
        operationalContractVersion: "chat-tools-v1",
        operationalPreconditionJson: JSON.stringify({
          selectedSuiteHasVisibleTests: true,
          executionInputMode: "selected_suite",
          executorProviderFamily: "piston",
        }),
      }),
    },
  });
}
