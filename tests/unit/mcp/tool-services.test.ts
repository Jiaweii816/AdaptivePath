import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpToolServices,
  type CreateMcpToolServicesOptions,
} from "@/mcp/tool-services";
import type { ReadOnlyMcpRuntime } from "@/mcp/read-runtime";
import type { MemoryReadService } from "@/mcp/memory-read-service";
import type { saveMistakeBookEntryChatTool } from "@/server/tools/chat-tools/save-mistake-book-entry-tool";

const activeProblem = {
  id: "problem-704",
  slug: "binary-search",
  title: "Binary Search",
  leetcodeNumber: 704,
  tags: ["Array", "Binary Search"],
};

function createReadRuntime(): ReadOnlyMcpRuntime {
  const memoryReadService: MemoryReadService = {
    getLearnerWeaknessSlots: vi.fn<
      MemoryReadService["getLearnerWeaknessSlots"]
    >(async () => []),
    getLearnerWeaknessSignals: vi.fn<
      MemoryReadService["getLearnerWeaknessSignals"]
    >(async () => ({ source: "none", items: [] })),
    recallPastMistakes: vi.fn<MemoryReadService["recallPastMistakes"]>(
      async () => ({ items: [], retrievalStatus: "full" }),
    ),
    recallPastProblems: vi.fn<MemoryReadService["recallPastProblems"]>(
      async () => ({ items: [], retrievalStatus: "full" }),
    ),
  };
  return {
    memoryReadService,
    resolveLearner: vi.fn(async (handle) => ({
      userId: "user-dev",
      handle,
    })),
    resolveProblem: vi.fn(async () => activeProblem),
    resolveLearnerContext: vi.fn(async ({ handle }) => ({
      userId: "user-dev",
      handle,
      activeProblem,
    })),
    recommendPractice: vi.fn<ReadOnlyMcpRuntime["recommendPractice"]>(
      async (input) => ({
        mode: input.mode,
        searchedTags: input.tags,
        excludedCompletedIds: [],
        recommendationScope: "hot150_same_type",
        usedFallback: false,
        suggestions: [],
      }),
    ),
    close: vi.fn(async () => undefined),
  };
}

function isolatedOptions(
  overrides: Partial<CreateMcpToolServicesOptions> = {},
): CreateMcpToolServicesOptions {
  return {
    databaseUrl: "file:/tmp/patterncoach-mcp-tool-services.sqlite",
    env: {
      DATABASE_URL: "file:/tmp/patterncoach-mcp-tool-services.sqlite",
      PATTERNCOACH_MEMORY_ORIGIN: "development",
    },
    cwd: "/workspace",
    readRuntime: createReadRuntime(),
    ...overrides,
  };
}

