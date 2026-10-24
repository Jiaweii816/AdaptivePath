import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { arbitrateFactCandidates } from "@/server/memory/store/fact-store";
import { resolveRequestedActions } from "./requested-actions/resolve-requested-actions";
import type { ChatToolExecutionContext } from "./chat-tool-dispatch";
import type { ChatToolArgs, ChatToolResult } from "./chat-tool-contracts";

export async function noteMemoryChatTool(
  args: ChatToolArgs<"note_memory">,
  context: ChatToolExecutionContext & { toolCallId: string },
): Promise<ChatToolResult<"note_memory">> {
  const explicitPreferenceRequest = resolveRequestedActions(
    context.userMessageContent ?? "",
  ).some(
    (action) =>
      action.toolName === "note_memory" && action.decision === "granted",
  );
  if (!explicitPreferenceRequest) {
    return {
      saved: false,
      factType: "preference",
      tag: args.tag,
      value: args.value,
      message: "Not saved: preference_requires_explicit_user_request",
    };
  }

  const note = await appendL1TraceEvent(context.prisma, {
    userId: context.userId,
    problemId: context.problem.id,
    chatSessionId: context.chatSessionId,
    eventType: "memory_note",
    source: "note_memory_tool",
    memoryOrigin: context.memoryOrigin,
    content: args.value,
    eventJson: {
      tag: args.tag,
      toolCallId: context.toolCallId,
    },
  });

  const { updated, rejected } = await arbitrateFactCandidates(context.prisma, {
    userId: context.userId,
    problemId: context.problem.id,
    source: "user_explicit",
    candidates: [
      {
        factType: "preference",
        tag: args.tag,
        value: args.value,
        evidenceKind: "preference_set",
        observedBehavior: `user explicitly asked to remember: ${args.value.slice(0, 120)}`,
        evidenceTraceIds: [note.id],
      },
    ],
  });

  if (updated.length === 0) {
    return {
      saved: false,
      factType: "preference",
      tag: args.tag,
      value: args.value,
      message: `Not saved: ${rejected[0]?.reason ?? "arbitration rejected the candidate"}`,
    };
  }

  return {
    saved: true,
    factType: "preference",
    tag: updated[0].tag,
    value: args.value,
    message: "Preference saved to long-term memory and effective immediately.",
  };
}
