import type { ChatToolName } from "./chat-tool-contracts";

/**
 * Canonical durable-write tool list. Authorization, planning, result semantics,
 * and orchestration must share this definition instead of maintaining parallel
 * unions.
 */
export const DURABLE_WRITE_TOOL_NAMES = [
  "note_memory",
  "save_knowledge_note",
  "save_mistake_book_entry",
] as const satisfies readonly ChatToolName[];

export type DurableWriteToolName = (typeof DURABLE_WRITE_TOOL_NAMES)[number];

const durableWriteToolNames = new Set<string>(DURABLE_WRITE_TOOL_NAMES);

export function isDurableWriteToolName(
  name: string,
): name is DurableWriteToolName {
  return durableWriteToolNames.has(name);
}
