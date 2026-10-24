import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import type { TraceContext, TraceStep } from "@/server/llm/trace-context";
import type { ChatToolRuntimeDenialReason } from "@/server/tools/chat-tools/chat-tool-runtime";
import { ChatToolDispatchError } from "@/server/tools/chat-tools/chat-tool-dispatch";
import type {
  CoachToolCall,
  CurrentWorkspaceContext,
} from "./coach-agent.types";

type SharedToolTraceArgs = {
  userId: string;
  problemId: string;
  chatSessionId: string;
  responseLanguage: "zh" | "en";
  sequence: number;
  toolCall: CoachToolCall;
  traceContext: TraceContext;
  step?: TraceStep;
};

export async function appendToolCallTrace(
  args: SharedToolTraceArgs & { workspaceContext: CurrentWorkspaceContext },
) {
  await appendTraceEventBestEffort(args.traceContext, {
    step: args.step,
    stage: "bounded_agent_loop",
    kind: "tool",
    title: `Tool call · ${args.toolCall.name}`,
    status: "started",
    details: {
      input: redactToolArguments({
        toolName: args.toolCall.name,
        rawArguments: args.toolCall.arguments,
        workspaceContext: args.workspaceContext,
      }),
      metadata: traceMetadata(args, "call"),
    },
  });
}

function redactToolArguments(args: {
  toolName: string;
  rawArguments: unknown;
  workspaceContext: CurrentWorkspaceContext;
}) {
  if (typeof args.rawArguments === "string") {
    return { invalidJson: true, rawLength: args.rawArguments.length };
  }
  if (args.toolName === "save_knowledge_note") {
    return redactKnowledgeNoteArguments(args.rawArguments);
  }
  if (args.toolName === "save_mistake_book_entry") {
    return redactMistakeBookEntryArguments(args.rawArguments);
  }
  if (!isRunTool(args.toolName)) return args.rawArguments;
  return redactRunArguments(args);
}

function isRunTool(name: string) {
  return name === "run_current_code" || name === "verify_proposed_repair";
}

function redactRunArguments(args: {
  toolName: string;
  rawArguments: unknown;
  workspaceContext: CurrentWorkspaceContext;
}) {
  if (!args.rawArguments || typeof args.rawArguments !== "object" || Array.isArray(args.rawArguments)) {
    return args.rawArguments;
  }
  const value = { ...(args.rawArguments as Record<string, unknown>) };
  const codeField = args.toolName === "verify_proposed_repair"
    ? "candidateCode"
    : "code";
  const code = value[codeField];
  if (typeof code !== "string") return value;
  const current =
    args.toolName === "run_current_code" &&
    value[codeField] === args.workspaceContext.currentCode;
  value[codeField] = {
    redacted: true,
    source: current ? "current_workspace" : "tool_argument",
    codeHash: current ? (args.workspaceContext.currentCodeHash ?? null) : null,
    length: code.length,
  };
  return value;
}

function redactKnowledgeNoteArguments(rawArguments: unknown) {
  if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
    return rawArguments;
  }
  const value = { ...(rawArguments as Record<string, unknown>) };
  if (typeof value.snippet === "string") {
    value.snippet = { redacted: true, length: value.snippet.length };
  }
  return value;
}

function redactMistakeBookEntryArguments(rawArguments: unknown) {
  if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
    return rawArguments;
  }
  const value = rawArguments as Record<string, unknown>;
  return {
    ...value,
    guideMarkdown: redactText(value.guideMarkdown, "guide markdown"),
    selfCheckAnswer: redactText(value.selfCheckAnswer, "self-check answer"),
  };
}

function redactText(value: unknown, label: string) {
  return typeof value === "string"
    ? `[redacted ${label}: ${value.length} chars]`
    : value;
}

