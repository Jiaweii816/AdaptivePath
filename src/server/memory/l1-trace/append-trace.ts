import type { PrismaClient } from "@prisma/client";
import {
  l1MemoryEventTypeSchema,
  type L1MemoryEventType,
} from "@/types/memory";
import {
  resolveMemoryOrigin,
  type MemoryOrigin,
} from "@/server/memory/memory-origin";

type L1TracePrisma = Pick<PrismaClient, "l1MemoryEvent">;

export type AppendL1TraceEventInput = {
  userId: string;
  problemId?: string;
  chatSessionId?: string;
  reviewAttemptId?: string;
  eventType: L1MemoryEventType;
  eventJson?: unknown;
  content?: string;
  source?: string;
  occurredAt?: Date;
  memoryOrigin?: MemoryOrigin;
  traceRunId?: string;
};

export async function appendL1TraceEvent(
  prisma: L1TracePrisma,
  input: AppendL1TraceEventInput,
) {
  if (TELEMETRY_ONLY_EVENT_TYPES.has(input.eventType)) {
    throw new Error(
      `Telemetry event ${input.eventType} must be written to AgentTraceEvent, not L1MemoryEvent.`,
    );
  }
  const eventType = l1MemoryEventTypeSchema.parse(input.eventType);
  const eventJson = input.eventJson ?? {};
  const traceRunId = input.traceRunId ?? readTraceRunId(eventJson);
  const processOrigin = resolveMemoryOrigin();
  if (
    input.memoryOrigin &&
    input.memoryOrigin !== processOrigin &&
    process.env.NODE_ENV !== "test"
  ) {
    throw new Error(
      `L1 memory origin must match the current process origin (${processOrigin}); got ${input.memoryOrigin}.`,
    );
  }

  return prisma.l1MemoryEvent.create({
    data: {
      userId: input.userId,
      problemId: input.problemId,
      chatSessionId: input.chatSessionId,
      reviewAttemptId: input.reviewAttemptId,
      eventType,
      eventJson: JSON.stringify(eventJson),
      content: input.content,
      source: input.source,
      memoryOrigin: input.memoryOrigin ?? processOrigin,
      traceRunId,
      occurredAt: input.occurredAt,
    },
  });
}

function readTraceRunId(eventJson: unknown) {
  if (!eventJson || typeof eventJson !== "object" || Array.isArray(eventJson)) {
    return undefined;
  }
  const value = (eventJson as Record<string, unknown>).traceRunId;
  return typeof value === "string" && value.trim() ? value : undefined;
}

const TELEMETRY_ONLY_EVENT_TYPES = new Set([
  "llm_call",
  "tool_call",
  "tool_result",
  "retrieval_trace",
  "reply_safety_replaced",
]);

export async function appendL1TraceEvents(
  prisma: L1TracePrisma,
  inputs: AppendL1TraceEventInput[],
) {
  const baseOccurredAt = new Date();
  const events = [];

  // Keep the MVP path serial so callers get stable event ids in trace order.
  for (const [index, input] of inputs.entries()) {
    events.push(
      await appendL1TraceEvent(prisma, {
        ...input,
        occurredAt:
          input.occurredAt ??
          new Date(baseOccurredAt.getTime() + index),
      }),
    );
  }

  return events;
}