describe("createMcpToolServices", () => {
  it("resolves external handles and active slugs before memory recall", async () => {
    const readRuntime = createReadRuntime();
    const runtime = await createMcpToolServices(
      isolatedOptions({ readRuntime }),
    );

    await runtime.services.recallPastMistakes({
      handle: "PatternCoachDev",
      query: "boundary mistake",
      activeProblemSlug: "binary-search",
      searchHints: ["lower bound"],
      limit: 3,
    });

    expect(readRuntime.resolveLearnerContext).toHaveBeenCalledWith({
      handle: "PatternCoachDev",
      problemSlug: "binary-search",
    });
    expect(readRuntime.memoryReadService.recallPastMistakes).toHaveBeenCalledWith(
      {
        userId: "user-dev",
        query: "boundary mistake",
        activeProblem,
        searchHints: ["lower bound"],
        limit: 3,
      },
    );
    await runtime.close();
  });

  it("delegates recommendations to the read-only runtime", async () => {
    const readRuntime = createReadRuntime();
    const runtime = await createMcpToolServices(
      isolatedOptions({ readRuntime }),
    );
    const input = {
      handle: "PatternCoachDev",
      mode: "reinforce" as const,
      tags: ["binary-search"],
      completedIds: ["704"],
      activeProblemSlug: "binary-search",
    };

    await runtime.services.recommendPractice(input);

    expect(readRuntime.recommendPractice).toHaveBeenCalledWith(input);
    await runtime.close();
  });

  it("does not open a writable connection until a write is invoked", async () => {
    const createPrismaClient = vi.fn(() => {
      throw new Error("write connection should stay closed");
    });
    const runtime = await createMcpToolServices(
      isolatedOptions({
        writeDependencies: { createPrismaClient },
      }),
    );

    await runtime.services.recallWeaknessPatterns({
      handle: "PatternCoachDev",
    });

    expect(createPrismaClient).not.toHaveBeenCalled();
    await runtime.close();
  });

  it.each([
    {
      label: "missing database",
      options: { databaseUrl: undefined, env: {} },
      handle: "PatternCoachDev",
      message: /DATABASE_URL must explicitly select/,
    },
    {
      label: "learner origin",
      options: {
        env: {
          DATABASE_URL: "file:/tmp/isolated.sqlite",
          PATTERNCOACH_MEMORY_ORIGIN: "learner",
        },
      },
      handle: "PatternCoachDev",
      message: /must be development, test, or evaluation/,
    },
    {
      label: "Iris identity",
      options: {},
      handle: "Iris904",
      message: /refuse to write the Iris904 learner account/,
    },
  ])("rejects $label before opening a writable connection", async (fixture) => {
    const createPrismaClient = vi.fn(() => {
      throw new Error("must not open");
    });
    const runtime = await createMcpToolServices(
      isolatedOptions({
        ...fixture.options,
        readRuntime: createReadRuntime(),
        writeDependencies: { createPrismaClient },
      }),
    );

    await expect(
      runtime.services.saveMistakeBookEntry({
        handle: fixture.handle,
        problemSlug: "binary-search",
        chatSessionId: "chat-dev",
        title: "Boundary review",
        guideMarkdown: "Keep the interval invariant explicit.",
      }),
    ).rejects.toThrow(fixture.message);
    expect(createPrismaClient).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("resolves write ownership and delegates a real chat-tool context", async () => {
    const findUser = vi.fn(async () => ({
      id: "user-dev",
      handle: "PatternCoachDev",
    }));
    const findProblem = vi.fn(async () => ({
      id: "problem-704",
      slug: "binary-search",
      title: "Binary Search",
      leetcodeNumber: 704,
      methodName: "search",
      inputContractJson: "{}",
      outputContractJson: "{}",
      isDemoSupported: true,
      localRunStatus: "runnable",
      localRunStatusMessage: null,
      comparisonStrategy: "exact",
      comparisonConfigJson: "{}",
      contractKind: "pure_function",
      tags: JSON.stringify(["binary-search"]),
    }));
    const findChatSession = vi.fn(async () => ({ id: "chat-dev" }));
    const disconnect = vi.fn(async () => undefined);
    const prisma = {
      user: { findUnique: findUser },
      problem: { findUnique: findProblem },
      chatSession: { findFirst: findChatSession },
      $disconnect: disconnect,
    } as unknown as PrismaClient;
    const saveMistakeBookEntry = vi.fn<
      typeof saveMistakeBookEntryChatTool
    >(async (args, context) => ({
      saved: true,
      entryId: "entry-dev",
      problemSlug: context.problem.slug,
      title: args.title,
      saveCount: 1,
      message: "saved",
    }));
    const runtime = await createMcpToolServices(
      isolatedOptions({
        writeDependencies: {
          createPrismaClient: vi.fn(() => prisma),
          saveMistakeBookEntry,
          createToolCallId: () => "mcp-call-1",
        },
      }),
    );

    const result = await runtime.services.saveMistakeBookEntry({
      handle: "PatternCoachDev",
      problemSlug: "binary-search",
      chatSessionId: "chat-dev",
      title: "Boundary review",
      guideMarkdown: "Keep the interval invariant explicit.",
      tags: ["binary-search"],
    });

    expect(findChatSession).toHaveBeenCalledWith({
      where: {
        id: "chat-dev",
        userId: "user-dev",
        problemId: "problem-704",
        memoryOrigin: "development",
      },
      select: { id: true },
    });
    expect(saveMistakeBookEntry).toHaveBeenCalledWith(
      {
        title: "Boundary review",
        guideMarkdown: "Keep the interval invariant explicit.",
        selfCheckQuestion: undefined,
        selfCheckAnswer: undefined,
        tags: ["binary-search"],
      },
      expect.objectContaining({
        prisma,
        userId: "user-dev",
        memoryOrigin: "development",
        chatSessionId: "chat-dev",
        problemTags: ["binary-search"],
        toolCallId: "mcp-call-1",
      }),
    );
    expect(result.saved).toBe(true);
    await runtime.close();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
