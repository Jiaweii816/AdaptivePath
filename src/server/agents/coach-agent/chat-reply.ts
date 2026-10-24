import type {
  ChatReplyDeps,
  ChatReplyResult,
} from "./chat-reply-contracts";
import { executeChatReply } from "./chat-turn-orchestrator";

export {
  chatRequestSchema,
  type ChatReplyDeps,
  type ChatReplyResult,
  type ChatRequest,
  type ChatToolStopReason,
} from "./chat-reply-contracts";
export { collectPlannedStrategyTags } from "./chat-consolidation";

export async function chatReply(
  rawInput: unknown,
  deps: ChatReplyDeps = {},
): Promise<ChatReplyResult> {
  return executeChatReply(rawInput, deps);
}
