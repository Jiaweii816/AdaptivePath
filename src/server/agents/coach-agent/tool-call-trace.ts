import type { CoachToolCall } from "./coach-agent.types";

export type CapturedToolCall = {
  id: string;
  name: string;
  arguments: unknown;
  argumentsParseError?: true;
};

/**
 * The provider returns tool-call arguments as a JSON *string*. Parsing it at
 * capture time is what makes the function call readable in the runtime log
 * without the reader having to dig through rawResponse.
 *
 * Shared by both trace paths that can emit a Chat LLM call event:
 * - chat-reply.ts's orchestration-owned path (`callChatProviderOnce`), used
 *   when a provider does not declare `runtimeTraceOwnership: "provider"`.
 * - qwen-coach-provider.ts's provider-owned path (`requestChatCompletion`),
 *   used by the real deepseek-backed provider, which appends its own LLM
 *   trace events and is never routed through `callChatProviderOnce`.
 */
export function captureToolCalls(
  toolCalls: readonly CoachToolCall[],
): CapturedToolCall[] {
  return toolCalls.map((toolCall) => {
    if (typeof toolCall.arguments !== "string") {
      return { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments };
    }
    try {
      return {
        id: toolCall.id,
        name: toolCall.name,
        arguments: JSON.parse(toolCall.arguments),
      };
    } catch {
      return {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        argumentsParseError: true,
      };
    }
  });
}
