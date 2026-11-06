import type Anthropic from "@anthropic-ai/sdk";

/** One scripted model response: final JSON text, tool calls, or a thrown provider error. */
export type FakeStep = Readonly<{ text?: string; calls?: ReadonlyArray<{ name: string; input: unknown }>; stopReason?: Anthropic.StopReason }> | Error;
export type FakeBody = Readonly<{ system?: string; messages: Anthropic.MessageParam[]; tools?: unknown[]; output_config?: Anthropic.OutputConfig; [key: string]: unknown }>;

let toolUseSeq = 0;

function toMessage(step: Exclude<FakeStep, Error>): Anthropic.Message {
  const textBlocks = step.text === undefined ? [] : [{ type: "text", text: step.text, citations: null }];
  const toolBlocks = (step.calls ?? []).map((c) => ({ type: "tool_use", id: `toolu_fake${toolUseSeq++}`, name: c.name, input: c.input, caller: undefined }));
  const stopReason = step.stopReason ?? (toolBlocks.length ? "tool_use" : "end_turn");
  return {
    id: "msg_fake", type: "message", role: "assistant", model: "fake", content: [...textBlocks, ...toolBlocks],
    stop_reason: stopReason, stop_sequence: null, stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/** A client whose messages.create records each request body and answers from `next`. */
export function fakeAnthropic(next: (body: FakeBody) => FakeStep, record: (body: FakeBody) => void = () => {}): Anthropic {
  const create = async (body: FakeBody) => {
    record(JSON.parse(JSON.stringify(body)));
    const step = next(body);
    if (step instanceof Error) throw step;
    return toMessage(step);
  };
  return { messages: { create } } as unknown as Anthropic;
}

/** All tool_result blocks across the request's user turns. */
export function toolResults(body: FakeBody): Anthropic.ToolResultBlockParam[] {
  return body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result");
}
