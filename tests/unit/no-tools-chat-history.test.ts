import { describe, expect, it } from "vitest";
import { projectNoToolsChatHistory } from "@/server/llm/no-tools-chat-history";
import type { CoachChatLoopMessage } from "@/server/agents/coach-agent/coach-agent.types";

describe("no-tools chat history projection", () => {
  it("projects structured tool history into bounded assistant observations", () => {
    const messages: CoachChatLoopMessage[] = [
      { role: "user", content: "Save both notes." },
      {
        role: "assistant",
        content: "I will save them.",
        toolCalls: [
          {
            id: "call-1",
            name: "save_knowledge_note",
            arguments: { snippet: "sensitive model-generated draft" },
          },
          {
            id: "call-2",
            name: "save_mistake_book_entry",
            arguments: {},
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "save_knowledge_note",
        content: JSON.stringify({ saved: true, title: "Toward zero" }),
      },
      {
        role: "tool",
        toolCallId: "call-2",
        name: "save_mistake_book_entry",
        content: JSON.stringify({
          reason: "invalid_tool_arguments",
          expectedFields: ["title", "guideMarkdown"],
        }),
      },
      { role: "user", content: "Please summarize the outcome." },
    ];

    const projection = projectNoToolsChatHistory(messages);
    const serialized = JSON.stringify(projection.messages);

    expect(projection.truncated).toBe(false);
    expect(projection.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "user",
    ]);
    expect(serialized).not.toContain("toolCalls");
    expect(serialized).not.toContain("sensitive model-generated draft");
    expect(serialized).toContain("[Tool execution observations]");
    expect(serialized).toContain("save_knowledge_note");
    expect(serialized).toContain('\\\"saved\\\":true');
    expect(serialized).toContain("invalid_tool_arguments");
    expect(serialized).toContain("Please summarize the outcome.");
  });

  it("removes protocol-like tool content instead of replaying it", () => {
    const projection = projectNoToolsChatHistory([
      {
        role: "assistant",
        toolCalls: [{ id: "call-1", name: "demo", arguments: {} }],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "demo",
        content: "<｜｜DSML｜｜tool_calls>secret",
      },
    ]);
    const serialized = JSON.stringify(projection.messages);

    expect(serialized).not.toContain("DSML");
    expect(serialized).not.toContain("secret");
    expect(serialized).toContain("Tool protocol observation removed");
  });

  it("reports deterministic truncation metadata and respects the total bound", () => {
    const projection = projectNoToolsChatHistory(
      [
        { role: "assistant", content: "old ".repeat(80) },
        { role: "user", content: "latest request" },
      ],
      { maxTotalChars: 120, maxMessageChars: 80 },
    );

    expect(projection.truncated).toBe(true);
    expect(projection.omittedChars).toBeGreaterThan(0);
    expect(projection.messages.at(-1)).toEqual({
      role: "user",
      content: "latest request",
    });
    expect(
      projection.messages.reduce(
        (sum, message) => sum + message.content.length,
        0,
      ),
    ).toBeLessThanOrEqual(120);
  });
});
