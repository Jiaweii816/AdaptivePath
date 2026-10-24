import {
  resolvePendingConfirmation,
  type PendingConfirmationResolution,
  type PendingRequestedAction,
} from "@/server/tools/chat-tools/requested-actions";
import type { DurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";

type StoredMessage = Readonly<{ role: "user" | "assistant"; metadataJson: string }>;

export type ModelPersistConfirmation = Readonly<{
  pending: readonly PendingRequestedAction[];
  resolution: PendingConfirmationResolution;
}>;

export function pendingModelPersists(tools: readonly DurableWriteToolName[]) {
  return tools.map((toolName, order) => ({ toolName, order, evidence: [] }));
}

export function resolveModelPersistConfirmation(
  message: string,
  storedMessages: readonly StoredMessage[],
): ModelPersistConfirmation {
  const pending = latestPending(storedMessages);
  return { pending, resolution: resolvePendingConfirmation({ message, pending }) };
}

export function appendModelPersistConfirmation(
  reply: string,
  tools: readonly DurableWriteToolName[],
  responseLanguage: "zh" | "en",
) {
  if (tools.length === 0) return reply;
  const request = responseLanguage === "zh"
    ? "我检测到一项可保存内容；这轮不会写入。回复“确认”只会记录你的意图；实际保存时请明确重述要保存的原文，或回复“取消”。"
    : "I detected content that could be saved; nothing is written this turn. “Confirm” only records your intent; repeat the exact content explicitly to save it, or reply “cancel”.";
  return `${reply}\n\n${request}`;
}

export function appendModelPersistResolution(
  reply: string,
  resolution: PendingConfirmationResolution,
  responseLanguage: "zh" | "en",
) {
  if (resolution.disposition !== "confirmed" && resolution.disposition !== "rejected") {
    return reply;
  }
  const message = responseLanguage === "zh"
    ? resolution.disposition === "confirmed"
      ? "已收到确认；本轮不会自动写入。如需保存，请明确重述要保存的原文。"
      : "已取消待确认的保存请求。"
    : resolution.disposition === "confirmed"
      ? "Confirmation received; nothing is written automatically this turn. Repeat the exact content explicitly to save it."
      : "The pending save request was cancelled.";
  return `${reply}\n\n${message}`;
}

function latestPending(messages: readonly StoredMessage[]): PendingRequestedAction[] {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const tools = readPendingTools(message.metadataJson);
    if (tools) return pendingModelPersists(tools);
  }
  return [];
}

function readPendingTools(metadataJson: string): DurableWriteToolName[] | undefined {
  try {
    const metadata = JSON.parse(metadataJson) as { pendingModelPersists?: unknown };
    if (!Array.isArray(metadata.pendingModelPersists)) return undefined;
    return metadata.pendingModelPersists.filter(isDurableTool);
  } catch {
    return undefined;
  }
}

function isDurableTool(value: unknown): value is DurableWriteToolName {
  return value === "note_memory" || value === "save_knowledge_note" ||
    value === "save_mistake_book_entry";
}
