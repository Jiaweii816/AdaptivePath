import type { PrismaClient } from "@prisma/client";
import {
  chatToolArgSchemas,
  chatToolNameSchema,
  chatToolResultSchemas,
  type ChatToolArgs,
  type ChatToolName,
} from "./chat-tool-contracts";
import type { CodeRunTestCase, CodeRunnerLanguage } from "@/types/code-runner";
import type { FtsStore } from "@/server/memory/store/fts-store";
import type { CodeRunnerProvider } from "@/server/tools/code-runner/code-runner.types";
import {
  runVerifyProposedRepairChatTool,
  runCurrentCodeChatTool,
} from "./run-code-tool";
import { findPracticeProblemChatTool } from "./find-practice-problem-tool";
import { searchInterviewVariantCandidatesChatTool } from "./search-interview-variant-candidates-tool";
import { getAlgorithmHintChatTool } from "./get-algorithm-hint-tool";
import { lookupApiReferenceChatTool } from "./lookup-api-reference-tool";
import {
  pastMistakeRecallChatTool,
  pastProblemRecallChatTool,
} from "./history-recall-tool";
import { noteMemoryChatTool } from "./note-memory-tool";
import { saveKnowledgeNoteChatTool } from "./save-knowledge-note-tool";
import { saveMistakeBookEntryChatTool } from "./save-mistake-book-entry-tool";
import { recallLearningExperienceChatTool } from "./learning-experience-recall-tool";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import type { CoachMemoryAssembly } from "@/server/memory";
import type { TraceContext } from "@/server/llm/trace-context";

type ExecutableChatToolName = Exclude<ChatToolName, "discover_capability">;

export type ChatToolCallForDispatch = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ChatToolExecutionContext = {
  prisma: PrismaClient;
  userId: string;
  memoryOrigin: MemoryOrigin;
  memoryAssembly?: CoachMemoryAssembly;
  traceContext?: TraceContext;
  chatSessionId: string;
  problem: {
    id: string;
    slug: string;
    title: string;
    leetcodeNumber: number | null;
    methodName: string;
    inputContractJson: string;
    outputContractJson: string;
    isDemoSupported: boolean;
    localRunStatus: string;
    localRunStatusMessage: string | null;
    comparisonStrategy: string;
    comparisonConfigJson: string;
    contractKind: string;
  };
  problemTags: string[];
  learnerWeaknessCues?: string[];
  userMessageId?: string;
  userMessageContent?: string;
  ftsStore?: FtsStore;
  workspace?: {
    code?: string;
    language?: CodeRunnerLanguage;
    codeHash?: string;
    executionFingerprint?: string;
    selectedTests?: CodeRunTestCase[];
  };
  codeRunnerProvider?: CodeRunnerProvider;
};

type ChatToolHandler = {
  argsSchema: (typeof chatToolArgSchemas)[ChatToolName];
  resultSchema: (typeof chatToolResultSchemas)[ChatToolName];
  execute: (
    args: unknown,
    context: ChatToolExecutionContext & { toolCallId: string },
  ) => Promise<unknown>;
};

export type ChatToolDispatchErrorKind =
  | "invalid_tool_name"
  | "invalid_args"
  | "authorization_denied"
  | "handler_error"
  | "invalid_result";

