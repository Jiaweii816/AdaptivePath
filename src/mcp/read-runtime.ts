import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import {
  createPrismaMemoryReadService,
  type MemoryReadService,
  type RetrievalProblemContext,
} from "./memory-read-service";
import { createReadOnlyFtsStore } from "./read-only-fts-store";
import { findPracticeProblemChatTool } from "@/server/tools/chat-tools/find-practice-problem-tool";
import type { ChatToolResult } from "@/server/tools/chat-tools/chat-tool-contracts";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";

export type LearnerProblemContext = {
  userId: string;
  handle: string;
  activeProblem: RetrievalProblemContext;
};

export type ReadOnlyMcpRuntime = {
  memoryReadService: MemoryReadService;
  resolveLearner(handle: string): Promise<{ userId: string; handle: string }>;
  resolveProblem(problemSlug: string): Promise<RetrievalProblemContext>;
  resolveLearnerContext(input: {
    handle: string;
    problemSlug: string;
  }): Promise<LearnerProblemContext>;
  recommendPractice(input: {
    handle: string;
    mode: "advance" | "reinforce";
    tags: string[];
    completedIds?: string[];
    activeProblemSlug?: string;
  }): Promise<ChatToolResult<"find_practice_problem">>;
  close(): Promise<void>;
};

export function createReadOnlyPrismaClient(databaseUrl: string) {
  const normalizedDatabaseUrl = normalizeReadOnlyDatabaseUrl(databaseUrl);
  const adapter = new PrismaBetterSqlite3({
    url: normalizedDatabaseUrl,
    readonly: true,
    fileMustExist: true,
  });
  return new PrismaClient({ adapter, log: ["error"] });
}

export function createReadOnlyMcpRuntime(
  options: { databaseUrl?: string; cwd?: string } = {},
): ReadOnlyMcpRuntime {
  const configuredDatabaseUrl =
    options.databaseUrl?.trim() || process.env.DATABASE_URL?.trim();
  if (!configuredDatabaseUrl) {
    throw new Error(
      "Read-only MCP runtime requires an explicit DATABASE_URL.",
    );
  }
  const databaseUrl = normalizeReadOnlyDatabaseUrl(
    configuredDatabaseUrl,
    options.cwd,
  );
  const prisma = createReadOnlyPrismaClient(databaseUrl);
  const ftsStore = createReadOnlyFtsStore(resolveSqliteFilePath(databaseUrl));
  const memoryReadService = createPrismaMemoryReadService(
    prisma,
    { ftsStore },
  );

  async function resolveLearner(handleInput: string) {
    const handle = requireNonBlank(handleInput, "handle");
    const user = await prisma.user.findUnique({
      where: { handle },
      select: { id: true, handle: true },
    });
    if (!user) throw new Error("Learner handle was not found.");
    return { userId: user.id, handle: user.handle };
  }

  async function resolveProblem(problemSlugInput: string) {
    const problemSlug = requireNonBlank(problemSlugInput, "problemSlug");
    const problem = await prisma.problem.findUnique({
      where: { slug: problemSlug },
      select: {
        id: true,
        slug: true,
        title: true,
        leetcodeNumber: true,
        tags: true,
      },
    });
    if (!problem) throw new Error("Problem slug was not found.");
    return {
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      leetcodeNumber: problem.leetcodeNumber ?? undefined,
      tags: parseStringArray(problem.tags),
    };
  }

  return {
    memoryReadService,
    resolveLearner,
    resolveProblem,
    async resolveLearnerContext(input) {
      const [learner, activeProblem] = await Promise.all([
        resolveLearner(input.handle),
        resolveProblem(input.problemSlug),
      ]);
      return {
        ...learner,
        activeProblem,
      };
    },
    async recommendPractice(input) {
      const learner = await resolveLearner(input.handle);
      const activeProblem = input.activeProblemSlug
        ? await resolveProblem(input.activeProblemSlug)
        : undefined;
      return findPracticeProblemChatTool(
        {
          mode: input.mode,
          tags: input.tags,
          completed_ids: input.completedIds,
        },
        {
          prisma,
          userId: learner.userId,
          memoryOrigin: "learner",
          problemTags: activeProblem?.tags ?? input.tags,
          problem: activeProblem
            ? {
                slug: activeProblem.slug,
                leetcodeNumber: activeProblem.leetcodeNumber ?? null,
              }
            : undefined,
        },
      );
    },
    async close() {
      ftsStore.close();
      await prisma.$disconnect();
    },
  };
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

function requireNonBlank(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be blank.`);
  return normalized;
}

function normalizeReadOnlyDatabaseUrl(databaseUrl: string, cwd?: string) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(
      "Read-only MCP runtime DATABASE_URL must be a file: SQLite URL.",
    );
  }
  return `file:${resolveSqliteFilePath(databaseUrl, cwd)}`;
}
