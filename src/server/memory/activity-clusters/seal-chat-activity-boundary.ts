import {
  parseMemoryOrigin,
  type MemoryOrigin,
} from "@/server/memory/memory-origin";
import {
  ACTIVITY_EXTRACTION_VERSION,
  type ExtractionReceiptStatus,
} from "./activity-cluster.types";
import type { ActivityClusterDb } from "./activity-source";
import { ensureExtractionReceipt } from "./extraction-receipt-store";
import {
  sealChatOnlyActivityCluster,
  type ChatOnlyBoundaryReason,
} from "./seal-chat-only-activity-cluster";

export type EnqueueActivityExtraction = (input: {
  activityClusterId: string;
  extractionReceiptId: string;
  extractorVersion: string;
}) => Promise<unknown> | unknown;

export type SealChatActivityBoundaryArgs = {
  chatSessionId: string;
  boundaryReason: ChatOnlyBoundaryReason;
  throughSequence?: number;
  expectedOwner?: {
    userId: string;
    problemId: string;
    memoryOrigin: MemoryOrigin;
  };
  enqueueActivityExtraction?: EnqueueActivityExtraction;
};

export type ChatBoundarySegmentResult = {
  startMessageSequence: number;
  endMessageSequence: number;
  messageCount: number;
  activityClusterId: string;
  extractionReceiptId: string;
  receiptStatus: ExtractionReceiptStatus;
  enqueueStatus: "enqueued" | "not_configured" | "not_applicable";
  enqueueError: string | null;
};

export type SkippedChatBoundarySegment = {
  startMessageSequence: number;
  endMessageSequence: number;
  messageCount: number;
  reason: "assistant_only_segment";
};

/**
 * Freezes the unclaimed, non-Review Chat messages visible at one lifecycle
 * boundary. This is intentionally knowledge-taxonomy agnostic: every segment
 * containing learner speech gets an extraction receipt, including segments the
 * extractor may later close as `no_semantic_signal`.
 */
export async function sealChatActivityBoundary(
  prisma: ActivityClusterDb,
  args: SealChatActivityBoundaryArgs,
) {
  const session = await prisma.chatSession.findUnique({
    where: { id: args.chatSessionId },
  });
  if (!session) throw new Error(`chat_session_not_found:${args.chatSessionId}`);
  const memoryOrigin = parseMemoryOrigin(session.memoryOrigin);
  assertExpectedOwner(session, memoryOrigin, args.expectedOwner);

  const throughSequence = normalizeThroughSequence(args.throughSequence);
  const messages = await prisma.chatMessage.findMany({
    where: {
      sessionId: session.id,
      memoryOrigin,
      sequence: {
        gt: session.clearedBeforeSequence,
        ...(throughSequence === undefined ? {} : { lte: throughSequence }),
      },
    },
    orderBy: { sequence: "asc" },
  });
  const boundarySequence =
    messages.at(-1)?.sequence ?? session.clearedBeforeSequence;
  const reviewOwnedMessageCount = messages.filter(
    (message) => message.reviewAttemptId !== null,
  ).length;
  const eligible = messages.filter(
    (message) => message.reviewAttemptId === null,
  );
  const existingItems = eligible.length
    ? await prisma.memoryActivityItem.findMany({
        where: {
          sourceType: "chat_message",
          sourceId: { in: eligible.map((message) => message.id) },
        },
        select: { sourceId: true },
      })
    : [];
  const claimedIds = new Set(existingItems.map((item) => item.sourceId));
  const unclaimed = eligible.filter((message) => !claimedIds.has(message.id));
  const segments = splitConsecutive(unclaimed);
  const sealedSegments: ChatBoundarySegmentResult[] = [];
  const skippedSegments: SkippedChatBoundarySegment[] = [];
  // A failed receipt has already claimed its messages, so a later boundary
  // would otherwise never see it again. Re-offer a small same-session batch
  // whenever this lifecycle boundary has a dispatcher available. The receipt
  // claim itself remains the concurrency/idempotency authority.
  const requeuedFailedExtractionCount = await reenqueueFailedReceiptsForSession(
    prisma,
    {
      chatSessionId: session.id,
      memoryOrigin,
      enqueue: args.enqueueActivityExtraction,
    },
  );

  for (const segment of segments) {
    const start = segment[0]!.sequence;
    const end = segment.at(-1)!.sequence;
    if (!segment.some((message) => message.role === "user")) {
      skippedSegments.push({
        startMessageSequence: start,
        endMessageSequence: end,
        messageCount: segment.length,
        reason: "assistant_only_segment",
      });
      continue;
    }
    const learnerEvidence =
      memoryOrigin === "learner"
        ? await loadExactUserMessageL1Evidence(prisma, {
            sessionId: session.id,
            segment,
          })
        : [];
    const cluster = await sealChatOnlyActivityCluster(prisma, {
      chatSessionId: session.id,
      startMessageSequence: start,
      endMessageSequence: end,
      boundaryReason: args.boundaryReason,
      additionalSourceItems: learnerEvidence.map((sourceId) => ({
        sourceType: "l1_event" as const,
        sourceId,
        evidenceRole: "learner_action" as const,
      })),
    });
    const receipt = await ensureExtractionReceipt(prisma, {
      activityClusterId: cluster.cluster.id,
      extractorVersion: ACTIVITY_EXTRACTION_VERSION,
    });
    const dispatch = await dispatchQueuedReceipt(
      args.enqueueActivityExtraction,
      cluster.cluster.id,
      receipt,
    );
    sealedSegments.push({
      startMessageSequence: start,
      endMessageSequence: end,
      messageCount: segment.length,
      activityClusterId: cluster.cluster.id,
      extractionReceiptId: receipt.id,
      receiptStatus: receipt.status as ExtractionReceiptStatus,
      ...dispatch,
    });
  }

  return {
    chatSessionId: session.id,
    boundaryReason: args.boundaryReason,
    previousClearedBeforeSequence: session.clearedBeforeSequence,
    boundarySequence,
    scannedMessageCount: messages.length,
    consideredMessageCount: unclaimed.length,
    reviewOwnedMessageCount,
    alreadyClaimedMessageCount: eligible.length - unclaimed.length,
    requeuedFailedExtractionCount,
    sealedSegments,
    skippedSegments,
  };
}

