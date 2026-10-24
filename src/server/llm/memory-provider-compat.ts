import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export type MemoryChatCompletionParams =
  ChatCompletionCreateParamsNonStreaming & {
    enable_thinking?: boolean;
  };

export function withMemoryNonStreamingCompatibility(
  params: ChatCompletionCreateParamsNonStreaming,
): MemoryChatCompletionParams {
  return {
    ...params,
    enable_thinking: false,
  };
}
