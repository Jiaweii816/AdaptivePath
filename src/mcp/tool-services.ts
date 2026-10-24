import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import {
  createReadOnlyMcpRuntime,
  type ReadOnlyMcpRuntime,
} from "./read-runtime";
import type { McpToolServices } from "./tools";
import {
  resolveMemoryOrigin,
  type MemoryOrigin,
} from "@/server/memory/memory-origin";
import { saveMistakeBookEntryChatTool } from "@/server/tools/chat-tools/save-mistake-book-entry-tool";
import {
  assertNotLearnerDatabase,
  MCP_PROJECT_ROOT,
} from "./database-safety";

type Environment = Readonly<Record<string, string | undefined>>;

type WriteDependencies = {
  createPrismaClient(databaseUrl: string): PrismaClient;
  saveMistakeBookEntry: typeof saveMistakeBookEntryChatTool;
  createToolCallId(): string;
};

export type CreateMcpToolServicesOptions = {
  databaseUrl?: string;
  env?: Environment;
  cwd?: string;
  readRuntime?: ReadOnlyMcpRuntime;
  writeDependencies?: Partial<WriteDependencies>;
};

export type McpToolServicesRuntime = {
  services: McpToolServices;
  close(): Promise<void>;
};

const ISOLATED_WRITE_ORIGINS = new Set<MemoryOrigin>([
  "development",
  "test",
  "evaluation",
]);

export async function createMcpToolServices(
  options: CreateMcpToolServicesOptions = {},
): Promise<McpToolServicesRuntime> {
  const env = options.env ?? process.env;
  const configuredDatabaseUrl =
    options.databaseUrl?.trim() || env.DATABASE_URL?.trim();
  const readRuntime =
    options.readRuntime ??
    createReadOnlyMcpRuntime({ databaseUrl: configuredDatabaseUrl });
  const writeDependencies: WriteDependencies = {
    createPrismaClient: createWritePrismaClient,
    saveMistakeBookEntry: saveMistakeBookEntryChatTool,
    createToolCallId: randomUUID,
    ...options.writeDependencies,
  };
  let writePrisma: PrismaClient | undefined;

  function getWritePrisma() {
    const writeConfig = assertIsolatedWriteConfiguration({
      databaseUrl: configuredDatabaseUrl,
      env,
      cwd: options.cwd,
    });
    writePrisma ??= writeDependencies.createPrismaClient(
      writeConfig.databaseUrl,
    );
    return { prisma: writePrisma, memoryOrigin: writeConfig.memoryOrigin };
  }

  const services: McpToolServices = {
    async recallWeaknessPatterns(input) {
      const learner = await readRuntime.resolveLearner(input.handle);
      return readRuntime.memoryReadService.getLearnerWeaknessSlots(
        learner.userId,
      );
    },
    async recallPastMistakes(input) {
      const context = await readRuntime.resolveLearnerContext({
        handle: input.handle,
        problemSlug: input.activeProblemSlug,
      });
      return readRuntime.memoryReadService.recallPastMistakes({
        userId: context.userId,
        query: input.query,
        activeProblem: context.activeProblem,
        searchHints: input.searchHints,
        limit: input.limit,
      });
    },
    async recallPastProblems(input) {
      const context = await readRuntime.resolveLearnerContext({
        handle: input.handle,
        problemSlug: input.activeProblemSlug,
      });
      return readRuntime.memoryReadService.recallPastProblems({
        userId: context.userId,
        query: input.query,
        activeProblem: context.activeProblem,
        searchHints: input.searchHints,
        limit: input.limit,
      });
    },
    recommendPractice: (input) => readRuntime.recommendPractice(input),
    async saveMistakeBookEntry(input) {
      if (input.handle.toLocaleLowerCase("en-US") === "iris904") {
        throw new Error(
          "MCP write denied: refuse to write the Iris904 learner account",
        );
      }
      const { prisma, memoryOrigin } = getWritePrisma();
      const user = await prisma.user.findUnique({
        where: { handle: input.handle },
        select: { id: true, handle: true },
      });
      if (!user) throw new Error("MCP write learner handle was not found.");
      if (user.handle.toLocaleLowerCase("en-US") === "iris904") {
        throw new Error(
          "MCP write denied: refuse to write the Iris904 learner account",
        );
      }

      const problem = await prisma.problem.findUnique({
        where: { slug: input.problemSlug },
        select: {
          id: true,
          slug: true,
          title: true,
          leetcodeNumber: true,
          methodName: true,
          inputContractJson: true,
          outputContractJson: true,
          isDemoSupported: true,
          localRunStatus: true,
          localRunStatusMessage: true,
          comparisonStrategy: true,
          comparisonConfigJson: true,
          contractKind: true,
          tags: true,
        },
      });
      if (!problem) throw new Error("MCP write problem slug was not found.");

      const chatSession = await prisma.chatSession.findFirst({
        where: {
          id: input.chatSessionId,
          userId: user.id,
          problemId: problem.id,
          memoryOrigin,
        },
        select: { id: true },
      });
      if (!chatSession) {
        throw new Error(
          "MCP write chat session was not found for this learner, problem, and memory origin.",
        );
      }

      return writeDependencies.saveMistakeBookEntry(
        {
          title: input.title,
          guideMarkdown: input.guideMarkdown,
          selfCheckQuestion: input.selfCheckQuestion,
          selfCheckAnswer: input.selfCheckAnswer,
          tags: input.tags,
        },
        {
          prisma,
          userId: user.id,
          memoryOrigin,
          chatSessionId: chatSession.id,
          problem: {
            id: problem.id,
            slug: problem.slug,
            title: problem.title,
            leetcodeNumber: problem.leetcodeNumber,
            methodName: problem.methodName,
            inputContractJson: problem.inputContractJson,
            outputContractJson: problem.outputContractJson,
            isDemoSupported: problem.isDemoSupported,
            localRunStatus: problem.localRunStatus,
            localRunStatusMessage: problem.localRunStatusMessage,
            comparisonStrategy: problem.comparisonStrategy,
            comparisonConfigJson: problem.comparisonConfigJson,
            contractKind: problem.contractKind,
          },
          problemTags: parseStringArray(problem.tags),
          toolCallId: writeDependencies.createToolCallId(),
        },
      );
    },
  };

  return {
    services,
    async close() {
      await Promise.all([
        readRuntime.close(),
        writePrisma?.$disconnect() ?? Promise.resolve(),
      ]);
    },
  };
}

