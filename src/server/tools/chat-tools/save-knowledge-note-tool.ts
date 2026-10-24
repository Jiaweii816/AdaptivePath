import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  upsertKnowledgeNoteFromCoach,
} from "@/server/memory/store/knowledge-note-store";
import type { ChatToolArgs, ChatToolResult } from "./chat-tool-contracts";
import type { ChatToolExecutionContext } from "./chat-tool-dispatch";

export async function saveKnowledgeNoteChatTool(
  args: ChatToolArgs<"save_knowledge_note">,
  context: ChatToolExecutionContext & { toolCallId: string },
): Promise<ChatToolResult<"save_knowledge_note">> {
  const trace = await appendL1TraceEvent(context.prisma, {
    userId: context.userId,
    problemId: context.problem.id,
    chatSessionId: context.chatSessionId,
    eventType: "knowledge_note",
    source: "save_knowledge_note_tool",
    memoryOrigin: context.memoryOrigin,
    content: `${args.title}: ${args.whenToUse}`,
    eventJson: {
      conceptKey: args.conceptKey,
      toolCallId: context.toolCallId,
    },
  });

  const result = await upsertKnowledgeNoteFromCoach(context.prisma, {
    userId: context.userId,
    note: args,
    traceId: trace.id,
    skipLookupIncrementForExisting: false,
    ftsStore: context.ftsStore,
  });

  if (!result.saved) {
    return {
      saved: false,
      noteId: null,
      conceptKey: args.conceptKey,
      title: args.title,
      alreadyExisted: false,
      lookupCount: 0,
      message: `Not saved: ${result.reason}`,
    };
  }

  const editedSuffix = result.note.userEdited
    ? "；这张卡被你手动编辑过，内容已保留，建议去知识手册手动扩展"
    : "";

  return {
    saved: true,
    noteId: result.note.id,
    conceptKey: result.note.conceptKey,
    title: result.note.title,
    alreadyExisted: result.alreadyExisted,
    lookupCount: result.note.lookupCount,
    message: result.alreadyExisted
      ? `知识手册已有这张卡（第 ${result.note.lookupCount} 次）${editedSuffix}`
      : `已存入知识手册（第 ${result.note.lookupCount} 次）`,
  };
}