export async function appendToolResultTrace(
  args: SharedToolTraceArgs & {
    toolName?: string;
    toolResult?: unknown;
    status: "ok" | "reused" | "denied" | "error";
    latencyMs: number;
    error?: unknown;
    runtimeDisposition?: "executed" | "reused" | "denied" | "error";
    runtimeReason?: ChatToolRuntimeDenialReason | "tool_execution_error";
    outcomeUtility?: "useful" | "non_verdict" | "not_applicable";
    operationalPreconditionJson?: string;
    operationalContractVersion?: string;
  },
) {
  const stats = args.status !== "error" ? summarizeToolResultSize(args.toolResult) : null;
  const normalized = args.status === "error" ? normalizeToolTraceError(args.error) : null;
  const toolName = args.toolName ?? normalized?.toolName ?? args.toolCall.name;
  await appendTraceEventBestEffort(args.traceContext, {
    step: args.step,
    stage: "bounded_agent_loop",
    kind: "tool",
    title: `Tool result · ${toolName}`,
    status: traceStatus(args.status),
    durationMs: args.latencyMs,
    details: {
      output:
        args.status !== "error"
          ? resultForTrace(toolName, args.toolResult)
          : { error: normalized?.error ?? null },
      metadata: {
        ...traceMetadata(args, "result"),
        toolName,
        status: args.status,
        runtimeDisposition: args.runtimeDisposition ?? null,
        runtimeReason: args.runtimeReason ?? null,
        errorKind: normalized?.errorKind ?? null,
        resultCharLength: stats?.charLength ?? null,
        approxResultTokens: stats?.approxTokens ?? null,
        outcomeUtility: args.outcomeUtility ?? null,
        operationalPreconditionJson: args.operationalPreconditionJson ?? null,
        operationalContractVersion: args.operationalContractVersion ?? null,
      },
    },
  });
}

/** Web snippets are transient retrieval material, not durable trace content. */
function resultForTrace(toolName: string, result: unknown) {
  if (toolName !== "search_interview_variant_candidates") return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { redacted: true, reason: "invalid_web_result" };
  }
  const value = result as Record<string, unknown>;
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  return {
    status: value.status ?? null,
    anchorProblem: value.anchorProblem ?? null,
    searchWindow: value.searchWindow ?? null,
    retrievalStage: value.retrievalStage ?? null,
    candidateCount: candidates.length,
    sourceHosts: candidates
      .map((candidate) =>
        candidate && typeof candidate === "object"
          ? (candidate as Record<string, unknown>).sourceHost
          : undefined,
      )
      .filter((host): host is string => typeof host === "string")
      .slice(0, 3),
    webSnippetRedacted: true,
  };
}

function traceMetadata(args: SharedToolTraceArgs, eventRole: "call" | "result") {
  return {
    source: "chat_reply",
    chatSessionId: args.chatSessionId,
    toolCallId: args.toolCall.id,
    toolName: args.toolCall.name,
    eventRole,
    sequence: args.sequence,
    responseLanguage: args.responseLanguage,
  };
}

function traceStatus(status: "ok" | "reused" | "denied" | "error") {
  return status === "error"
    ? ("failed" as const)
    : status === "denied"
      ? ("skipped" as const)
      : ("succeeded" as const);
}

function summarizeToolResultSize(result: unknown) {
  const charLength = JSON.stringify(result ?? null).length;
  return { charLength, approxTokens: Math.ceil(charLength / 4) };
}

function normalizeToolTraceError(error: unknown) {
  if (error instanceof ChatToolDispatchError) {
    return {
      toolName: error.details.toolName,
      errorKind: error.errorKind,
      error: {
        type: error.name,
        message: error.message,
        issues: error.details.issues,
        cause: normalizeCause(error.details.cause),
      },
    };
  }
  return {
    toolName: undefined,
    errorKind: "handler_error",
    error: {
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function normalizeCause(cause: unknown) {
  if (cause instanceof Error) return { type: cause.name, message: cause.message };
  return cause ? { message: String(cause) } : null;
}
