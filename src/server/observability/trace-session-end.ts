import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseMemoryOrigin } from "@/server/memory/memory-origin";
import {
  sealChatActivityBoundary,
  type EnqueueActivityExtraction,
} from "@/server/memory/activity-clusters/seal-chat-activity-boundary";
import { ACTIVITY_EXTRACTION_VERSION } from "@/server/memory/activity-clusters/activity-cluster.types";
import { enqueueActivityExtraction as enqueueActivityExtractionJob } from "@/server/jobs/enqueue-activity-extraction";

export const traceSessionEndInputSchema = z.object({
  userId: z.string().min(1),
  browserInstanceId: z.string().min(1),
  problemId: z.string().min(1),
  reason: z.enum(["problem_changed", "workbench_navigation", "explicit_exit"]),
}).strict();

export async function endTraceSession(
  prisma: PrismaClient,
  rawInput: z.input<typeof traceSessionEndInputSchema>,
  now = new Date(),
  deps: {
    enqueueActivityExtraction?: EnqueueActivityExtraction;
    enqueueJob?: typeof enqueueActivityExtractionJob;
    sealBoundary?: typeof sealChatActivityBoundary;
  } = {},
) {
  const input = traceSessionEndInputSchema.parse(rawInput);
  const activeSession = await prisma.problemWorkspaceSession.findFirst({
    where: {
      userId: input.userId,
      problemId: input.problemId,
      browserInstanceId: input.browserInstanceId,
      foregroundStatus: "active",
    },
  });
  if (!activeSession) {
    return {
      ok: true as const,
      ended: false,
      sessionId: null,
      foregroundStatus: null,
    };
  }

  const memoryOrigin = parseMemoryOrigin(activeSession.memoryOrigin);
  const chatSession = await prisma.chatSession.findUnique({
    where: {
      userId_problemId_memoryOrigin: {
        userId: input.userId,
        problemId: input.problemId,
        memoryOrigin,
      },
    },
  });
  if (chatSession) {
    const enqueueActivityExtraction =
      deps.enqueueActivityExtraction ??
      (await buildProductionExtractionDispatch(prisma, {
        workspaceSessionId: activeSession.id,
        chatSessionId: chatSession.id,
        userId: input.userId,
        problemId: input.problemId,
        memoryOrigin,
        clearedBeforeSequence: chatSession.clearedBeforeSequence,
        enqueueJob: deps.enqueueJob ?? enqueueActivityExtractionJob,
      }));
    await (deps.sealBoundary ?? sealChatActivityBoundary)(prisma, {
      chatSessionId: chatSession.id,
      boundaryReason: input.reason,
      expectedOwner: {
        userId: input.userId,
        problemId: input.problemId,
        memoryOrigin,
      },
      enqueueActivityExtraction,
    });
  }

  return prisma.$transaction(async (tx) =>
    endInTransaction(tx, input, activeSession.id, now),
  );
}

async function buildProductionExtractionDispatch(
  prisma: PrismaClient,
  args: {
    workspaceSessionId: string;
    chatSessionId: string;
    userId: string;
    problemId: string;
    memoryOrigin: ReturnType<typeof parseMemoryOrigin>;
    clearedBeforeSequence: number;
    enqueueJob: typeof enqueueActivityExtractionJob;
  },
): Promise<EnqueueActivityExtraction | undefined> {
  if (args.memoryOrigin !== "learner") return undefined;
  const [pendingLearnerMessage, queuedReceipts, root] = await Promise.all([
    prisma.chatMessage.findFirst({
      where: {
        sessionId: args.chatSessionId,
        memoryOrigin: "learner",
        reviewAttemptId: null,
        role: "user",
        sequence: { gt: args.clearedBeforeSequence },
      },
      select: { id: true },
    }),
    prisma.memoryExtractionReceipt.findMany({
      where: {
        status: { in: ["queued", "failed"] },
        extractorVersion: ACTIVITY_EXTRACTION_VERSION,
        activityCluster: {
          chatSessionId: args.chatSessionId,
          clusterKind: "chat_only",
          memoryOrigin: "learner",
        },
      },
      select: { activityClusterId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 3,
    }),
    prisma.agentTraceRun.findFirst({
      where: {
        userId: args.userId,
        problemId: args.problemId,
        memoryOrigin: "learner",
        parentTraceRunId: null,
        OR: [
          { workspaceSessionId: args.workspaceSessionId },
          { chatSessionId: args.chatSessionId },
        ],
      },
      orderBy: [{ turnOrdinal: "desc" }, { startedAt: "desc" }],
      select: { id: true },
    }),
  ]);
  if (!pendingLearnerMessage && queuedReceipts.length === 0) return undefined;
  if (!root) throw new Error("chat_activity_extraction_origin_not_found");

  for (const receipt of queuedReceipts) {
    await args.enqueueJob(prisma, {
      activityClusterId: receipt.activityClusterId,
      extractorVersion: ACTIVITY_EXTRACTION_VERSION,
      originatingTraceRunId: root.id,
    });
  }
  return ({ activityClusterId, extractorVersion }) =>
    args.enqueueJob(prisma, {
      activityClusterId,
      extractorVersion,
      originatingTraceRunId: root.id,
    });
}

async function endInTransaction(
  tx: Prisma.TransactionClient,
  input: z.output<typeof traceSessionEndInputSchema>,
  sessionId: string,
  now: Date,
) {
  const session = await tx.problemWorkspaceSession.findFirst({
    where: {
      id: sessionId,
      userId: input.userId,
      problemId: input.problemId,
      browserInstanceId: input.browserInstanceId,
      foregroundStatus: "active",
    },
  });
  if (!session) {
    return { ok: true as const, ended: false, sessionId: null, foregroundStatus: null };
  }

  const terminalBackground = session.backgroundStatus !== "pending";
  const backgroundStatus = session.backgroundStatus === "idle" ? "settled" : session.backgroundStatus;
  const updated = await tx.problemWorkspaceSession.updateMany({
    where: { id: session.id, userId: input.userId, foregroundStatus: "active" },
    data: {
      activeIdentityKey: null,
      foregroundStatus: "closed",
      foregroundEndedAt: now,
      endReason: input.reason,
      lastActivityAt: now,
      backgroundStatus,
      settledAt: terminalBackground ? now : null,
    },
  });

  return {
    ok: true as const,
    ended: updated.count === 1,
    sessionId: updated.count === 1 ? session.id : null,
    foregroundStatus: updated.count === 1 ? "closed" as const : null,
  };
}
