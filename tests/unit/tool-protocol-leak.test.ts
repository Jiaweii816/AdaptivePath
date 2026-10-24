import { describe, expect, it } from "vitest";
import {
  detectToolProtocolLeak,
  sanitizeToolProtocolText,
} from "@/server/llm/tool-protocol-leak";

describe("tool protocol leak boundary", () => {
  it.each([
    [
      "full-width DSML",
      '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="save_knowledge_note">',
      "dsml_tool_calls",
    ],
    [
      "spaced ASCII pipes",
      '< | | DSML | | parameter name="title">unsafe',
      "dsml_parameter",
    ],
    [
      "alternate vertical-line glyphs",
      "<∣∣DSML∣∣invoke name=save_knowledge_note>",
      "dsml_invoke",
    ],
    ["provider tool separator", "<|tool_sep|>", "provider_tool_sep"],
    ["provider tool-call end", "<|tool_calls_end|>", "provider_tool_calls_end"],
    [
      "line-start XML tool calls block",
      '  <tool_calls>\n{"name":"save"}\n</tool_calls>',
      "xml_tool_calls_block",
    ],
    [
      "provider function-call wrapper",
      "<|function_call|>",
      "provider_function_call",
    ],
  ])("detects %s", (_label, content, sentinelId) => {
    const leak = detectToolProtocolLeak(content, { finishReason: "stop" });

    expect(leak).toMatchObject({
      contentLength: content.length,
      finishReason: "stop",
    });
    expect(leak?.sentinelIds).toContain(sentinelId);
    expect(leak?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(leak)).not.toContain("save_knowledge_note");
  });

  it("collects stable unique sentinel ids without copying raw content", () => {
    const content = [
      "<||DSML||tool_calls>",
      '<||DSML||invoke name="save_knowledge_note">',
      '<||DSML||parameter name="title">x</||DSML||parameter>',
      "</||DSML||invoke>",
    ].join("\n");

    const leak = detectToolProtocolLeak(content);

    expect(leak?.sentinelIds).toEqual([
      "dsml_tool_calls",
      "dsml_invoke",
      "dsml_parameter",
    ]);
    expect(JSON.stringify(leak)).not.toContain("title");
  });

  it.each([
    "Use function_call in an OpenAI-compatible API.",
    "The tool_calls field is an array.",
    "`<||DSML||tool_calls>` is a protocol example.",
    "``<|tool_sep|> and ` inside double-backtick code``",
    "````<|function_call|> inside four-backtick code````",
    "```text\n<｜｜DSML｜｜invoke name=demo>\n```",
    "Before `inline code` and after ordinary prose.",
  ])("does not flag ordinary or code-quoted teaching text", (content) => {
    expect(detectToolProtocolLeak(content)).toBeNull();
  });

  it("sanitizes a leaking assistant message with a deterministic safe placeholder", () => {
    const content = "answer <||DSML||tool_calls> secret";
    const sanitized = sanitizeToolProtocolText(content);

    expect(sanitized.replaced).toBe(true);
    expect(sanitized.text).toBe(
      "[Tool protocol output removed by safety guard]",
    );
    expect(sanitized.text).not.toContain("DSML");
    expect(sanitized.leak?.contentLength).toBe(content.length);
  });
});
