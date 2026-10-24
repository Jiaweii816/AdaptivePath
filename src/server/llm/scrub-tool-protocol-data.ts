import type { PrismaClient } from "@prisma/client";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  detectToolProtocolLeak,
  sanitizeToolProtocolText,
  type SafeProtocolLeakSummary,
} from "./tool-protocol-leak";

const TRACE_PAYLOAD_FIELDS = [
  "promptJson",
  "inputJson",
  "outputJson",
  "retrievalJson",
  "stateDeltaJson",
  "memoryDeltaJson",
  "detailMetadataJson",
  "stdout",
  "stderr",
] as const;

type TracePayloadField = (typeof TRACE_PAYLOAD_FIELDS)[number];
type TracePayloadValues = Record<TracePayloadField, string | null>;

export type ToolProtocolScrubReport = {
  apply: boolean;
  scannedMessages: number;
  scrubbedMessages: number;
  scannedTracePayloads: number;
  scrubbedTracePayloads: number;
};

export async function scrubToolProtocolData(
  prisma: PrismaClient,
  options: { apply?: boolean } = {},
): Promise<ToolProtocolScrubReport> {
  const apply = options.apply === true;
  const messages = await prisma.chatMessage.findMany({
    where: { role: "assistant" },
    select: {
      id: true,
      sequence: true,
      contentMarkdown: true,
      session: { select: { id: true, userId: true, problemId: true } },
    },
  });
  let scrubbedMessages = 0;

  for (const message of messages) {
    const sanitized = sanitizeToolProtocolText(message.contentMarkdown);
    if (!sanitized.replaced || !sanitized.leak) {
      continue;
    }
    scrubbedMessages += 1;
    if (!apply) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.chatMessage.update({
        where: { id: message.id },
        data: { contentMarkdown: sanitized.text },
      });
      await appendL1TraceEvent(tx, {
        userId: message.session.userId,
        problemId: message.session.problemId,
        chatSessionId: message.session.id,
        eventType: "reply_protocol_scrubbed",
        source: "scrub_tool_protocol_leak",
        content:
          "A persisted assistant protocol leak was scrubbed from ChatMessage.",
        eventJson: {
          chatMessageId: message.id,
          sequence: message.sequence,
          leak: sanitized.leak,
        },
      });
    });
  }

  const payloads = await prisma.agentTracePayload.findMany({
    select: {
      id: true,
      traceEventId: true,
      promptJson: true,
      inputJson: true,
      outputJson: true,
      retrievalJson: true,
      stateDeltaJson: true,
      memoryDeltaJson: true,
      detailMetadataJson: true,
      stdout: true,
      stderr: true,
      traceEvent: {
        select: {
          traceRunId: true,
          redactedFieldsJson: true,
        },
      },
    },
  });
  let scrubbedTracePayloads = 0;

  for (const payload of payloads) {
    const redaction = redactTracePayloadFields(payload);
    if (redaction.redactedFields.length === 0) {
      continue;
    }
    scrubbedTracePayloads += 1;
    if (!apply) {
      continue;
    }

    const existingRedacted = parseStringArray(
      payload.traceEvent.redactedFieldsJson,
    );
    await prisma.$transaction([
      prisma.agentTracePayload.update({
        where: { id: payload.id },
        data: redaction.values,
      }),
      prisma.agentTraceEvent.update({
        where: { id: payload.traceEventId },
        data: {
          payloadState: "pruned",
          redactedFieldsJson: JSON.stringify([
            ...new Set([...existingRedacted, ...redaction.redactedFields]),
          ]),
        },
      }),
      prisma.agentTraceRun.update({
        where: { id: payload.traceEvent.traceRunId },
        data: { status: "degraded", traceCompleteness: "degraded" },
      }),
    ]);
  }

  return {
    apply,
    scannedMessages: messages.length,
    scrubbedMessages,
    scannedTracePayloads: payloads.length,
    scrubbedTracePayloads,
  };
}

export function redactTracePayloadFields(payload: TracePayloadValues): {
  values: Partial<TracePayloadValues>;
  redactedFields: string[];
  leaks: Partial<Record<TracePayloadField, SafeProtocolLeakSummary>>;
} {
  const values: Partial<TracePayloadValues> = {};
  const redactedFields: string[] = [];
  const leaks: Partial<Record<TracePayloadField, SafeProtocolLeakSummary>> = {};

  for (const field of TRACE_PAYLOAD_FIELDS) {
    const content = payload[field];
    const leak = content ? detectToolProtocolLeak(content) : null;
    if (!leak) {
      continue;
    }
    redactedFields.push(`details.${field}`);
    leaks[field] = leak;
    values[field] = field.endsWith("Json")
      ? JSON.stringify({ protocolContentQuarantined: true, leak })
      : "[Tool protocol output quarantined]";
  }

  return { values, redactedFields, leaks };
}

function parseStringArray(value: string | null) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