export class ChatToolDispatchError extends Error {
  constructor(
    message: string,
    readonly errorKind: ChatToolDispatchErrorKind,
    readonly details: {
      toolCallId: string;
      toolName?: string;
      issues?: unknown;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "ChatToolDispatchError";
  }
}

export const chatToolDispatchMap = {
  run_current_code: {
    argsSchema: chatToolArgSchemas.run_current_code,
    resultSchema: chatToolResultSchemas.run_current_code,
    execute: (args, context) =>
      runCurrentCodeChatTool(args as ChatToolArgs<"run_current_code">, context),
  },
  verify_proposed_repair: {
    argsSchema: chatToolArgSchemas.verify_proposed_repair,
    resultSchema: chatToolResultSchemas.verify_proposed_repair,
    execute: (args, context) =>
      runVerifyProposedRepairChatTool(
        args as ChatToolArgs<"verify_proposed_repair">,
        context,
      ),
  },
  past_problem_recall: {
    argsSchema: chatToolArgSchemas.past_problem_recall,
    resultSchema: chatToolResultSchemas.past_problem_recall,
    execute: (args, context) =>
      pastProblemRecallChatTool(
        args as ChatToolArgs<"past_problem_recall">,
        context,
      ),
  },
  past_mistake_recall: {
    argsSchema: chatToolArgSchemas.past_mistake_recall,
    resultSchema: chatToolResultSchemas.past_mistake_recall,
    execute: (args, context) =>
      pastMistakeRecallChatTool(
        args as ChatToolArgs<"past_mistake_recall">,
        context,
      ),
  },
  recall_learning_experience: {
    argsSchema: chatToolArgSchemas.recall_learning_experience,
    resultSchema: chatToolResultSchemas.recall_learning_experience,
    execute: (args, context) =>
      recallLearningExperienceChatTool(
        args as ChatToolArgs<"recall_learning_experience">,
        context,
      ),
  },
  find_practice_problem: {
    argsSchema: chatToolArgSchemas.find_practice_problem,
    resultSchema: chatToolResultSchemas.find_practice_problem,
    execute: (args, context) =>
      findPracticeProblemChatTool(
        args as ChatToolArgs<"find_practice_problem">,
        context,
      ),
  },
  search_interview_variant_candidates: {
    argsSchema: chatToolArgSchemas.search_interview_variant_candidates,
    resultSchema: chatToolResultSchemas.search_interview_variant_candidates,
    execute: (args, context) =>
      searchInterviewVariantCandidatesChatTool(
        args as ChatToolArgs<"search_interview_variant_candidates">,
        context,
      ),
  },
  get_algorithm_hint: {
    argsSchema: chatToolArgSchemas.get_algorithm_hint,
    resultSchema: chatToolResultSchemas.get_algorithm_hint,
    execute: (args, context) =>
      getAlgorithmHintChatTool(
        args as ChatToolArgs<"get_algorithm_hint">,
        context,
      ),
  },
  lookup_api_reference: {
    argsSchema: chatToolArgSchemas.lookup_api_reference,
    resultSchema: chatToolResultSchemas.lookup_api_reference,
    execute: (args, context) =>
      lookupApiReferenceChatTool(
        args as ChatToolArgs<"lookup_api_reference">,
        context,
      ),
  },
  note_memory: {
    argsSchema: chatToolArgSchemas.note_memory,
    resultSchema: chatToolResultSchemas.note_memory,
    execute: (args, context) =>
      noteMemoryChatTool(args as ChatToolArgs<"note_memory">, context),
  },
  save_knowledge_note: {
    argsSchema: chatToolArgSchemas.save_knowledge_note,
    resultSchema: chatToolResultSchemas.save_knowledge_note,
    execute: (args, context) =>
      saveKnowledgeNoteChatTool(
        args as ChatToolArgs<"save_knowledge_note">,
        context,
      ),
  },
  save_mistake_book_entry: {
    argsSchema: chatToolArgSchemas.save_mistake_book_entry,
    resultSchema: chatToolResultSchemas.save_mistake_book_entry,
    execute: (args, context) =>
      saveMistakeBookEntryChatTool(
        args as ChatToolArgs<"save_mistake_book_entry">,
        context,
      ),
  },
} satisfies Record<ExecutableChatToolName, ChatToolHandler>;

export type PreparedChatToolCall = {
  id: string;
  name: ChatToolName;
  arguments: unknown;
};

export type ResolvedChatToolCall = {
  id: string;
  name: ChatToolName;
  arguments: unknown;
};

export function resolveChatToolCallName(
  toolCall: ChatToolCallForDispatch,
): ResolvedChatToolCall {
  const parsedName = chatToolNameSchema.safeParse(toolCall.name);
  if (!parsedName.success) {
    throw new ChatToolDispatchError(
      `Chat tool name is invalid: ${toolCall.name}`,
      "invalid_tool_name",
      {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        issues: parsedName.error.issues,
      },
    );
  }

  return { ...toolCall, name: parsedName.data };
}

export function assertChatToolAvailableThisTurn(
  toolCall: ResolvedChatToolCall,
  availableToolNames: ReadonlySet<ChatToolName>,
) {
  if (!availableToolNames.has(toolCall.name)) {
    throw new ChatToolDispatchError(
      `Chat tool ${toolCall.name} is not available in this turn plan.`,
      "authorization_denied",
      {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        cause: "tool_not_available_this_turn",
      },
    );
  }
}

export function prepareResolvedChatToolCall(
  toolCall: ResolvedChatToolCall,
): PreparedChatToolCall {
  if (toolCall.name === "discover_capability") {
    throw new ChatToolDispatchError(
      "discover_capability is handled by the bounded loop.",
      "invalid_tool_name",
      { toolCallId: toolCall.id, toolName: toolCall.name },
    );
  }
  const parsedArgs = chatToolDispatchMap[toolCall.name].argsSchema.safeParse(
    toolCall.arguments,
  );
  if (!parsedArgs.success) {
    throw new ChatToolDispatchError(
      `Invalid arguments for chat tool ${toolCall.name}.`,
      "invalid_args",
      {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        issues: parsedArgs.error.issues,
      },
    );
  }

  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: parsedArgs.data,
  };
}

export function prepareChatToolCall(
  toolCall: ChatToolCallForDispatch,
): PreparedChatToolCall {
  return prepareResolvedChatToolCall(resolveChatToolCallName(toolCall));
}

export async function dispatchPreparedChatToolCall(
  toolCall: PreparedChatToolCall,
  context: ChatToolExecutionContext,
) {
  const handler = chatToolDispatchMap[toolCall.name as ExecutableChatToolName];

  let rawResult: unknown;
  try {
    rawResult = await handler.execute(toolCall.arguments, {
      ...context,
      toolCallId: toolCall.id,
    });
  } catch (error) {
    throw new ChatToolDispatchError(
      `Chat tool ${toolCall.name} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "handler_error",
      {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        cause: error,
      },
    );
  }

  const parsedResult = handler.resultSchema.safeParse(rawResult);
  if (!parsedResult.success) {
    throw new ChatToolDispatchError(
      `Invalid result from chat tool ${toolCall.name}.`,
      "invalid_result",
      {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        issues: parsedResult.error.issues,
      },
    );
  }

  return {
    name: toolCall.name,
    result: parsedResult.data,
  };
}

export async function dispatchChatToolCall(
  toolCall: ChatToolCallForDispatch,
  context: ChatToolExecutionContext,
) {
  return dispatchPreparedChatToolCall(prepareChatToolCall(toolCall), context);
}
