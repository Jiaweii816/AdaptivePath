import { sanitizeToolProtocolText } from "@/server/llm/tool-protocol-leak";

export type ToolHistoryMessage =
  | { role: "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content?: string;
      toolCalls: ReadonlyArray<{
        id: string;
        name: string;
        arguments: unknown;
      }>;
    }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
    };

export type NoToolsChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type NoToolsHistoryProjection = {
  messages: NoToolsChatMessage[];
  truncated: boolean;
  omittedChars: number;
};

const DEFAULT_MAX_TOTAL_CHARS = 32_000;
const DEFAULT_MAX_MESSAGE_CHARS = 6_000;

export function projectNoToolsChatHistory(
  messages: readonly ToolHistoryMessage[],
  options: {
    maxTotalChars?: number;
    maxMessageChars?: number;
  } = {},
): NoToolsHistoryProjection {
  const maxTotalChars = normalizeBound(
    options.maxTotalChars,
    DEFAULT_MAX_TOTAL_CHARS,
  );
  const maxMessageChars = normalizeBound(
    options.maxMessageChars,
    DEFAULT_MAX_MESSAGE_CHARS,
  );
  const projected: NoToolsChatMessage[] = [];
  let omittedChars = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;

    if (message.role === "tool") {
      const observation = buildObservationBlock(
        [
          {
            toolName: message.name,
            content: message.content,
          },
        ],
        maxMessageChars,
      );
      omittedChars += observation.omittedChars;
      projected.push({ role: "assistant", content: observation.text });
      continue;
    }

    if (message.role === "assistant" && "toolCalls" in message) {
      if (message.content?.trim()) {
        const sanitized = sanitizeToolProtocolText(message.content);
        const bounded = truncateWithMetadata(sanitized.text, maxMessageChars);
        omittedChars += bounded.omittedChars;
        projected.push({ role: "assistant", content: bounded.text });
      }

      const expectedCallIds = new Set(
        message.toolCalls.map((toolCall) => toolCall.id),
      );
      const observations: Array<{ toolName: string; content: string }> = [];

      while (
        index + 1 < messages.length &&
        messages[index + 1]?.role === "tool" &&
        expectedCallIds.has(
          (messages[index + 1] as Extract<ToolHistoryMessage, { role: "tool" }>)
            .toolCallId,
        )
      ) {
        const toolMessage = messages[index + 1] as Extract<
          ToolHistoryMessage,
          { role: "tool" }
        >;
        observations.push({
          toolName: toolMessage.name,
          content: toolMessage.content,
        });
        expectedCallIds.delete(toolMessage.toolCallId);
        index += 1;
      }

      for (const missingCallId of expectedCallIds) {
        const toolCall = message.toolCalls.find(
          (candidate) => candidate.id === missingCallId,
        );
        observations.push({
          toolName: toolCall?.name ?? "unknown_tool",
          content: JSON.stringify({
            disposition: "unavailable",
            reason: "tool_result_missing",
          }),
        });
      }

      if (observations.length > 0) {
        const observation = buildObservationBlock(
          observations,
          maxMessageChars,
        );
        omittedChars += observation.omittedChars;
        projected.push({ role: "assistant", content: observation.text });
      }
      continue;
    }

    const content =
      message.role === "assistant"
        ? sanitizeToolProtocolText(message.content).text
        : message.content;
    const bounded = truncateWithMetadata(content, maxMessageChars);
    omittedChars += bounded.omittedChars;
    projected.push({ role: message.role, content: bounded.text });
  }

  const totalBounded = retainNewestWithinTotalBound(projected, maxTotalChars);

  return {
    messages: totalBounded.messages,
    truncated: omittedChars + totalBounded.omittedChars > 0,
    omittedChars: omittedChars + totalBounded.omittedChars,
  };
}

function buildObservationBlock(
  observations: ReadonlyArray<{ toolName: string; content: string }>,
  maxChars: number,
) {
  const lines = ["[Tool execution observations]"];

  for (const observation of observations) {
    const sanitized = sanitizeToolProtocolText(observation.content, {
      replacement: "[Tool protocol observation removed by safety guard]",
    });
    lines.push(`- tool: ${observation.toolName}`);
    lines.push(`  disposition: ${inferDisposition(sanitized.text)}`);
    lines.push(`  result: ${sanitized.text}`);
  }

  return truncateWithMetadata(lines.join("\n"), maxChars);
}

function inferDisposition(content: string) {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    if (typeof value.disposition === "string") {
      return value.disposition;
    }
    if (typeof value.reason === "string") {
      return "denied_or_failed";
    }
    return "executed";
  } catch {
    return "observed";
  }
}

function retainNewestWithinTotalBound(
  messages: readonly NoToolsChatMessage[],
  maxTotalChars: number,
) {
  const retained: NoToolsChatMessage[] = [];
  let remaining = maxTotalChars;
  let omittedChars = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (remaining <= 0) {
      omittedChars += message.content.length;
      continue;
    }
    if (message.content.length <= remaining) {
      retained.push(message);
      remaining -= message.content.length;
      continue;
    }

    const bounded = truncateWithMetadata(message.content, remaining);
    omittedChars += bounded.omittedChars;
    if (bounded.text) {
      retained.push({ ...message, content: bounded.text });
      remaining -= bounded.text.length;
    }
  }

  return { messages: retained.reverse(), omittedChars };
}

function truncateWithMetadata(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return { text: content, omittedChars: 0 };
  }

  const omittedChars = content.length - maxChars;
  const marker = `\n[truncated: omittedChars=${omittedChars}]`;

  if (marker.length >= maxChars) {
    return {
      text: marker.slice(0, maxChars),
      omittedChars,
    };
  }

  return {
    text: `${content.slice(0, maxChars - marker.length)}${marker}`,
    omittedChars,
  };
}

function normalizeBound(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
