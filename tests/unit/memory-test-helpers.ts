import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import {
  attachTraceRunReferences,
  createTraceContext,
} from "@/server/llm/trace-context";
import { ensureWorkspaceTraceTurn } from "@/server/observability/workspace-session";
import type { CodeRunnerProvider } from "@/server/tools/code-runner/code-runner.types";
import {
  createMockCodeRunnerProvider,
  type MockRunnerOptions,
} from "@/server/tools/code-runner/mock-runner";
import { applyPrismaMigrations } from "./prisma-test-utils";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

export type MemoryTestDb = {
  dir: string;
  dbPath: string;
  prisma: PrismaClient;
  cleanup: () => Promise<void>;
};

export const TEST_LEARNER_MEMORY_ORIGIN = "learner" as const;

/**
 * Uses deterministic runner outcomes while marking them as an explicit
 * local-Hot-150 test fixture. The ordinary `mock` provider remains ineligible
 * to assert learner correctness or create durable learner memory.
 */
export function createLocalVisibleCodeRunnerFixtureProvider(
  options: MockRunnerOptions = {},
): CodeRunnerProvider {
  const fixture = createMockCodeRunnerProvider(options);
  return {
    async run(input) {
      const result = await fixture.run(input);
      const rawResult =
        result.rawResult &&
        typeof result.rawResult === "object" &&
        !Array.isArray(result.rawResult)
          ? result.rawResult
          : {};
      return {
        ...result,
        rawResult: {
          ...rawResult,
          providerUsed: "local_hot150",
          deterministicFixture: true,
        },
      };
    },
  };
}

export async function createMemoryTestDb(): Promise<MemoryTestDb> {
  const dir = mkdtempSync(join(tmpdir(), "pc-memory-"));
  const dbPath = join(dir, "test.db");
  const raw = new Database(dbPath);
  applyPrismaMigrations(raw);
  raw.close();

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter });

  return {
    dir,
    dbPath,
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(dir, { force: true, recursive: true });
    },
  };
}

export async function seedMinimalUserAndProblem(prisma: PrismaClient) {
  const user = await prisma.user.create({ data: { handle: "test-user" } });
  const problem = await prisma.problem.create({
    data: {
      slug: "binary-search",
      title: "Binary Search",
      statementMarkdown: "Find target in sorted array.",
      methodName: "search",
      tags: JSON.stringify(["binary_search", "array"]),
    },
  });
  const chatSession = await prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      title: problem.title,
      isActive: true,
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    },
  });

  return { user, problem, chatSession };
}

export async function createTestForegroundTraceContext(args: {
  prisma: PrismaClient;
  userId: string;
  problemId: string;
  chatSessionId: string;
  path: "review" | "chat";
  task: string;
  traceRunId?: string;
  /** Direct provider seams default to immediate persistence for assertions. */
  bufferedRecorder?: boolean;
}) {
  const turn = await ensureWorkspaceTraceTurn(args.prisma, {
    userId: args.userId,
    problemId: args.problemId,
    browserInstanceId: `unit-${args.traceRunId ?? randomUUID()}`,
    action: args.path,
    snapshot: { metadata: { syntheticTestInvocation: true } },
    cutoverEnabled: true,
    captureLevel: "full",
    traceRunId: args.traceRunId,
    memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
  });
  if (!turn.enabled) throw new Error("Test Trace Invocation was disabled.");
  const context = createTraceContext({
    prisma: args.prisma,
    userId: args.userId,
    problemId: args.problemId,
    chatSessionId: args.chatSessionId,
    path: args.path,
    task: args.task,
    traceRunId: turn.traceRunId,
    workspaceSessionId: turn.workspaceSessionId,
    turnOrdinal: turn.turnOrdinal,
    captureLevel: turn.captureLevel,
    memoryOrigin: turn.memoryOrigin,
  });
  if (!args.bufferedRecorder) {
    context.recorder = undefined;
  }
  await attachTraceRunReferences(context, { chatSessionId: args.chatSessionId });
  return context;
}

export function createTestBackgroundTraceContext(args: {
  prisma: PrismaClient;
  userId: string;
  problemId?: string;
  task: string;
}) {
  return createTraceContext({
    ...args,
    path: "memory_background",
    captureLevel: "full",
    memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
  });
}

export function trustedL2FactFixture(args: {
  mechanism: string;
  humanLabel: string;
  subject?: "learner_behavior" | "user_explicit";
  clusterCount?: number;
  problemIds?: string[];
}) {
  const clusterCount = Math.max(
    1,
    args.problemIds?.length ?? args.clusterCount ?? 2,
  );
  return {
    memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    validationJson: JSON.stringify({
      integrity: {
        version: 1,
        origin: TEST_LEARNER_MEMORY_ORIGIN,
        subject: args.subject ?? "learner_behavior",
        mechanism: args.mechanism,
        humanLabel: args.humanLabel,
        portability: "portable",
        promotionStatus: "trusted",
        evidenceClusters: Array.from({ length: clusterCount }, (_, index) => ({
          key: `fixture:${args.mechanism}:${args.problemIds?.[index] ?? "unknown"}:${index + 1}`,
          problemId: args.problemIds?.[index] ?? null,
          reviewAttemptId: args.problemIds?.[index]
            ? `fixture-review:${args.mechanism}:${index + 1}`
            : null,
          revisionKey: `fixture-revision:${index + 1}`,
          transition: "reinforce",
          evidenceTraceIds: [`fixture-evidence:${args.mechanism}:${index + 1}`],
        })),
      },
    }),
  };
}
