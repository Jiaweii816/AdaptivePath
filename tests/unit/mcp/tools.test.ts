import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildMcpTools,
  type McpToolServices,
} from "@/mcp/tools";

function services(
  overrides: Partial<McpToolServices> = {},
): McpToolServices {
  return {
    recallWeaknessPatterns: vi.fn<
      McpToolServices["recallWeaknessPatterns"]
    >(async () => []),
    recallPastMistakes: vi.fn<McpToolServices["recallPastMistakes"]>(
      async () => ({ items: [], retrievalStatus: "full" }),
    ),
    recallPastProblems: vi.fn<McpToolServices["recallPastProblems"]>(
      async () => ({ items: [], retrievalStatus: "full" }),
    ),
    recommendPractice: vi.fn<McpToolServices["recommendPractice"]>(
      async () => ({
        mode: "reinforce",
        searchedTags: [],
        excludedCompletedIds: [],
        recommendationScope: "hot150_same_type",
        usedFallback: false,
        suggestions: [],
      }),
    ),
    saveMistakeBookEntry: vi.fn<McpToolServices["saveMistakeBookEntry"]>(
      async (input) => ({
        saved: true,
        entryId: "internal-entry-id",
        problemSlug: input.problemSlug,
        title: input.title,
        saveCount: 1,
        message: "saved",
      }),
    ),
    ...overrides,
  };
}

function findTool(
  toolServices: McpToolServices,
  name: string,
) {
  const tool = buildMcpTools(toolServices).find((item) => item.name === name);
  if (!tool) {
    throw new Error(`Missing MCP tool: ${name}`);
  }
  return tool;
}

function textJson(result: Awaited<ReturnType<ReturnType<typeof buildMcpTools>[number]["handler"]>>) {
  const text = result.content[0]?.text;
  if (!text) {
    throw new Error("Expected MCP text content.");
  }
  return JSON.parse(text) as unknown;
}

describe("buildMcpTools", () => {
  it("exposes exactly five tools with declared read/write effects", () => {
    const tools = buildMcpTools(services());

    expect(tools.map(({ name, effect }) => ({ name, effect }))).toEqual([
      { name: "recall_weakness_patterns", effect: "read" },
      { name: "recall_past_mistakes", effect: "read" },
      { name: "recall_past_problems", effect: "read" },
      { name: "recommend_practice", effect: "read" },
      { name: "save_mistake_book_entry", effect: "write" },
    ]);
  });

  it("strictly rejects unknown, missing, blank, and out-of-range recall input", async () => {
    const tool = findTool(services(), "recall_past_mistakes");

    await expect(
      tool.handler({
        handle: "PatternCoachDev",
        query: "past boundary mistake",
        activeProblemSlug: "binary-search",
        userId: "internal-id-must-not-be-accepted",
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      tool.handler({
        handle: "PatternCoachDev",
        query: "past boundary mistake",
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      tool.handler({
        handle: " ",
        query: "x",
        activeProblemSlug: " ",
        limit: 9,
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it("passes the external handle and active problem context to recall services", async () => {
    const recallPastProblems = vi.fn<McpToolServices["recallPastProblems"]>(
      async () => ({ items: [], retrievalStatus: "full" }),
    );
    const tool = findTool(
      services({ recallPastProblems }),
      "recall_past_problems",
    );

    await tool.handler({
      handle: "PatternCoachDev",
      query: "related binary search problems",
      activeProblemSlug: "binary-search",
      searchHints: ["lower bound"],
      limit: 3,
    });

    expect(recallPastProblems).toHaveBeenCalledWith({
      handle: "PatternCoachDev",
      query: "related binary search problems",
      activeProblemSlug: "binary-search",
      searchHints: ["lower bound"],
      limit: 3,
    });
  });

  it("returns compact text JSON without internal memory fields", async () => {
    const tool = findTool(
      services({
        recallWeaknessPatterns: vi.fn(async () => [
          {
            slotKey: "weakness_patterns",
            title: "Boundary handling",
            summary: "Recheck inclusive bounds.",
            evidenceCount: 4,
          },
        ]),
      }),
      "recall_weakness_patterns",
    );

    const result = await tool.handler({ handle: "PatternCoachDev" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(textJson(result)).toEqual([
      {
        slotKey: "weakness_patterns",
        title: "Boundary handling",
        summary: "Recheck inclusive bounds.",
        evidenceCount: 4,
      },
    ]);
    expect(result.content[0]?.text).not.toMatch(
      /evidenceFactIds|sourceErrors|confidence|candidate-/,
    );
  });

  it("projects recommendation output and withholds completed ids and catalog order", async () => {
    const recommendPractice = vi.fn<McpToolServices["recommendPractice"]>(
      async () => ({
        mode: "reinforce",
        searchedTags: ["binary-search"],
        excludedCompletedIds: ["internal-history-id"],
        recommendationScope: "hot150_same_type",
        usedFallback: false,
        suggestions: [
          {
            title: "Search Insert Position",
            slug: "search-insert-position",
            leetcodeNumber: 35,
            difficulty: "Easy",
            tags: ["binary-search"],
            tier: "hot150",
            order: 9,
            reason: "Reinforces lower-bound boundaries.",
          },
        ],
      }),
    );
    const tool = findTool(
      services({ recommendPractice }),
      "recommend_practice",
    );

    const result = await tool.handler({
      handle: "PatternCoachDev",
      mode: "reinforce",
      tags: ["binary-search"],
      completedIds: ["704"],
      activeProblemSlug: "binary-search",
    });

    expect(recommendPractice).toHaveBeenCalledWith({
      handle: "PatternCoachDev",
      mode: "reinforce",
      tags: ["binary-search"],
      completedIds: ["704"],
      activeProblemSlug: "binary-search",
    });
    expect(JSON.stringify(textJson(result))).not.toMatch(
      /internal-history-id|excludedCompletedIds|"order"/,
    );
  });

  it("validates write context and withholds the persisted entry id", async () => {
    const toolServices = services();
    const tool = findTool(toolServices, "save_mistake_book_entry");

    await expect(
      tool.handler({
        handle: "PatternCoachDev",
        problemSlug: "container-with-most-water",
        title: "Two-pointer invariant",
        guideMarkdown: "Move the shorter side.",
      }),
    ).rejects.toBeInstanceOf(z.ZodError);

    const result = await tool.handler({
      handle: "PatternCoachDev",
      problemSlug: "container-with-most-water",
      chatSessionId: "isolated-chat-session",
      title: "Two-pointer invariant",
      guideMarkdown: "Move the shorter side.",
      tags: ["two_pointers"],
    });

    expect(toolServices.saveMistakeBookEntry).toHaveBeenCalledWith({
      handle: "PatternCoachDev",
      problemSlug: "container-with-most-water",
      chatSessionId: "isolated-chat-session",
      title: "Two-pointer invariant",
      guideMarkdown: "Move the shorter side.",
      tags: ["two_pointers"],
    });
    expect(JSON.stringify(textJson(result))).not.toContain("internal-entry-id");
  });

  it("propagates service failures without fabricating a successful result", async () => {
    const failure = new Error("memory backend unavailable");
    const tool = findTool(
      services({
        recallPastMistakes: vi.fn(async () => {
          throw failure;
        }),
      }),
      "recall_past_mistakes",
    );

    await expect(
      tool.handler({
        handle: "PatternCoachDev",
        query: "past boundary mistake",
        activeProblemSlug: "binary-search",
      }),
    ).rejects.toBe(failure);
  });
});