async function reenqueueFailedReceiptsForSession(
  prisma: ActivityClusterDb,
  args: {
    chatSessionId: string;
    memoryOrigin: MemoryOrigin;
    enqueue: EnqueueActivityExtraction | undefined;
  },
) {
  if (!args.enqueue || args.memoryOrigin !== "learner") return 0;
  const failed = await prisma.memoryExtractionReceipt.findMany({
    where: {
      extractorVersion: ACTIVITY_EXTRACTION_VERSION,
      status: "failed",
      activityCluster: {
        chatSessionId: args.chatSessionId,
        memoryOrigin: args.memoryOrigin,
      },
    },
    orderBy: { updatedAt: "asc" },
    take: 3,
    select: { id: true, activityClusterId: true, extractorVersion: true },
  });
  let requeued = 0;
  for (const receipt of failed) {
    try {
      await args.enqueue({
        activityClusterId: receipt.activityClusterId,
        extractionReceiptId: receipt.id,
        extractorVersion: receipt.extractorVersion,
      });
      requeued += 1;
    } catch (error) {
      // Recovery is best-effort and must not make clearing or sealing a Chat
      // boundary fail. The durable failed receipt remains available for the
      // next boundary or explicit recovery attempt.
      console.error("Unable to re-enqueue failed Chat activity extraction.", {
        error,
        activityClusterId: receipt.activityClusterId,
      });
    }
  }
  return requeued;
}

async function loadExactUserMessageL1Evidence(
  prisma: ActivityClusterDb,
  args: {
    sessionId: string;
    segment: Array<{ id: string; role: string; sequence: number }>;
  },
) {
  const userMessages = new Map(
    args.segment
      .filter((message) => message.role === "user")
      .map((message) => [message.id, message.sequence]),
  );
  if (userMessages.size === 0) return [];
  const traces = await prisma.l1MemoryEvent.findMany({
    where: {
      chatSessionId: args.sessionId,
      memoryOrigin: "learner",
      eventType: "chat_user_message",
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  const evidenceByMessage = new Map<string, string>();
  for (const trace of traces) {
    const event = parseEventJson(trace.eventJson);
    const chatMessageId =
      typeof event.chatMessageId === "string" ? event.chatMessageId : null;
    const sequence = typeof event.sequence === "number" ? event.sequence : null;
    if (
      chatMessageId &&
      userMessages.get(chatMessageId) === sequence &&
      !evidenceByMessage.has(chatMessageId)
    ) {
      evidenceByMessage.set(chatMessageId, trace.id);
    }
  }
  return [...userMessages.keys()].flatMap((messageId) => {
    const sourceId = evidenceByMessage.get(messageId);
    return sourceId ? [sourceId] : [];
  });
}

function parseEventJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function splitConsecutive<T extends { sequence: number }>(rows: T[]) {
  const segments: T[][] = [];
  for (const row of rows) {
    const current = segments.at(-1);
    if (!current || current.at(-1)!.sequence + 1 !== row.sequence) {
      segments.push([row]);
    } else {
      current.push(row);
    }
  }
  return segments;
}

async function dispatchQueuedReceipt(
  enqueue: EnqueueActivityExtraction | undefined,
  activityClusterId: string,
  receipt: { id: string; status: string },
) {
  if (receipt.status !== "queued") {
    return {
      enqueueStatus: "not_applicable" as const,
      enqueueError: null,
    };
  }
  if (!enqueue) {
    return {
      enqueueStatus: "not_configured" as const,
      enqueueError: null,
    };
  }
  await enqueue({
    activityClusterId,
    extractionReceiptId: receipt.id,
    extractorVersion: ACTIVITY_EXTRACTION_VERSION,
  });
  return { enqueueStatus: "enqueued" as const, enqueueError: null };
}

function normalizeThroughSequence(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("chat_activity_boundary_sequence_invalid");
  }
  return value;
}

function assertExpectedOwner(
  session: { userId: string; problemId: string },
  memoryOrigin: MemoryOrigin,
  expected: SealChatActivityBoundaryArgs["expectedOwner"],
) {
  if (!expected) return;
  if (
    session.userId !== expected.userId ||
    session.problemId !== expected.problemId ||
    memoryOrigin !== expected.memoryOrigin
  ) {
    throw new Error("chat_activity_boundary_owner_mismatch");
  }
}
