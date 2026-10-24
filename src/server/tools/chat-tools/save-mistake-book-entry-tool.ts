import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { upsertMistakeBookEntryFromCoach } from "@/server/memory/store/mistake-book-entry-store";
import {
  memoryRetrievalIndexRefId,
  projectMistakeBookEntry,
  reconcileMistakeBookRetrievalDocument,
  retrievalDocumentFtsContent,
} from "@/server/memory/store/retrieval-document-store";
import { getDefaultFtsStore } from "@/server/memory/store/fts-store";
import { enqueueEmbedBackfill } from "@/server/jobs/enqueue-embed-backfill";
import type { ChatToolArgs, ChatToolResult } from "./chat-tool-contracts";
import type { ChatToolExecutionContext } from "./chat-tool-dispatch";

export async function saveMistakeBookEntryChatTool(
  args: ChatToolArgs<"save_mistake_book_entry">,
  context: ChatToolExecutionContext & { toolCallId: string },
): Promise<ChatToolResult<"save_mistake_book_entry">> {
  const latestReviewAttempt = await context.prisma.reviewAttempt.findFirst({
    where: {
      userId: context.userId,
      problemId: context.problem.id,
      chatSessionId: context.chatSessionId,
      memoryOrigin: context.memoryOrigin,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const trace = await appendL1TraceEvent(context.prisma, {
    userId: context.userId,
    problemId: context.problem.id,
    chatSessionId: context.chatSessionId,
    reviewAttemptId: latestReviewAttempt?.id,
    eventType: "mistake_book_entry",
    source: "save_mistake_book_entry_tool",
    memoryOrigin: context.memoryOrigin,
    content: `${context.problem.title}: ${args.title}`,
    eventJson: {
      title: args.title,
      problemSlug: context.problem.slug,
      tags: args.tags ?? [],
      toolCallId: context.toolCallId,
    },
  });

  const result = await upsertMistakeBookEntryFromCoach(context.prisma, {
    userId: context.userId,
    problemId: context.problem.id,
    chatSessionId: context.chatSessionId,
    reviewAttemptId: latestReviewAttempt?.id,
    entry: args,
    traceId: trace.id,
    memoryOrigin: context.memoryOrigin,
  });

  if (!result.saved) {
    return {
      saved: false,
      entryId: null,
      problemSlug: context.problem.slug,
      title: args.title,
      saveCount: 0,
      message: `Not saved: ${result.reason}`,
      recallIndexStatus: "pending_repair",
    };
  }

  let recallIndexStatus: "ready" | "pending_repair" = "ready";
  try {
    const entry = await context.prisma.mistakeBookEntry.findUniqueOrThrow({
      where: { id: result.entry.id },
      include: { problem: true },
    });
    const document = projectMistakeBookEntry(entry)[0];
    if (!document) throw new Error("mistake-book retrieval projection unavailable");
    (context.ftsStore ?? getDefaultFtsStore()).indexMemoryDocument({
      kind: document.ftsKind,
      refId: memoryRetrievalIndexRefId(document),
      content: retrievalDocumentFtsContent(document),
      learnerId: context.userId,
    });
  } catch {
    recallIndexStatus = "pending_repair";
    await appendL1TraceEvent(context.prisma, {
      userId: context.userId,
      problemId: context.problem.id,
      chatSessionId: context.chatSessionId,
      reviewAttemptId: latestReviewAttempt?.id,
      eventType: "mistake_book_retrieval_index_pending_repair",
      source: "save_mistake_book_entry_tool",
      memoryOrigin: context.memoryOrigin,
      content: `${context.problem.title}: retrieval index pending repair`,
      eventJson: { entryId: result.entry.id, toolCallId: context.toolCallId },
    }).catch(() => undefined);
    scheduleMistakeBookIndexRepair(context, result.entry.id);
  }

  if (recallIndexStatus === "ready") {
    scheduleEmbeddingBackfill(context);
  }

  return {
    saved: true,
    entryId: result.entry.id,
    problemSlug: context.problem.slug,
    title: result.entry.title,
    saveCount: result.entry.saveCount,
    message: recallIndexStatus === "ready"
      ? `已收录到错题本（第 ${result.entry.saveCount} 次）`
      : `已收录到错题本，但检索索引等待修复`,
    recallIndexStatus,
  };
}

function scheduleMistakeBookIndexRepair(
  context: ChatToolExecutionContext,
  entryId: string,
) {
  if (context.memoryOrigin !== "learner") return;
  void Promise.resolve()
    .then(() =>
      reconcileMistakeBookRetrievalDocument(context.prisma, {
        userId: context.userId,
        entryId,
        ftsStore: context.ftsStore ?? getDefaultFtsStore(),
      }),
    )
    .then(() => scheduleEmbeddingBackfill(context))
    .catch(() => {
      // The user-visible receipt already says pending_repair. Reconciliation
      // is intentionally best-effort and never rewrites the durable entry.
    });
}

function scheduleEmbeddingBackfill(context: ChatToolExecutionContext) {
  if (context.memoryOrigin !== "learner") return;
  void enqueueEmbedBackfill(context.prisma, {
    originatingTraceRunId: context.traceContext?.traceRunId,
  }).catch(() => {
    // Embeddings are a rebuildable projection; lexical retrieval remains live.
  });
}