function createWritePrismaClient(databaseUrl: string) {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
    log: ["error"],
  });
}

function assertIsolatedWriteConfiguration(args: {
  databaseUrl?: string;
  env: Environment;
  cwd?: string;
}): { databaseUrl: string; memoryOrigin: MemoryOrigin } {
  const databaseUrl = args.databaseUrl?.trim();
  if (!databaseUrl) {
    throw new Error(
      "MCP write denied: DATABASE_URL must explicitly select an isolated SQLite database",
    );
  }
  if (!hasAbsoluteSqlitePath(databaseUrl)) {
    throw new Error(
      "MCP write denied: DATABASE_URL must use an absolute SQLite path",
    );
  }

  assertNotLearnerDatabase(databaseUrl, args.cwd ?? MCP_PROJECT_ROOT);

  const memoryOrigin = resolveMemoryOrigin(args.env);
  if (!ISOLATED_WRITE_ORIGINS.has(memoryOrigin)) {
    throw new Error(
      "MCP write denied: PATTERNCOACH_MEMORY_ORIGIN must be development, test, or evaluation",
    );
  }
  return { databaseUrl, memoryOrigin };
}

function hasAbsoluteSqlitePath(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) return isAbsolute(databaseUrl);
  const [rawPath] = databaseUrl.slice("file:".length).split("?");
  return Boolean(rawPath && isAbsolute(rawPath));
}

function parseStringArray(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
