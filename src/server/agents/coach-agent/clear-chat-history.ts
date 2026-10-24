import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { irisHandle } from "@/features/onboarding/profile-defaults";
import {
  parseMemoryOrigin,
  resolveMemoryOrigin,
} from "@/server/memory/memory-origin";
import prisma from "@/server/db/prisma";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  sealChatActivityBoundary,
  type EnqueueActivityExtraction,
} from "@/server/memory/activity-clusters/seal-chat-activity-boundary";
import { ACTIVITY_EXTRACTION_VERSION } from "@/server/memory/activity-clusters/activity-cluster.types";
import { enqueueActivityExtraction as enqueueActivityExtractionJob } from "@/server/jobs/enqueue-activity-extraction";

export const clearChatHistoryRequestSchema = z
  .object({
    chatSessionId: z.string().trim().min(1).optional(),
    problemId: z.string().trim().min(1).optional(),
    problemSlug: z.string().trim().min(1).optional(),
  })
  .refine(
    (value) => value.chatSessionId || value.problemId || value.problemSlug,
    {
      message: "A chatSessionId, problemId, or problemSlug is required.",
      path: ["chatSessionId"],
    },
  );

export type ClearChatHistoryRequest = z.infer<
  typeof clearChatHistoryRequestSchema
>;

export type ClearChatHistoryResult = {
  ok: true;
  chatSessionId: string | null;
  clearedBeforeSequence: number;
  clearedAt: string | null;
  hiddenMessageCount: number;
};

type ChatSessionForClear = {
  id: string;
  userId: string;
  problemId: string;
  memoryOrigin: string;
  clearedBeforeSequence: number;
};

export type ClearCoachChatHistoryDeps = {
  database?: PrismaClient;
  enqueueActivityExtraction?: EnqueueActivityExtraction;
  enqueueJob?: typeof enqueueActivityExtractionJob;
  sealBoundary?: typeof sealChatActivityBoundary;
};

export async function clearCoachChatHistory(
  rawInput: unknown,
  deps: ClearCoachChatHistoryDeps = {},
): Promise<ClearChatHistoryResult> {
  const input = clearChatHistoryRequestSchema.parse(rawInput);
  const database = deps.database ?? prisma;
  const user = await database.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });

  const chatSession = await findChatSessionForClear(database, {
    userId: user.id,
    input,
  });

  if (!chatSession) {
    return {
      ok: true,
      chatSessionId: null,
      clearedBeforeSequence: 0,
      clearedAt: null,
      hiddenMessageCount: 0,
    };
  }

  const enqueueActivityExtraction =
    deps.enqueueActivityExtraction ??
    (await buildProductionExtractionDispatch(
      database,
      chatSession,
      deps.enqueueJob ?? enqueueActivityExtractionJob,
    ));
  const boundary = await (deps.sealBoundary ?? sealChatActivityBoundary)(
    database,
    {
      chatSessionId: chatSession.id,
      boundaryReason: "chat_clear",
      expectedOwner: {
        userId: chatSession.userId,
        problemId: chatSession.problemId,
        memoryOrigin: parseMemoryOrigin(chatSession.memoryOrigin),
      },
      enqueueActivityExtraction,
    },
  );
  const clearedAt = new Date();
  const result = await database.$transaction(async (tx) => {
    const previousBoundary = chatSession.clearedBeforeSequence;
    const clearedBeforeSequence = Math.max(
      previousBoundary,
      boundary.boundarySequence,
    );
    const hiddenMessageCount = await tx.chatMessage.count({
      where: {
        sessionId: chatSession.id,
        sequence: {
          gt: previousBoundary,
          lte: clearedBeforeSequence,
        },
      },
    });

    await tx.chatSession.update({
      where: { id: chatSession.id },
      data: {
        clearedBeforeSequence,
        clearedAt,
        rollingSummary: null,
        lastConsolidatedMessageId: null,
      },
    });

    await appendL1TraceEvent(tx, {
      userId: chatSession.userId,
      problemId: chatSession.problemId,
      chatSessionId: chatSession.id,
      eventType: "chat_history_cleared",
      source: "chat_history_clear",
      content: `cleared visible chat history before sequence ${clearedBeforeSequence}`,
      occurredAt: clearedAt,
      eventJson: {
        chatSessionId: chatSession.id,
        previousClearedBeforeSequence: previousBoundary,
        clearedBeforeSequence,
        hiddenMessageCount,
      },
    });

    return { clearedBeforeSequence, hiddenMessageCount };
  });

  return {
    ok: true,
    chatSessionId: chatSession.id,
    clearedBeforeSequence: result.clearedBeforeSequence,
    clearedAt: clearedAt.toISOString(),
    hiddenMessageCount: result.hiddenMessageCount,
  };
}

