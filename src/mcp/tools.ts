import { z } from "zod";
import type {
  MistakeView,
  ProblemView,
  RecallResult,
  WeaknessSlotView,
} from "./memory-read-service";
import type {
  ChatToolArgs,
  ChatToolResult,
} from "@/server/tools/chat-tools/chat-tool-contracts";

export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpToolResult = {
  content: McpTextContent[];
};

export type McpToolEffect = "read" | "write";

export type McpToolDef = {
  name: string;
  description: string;
  effect: McpToolEffect;
  inputSchema: z.ZodRawShape;
  handler(args: Record<string, unknown>): Promise<McpToolResult>;
};

export type RecallWeaknessPatternsInput = {
  handle: string;
};

export type RecallHistoryInput = {
  handle: string;
  query: string;
  activeProblemSlug: string;
  searchHints?: string[];
  limit?: number;
};

export type RecommendPracticeInput = {
  handle: string;
  mode: ChatToolArgs<"find_practice_problem">["mode"];
  tags: string[];
  completedIds?: string[];
  activeProblemSlug?: string;
};

export type SaveMistakeBookEntryInput =
  ChatToolArgs<"save_mistake_book_entry"> & {
    handle: string;
    problemSlug: string;
    chatSessionId: string;
  };

export type McpToolServices = {
  recallWeaknessPatterns(
    input: RecallWeaknessPatternsInput,
  ): Promise<WeaknessSlotView[]>;
  recallPastMistakes(
    input: RecallHistoryInput,
  ): Promise<RecallResult<MistakeView>>;
  recallPastProblems(
    input: RecallHistoryInput,
  ): Promise<RecallResult<ProblemView>>;
  recommendPractice(
    input: RecommendPracticeInput,
  ): Promise<ChatToolResult<"find_practice_problem">>;
  saveMistakeBookEntry(
    input: SaveMistakeBookEntryInput,
  ): Promise<ChatToolResult<"save_mistake_book_entry">>;
};

const handleShape = {
  handle: z.string().trim().min(1).max(80),
} satisfies z.ZodRawShape;

const recallHistoryShape = {
  ...handleShape,
  query: z.string().trim().min(2).max(300),
  activeProblemSlug: z.string().trim().min(1).max(120),
  searchHints: z.array(z.string().trim().min(1).max(100)).max(8).optional(),
  limit: z.number().int().min(1).max(8).optional(),
} satisfies z.ZodRawShape;

const recommendPracticeShape = {
  ...handleShape,
  mode: z.enum(["advance", "reinforce"]),
  tags: z.array(z.string().trim().min(1).max(80)).max(8),
  completedIds: z.array(z.string().trim().min(1).max(80)).max(80).optional(),
  activeProblemSlug: z.string().trim().min(1).max(120).optional(),
} satisfies z.ZodRawShape;

const saveMistakeBookEntryShape = {
  ...handleShape,
  problemSlug: z.string().trim().min(1).max(120),
  chatSessionId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(90),
  guideMarkdown: z.string().trim().min(1).max(2200),
  selfCheckQuestion: z.string().trim().min(1).max(180).optional(),
  selfCheckAnswer: z.string().trim().min(1).max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
} satisfies z.ZodRawShape;

export function buildMcpTools(services: McpToolServices): McpToolDef[] {
  return [
    defineTool({
      name: "recall_weakness_patterns",
      description:
        "Return compact active weakness patterns for a learner handle. Read-only.",
      effect: "read",
      inputSchema: handleShape,
      execute: async (input) =>
        (await services.recallWeaknessPatterns(input)).map((slot) => ({
          slotKey: slot.slotKey,
          title: slot.title,
          summary: slot.summary,
          evidenceCount: slot.evidenceCount,
        })),
    }),
    defineTool({
      name: "recall_past_mistakes",
      description:
        "Recall compact learner-owned mistake history relevant to the active problem. Read-only.",
      effect: "read",
      inputSchema: recallHistoryShape,
      execute: async (input) =>
        compactRecallResult(await services.recallPastMistakes(input)),
    }),
    defineTool({
      name: "recall_past_problems",
      description:
        "Recall compact learner-owned problem history relevant to the active problem. Read-only.",
      effect: "read",
      inputSchema: recallHistoryShape,
      execute: async (input) =>
        compactRecallResult(await services.recallPastProblems(input)),
    }),
    defineTool({
      name: "recommend_practice",
      description:
        "Recommend compact metadata-only practice problems from the controlled catalog. Read-only.",
      effect: "read",
      inputSchema: recommendPracticeShape,
      execute: async (input) =>
        compactPracticeResult(await services.recommendPractice(input)),
    }),
    defineTool({
      name: "save_mistake_book_entry",
      description:
        "Save an active-problem review guide. Write access requires the MCP governance gateway.",
      effect: "write",
      inputSchema: saveMistakeBookEntryShape,
      execute: async (input) =>
        compactSaveResult(await services.saveMistakeBookEntry(input)),
    }),
  ];
}

function defineTool<TShape extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  effect: McpToolEffect;
  inputSchema: TShape;
  execute(input: z.infer<z.ZodObject<TShape>>): Promise<unknown>;
}): McpToolDef {
  const schema = z.object(definition.inputSchema).strict();
  return {
    name: definition.name,
    description: definition.description,
    effect: definition.effect,
    inputSchema: definition.inputSchema,
    handler: async (args) => asText(await definition.execute(schema.parse(args))),
  };
}

function compactRecallResult(result: RecallResult<MistakeView>) {
  return {
    retrievalStatus: result.retrievalStatus,
    items: result.items.map((item) => ({
      title: item.title,
      summary: item.summary,
      sourceProblem: item.sourceProblem,
      outcome: item.outcome,
      relationToCurrent: item.relationToCurrent,
    })),
  };
}

function compactPracticeResult(
  result: ChatToolResult<"find_practice_problem">,
) {
  return {
    mode: result.mode,
    searchedTags: result.searchedTags,
    recommendationScope: result.recommendationScope,
    transitionMessage: result.transitionMessage,
    usedFallback: result.usedFallback,
    suggestions: result.suggestions.map((suggestion) => ({
      title: suggestion.title,
      slug: suggestion.slug,
      leetcodeNumber: suggestion.leetcodeNumber,
      difficulty: suggestion.difficulty,
      tags: suggestion.tags,
      tier: suggestion.tier,
      reason: suggestion.reason,
    })),
  };
}

function compactSaveResult(
  result: ChatToolResult<"save_mistake_book_entry">,
) {
  return {
    saved: result.saved,
    problemSlug: result.problemSlug,
    title: result.title,
    saveCount: result.saveCount,
    message: result.message,
  };
}

function asText(value: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}