async function buildProductionExtractionDispatch(
  database: PrismaClient,
  chatSession: ChatSessionForClear,
  enqueueJob: typeof enqueueActivityExtractionJob,
): Promise<EnqueueActivityExtraction | undefined> {
  if (parseMemoryOrigin(chatSession.memoryOrigin) !== "learner") {
    return undefined;
  }
  const [pendingLearnerMessage, queuedReceipts, root] = await Promise.all([
    database.chatMessage.findFirst({
      where: {
        sessionId: chatSession.id,
        memoryOrigin: "learner",
        reviewAttemptId: null,
        role: "user",
        sequence: { gt: chatSession.clearedBeforeSequence },
      },
      select: { id: true },
    }),
    database.memoryExtractionReceipt.findMany({
      where: {
        status: { in: ["queued", "failed"] },
        extractorVersion: ACTIVITY_EXTRACTION_VERSION,
        activityCluster: {
          chatSessionId: chatSession.id,
          clusterKind: "chat_only",
          memoryOrigin: "learner",
        },
      },
      select: { activityClusterId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 3,
    }),
    database.agentTraceRun.findFirst({
      where: {
        userId: chatSession.userId,
        problemId: chatSession.problemId,
        chatSessionId: chatSession.id,
        memoryOrigin: "learner",
        parentTraceRunId: null,
      },
      orderBy: [{ turnOrdinal: "desc" }, { startedAt: "desc" }],
      select: { id: true },
    }),
  ]);
  if (!pendingLearnerMessage && queuedReceipts.length === 0) return undefined;
  if (!root) throw new Error("chat_activity_extraction_origin_not_found");

  // A previous clear may have sealed a receipt before its dispatch failed.
  // Re-dispatching is safe: the receipt claim is the one-provider-call lock.
  for (const receipt of queuedReceipts) {
    await enqueueJob(database, {
      activityClusterId: receipt.activityClusterId,
      extractorVersion: ACTIVITY_EXTRACTION_VERSION,
      originatingTraceRunId: root.id,
    });
  }
  return ({ activityClusterId, extractorVersion }) =>
    enqueueJob(database, {
      activityClusterId,
      extractorVersion,
      originatingTraceRunId: root.id,
    });
}

async function findChatSessionForClear(
  database: PrismaClient,
  args: {
    userId: string;
    input: ClearChatHistoryRequest;
  },
): Promise<ChatSessionForClear | null> {
  const memoryOrigin = resolveMemoryOrigin();
  if (args.input.chatSessionId) {
    return database.chatSession.findFirst({
      where: {
        id: args.input.chatSessionId,
        userId: args.userId,
        memoryOrigin,
      },
      select: {
        id: true,
        userId: true,
        problemId: true,
        memoryOrigin: true,
        clearedBeforeSequence: true,
      },
    });
  }

  const problem = await database.problem.findFirst({
    where: {
      OR: [
        args.input.problemId ? { id: args.input.problemId } : undefined,
        args.input.problemSlug ? { slug: args.input.problemSlug } : undefined,
      ].filter(Boolean) as Array<{ id: string } | { slug: string }>,
    },
    select: { id: true },
  });

  if (!problem) {
    return null;
  }

  return database.chatSession.findUnique({
    where: {
      userId_problemId_memoryOrigin: {
        userId: args.userId,
        problemId: problem.id,
        memoryOrigin,
      },
    },
    select: {
      id: true,
      userId: true,
      problemId: true,
      memoryOrigin: true,
      clearedBeforeSequence: true,
    },
  });
}
