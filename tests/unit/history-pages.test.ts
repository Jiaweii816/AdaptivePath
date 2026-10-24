import { describe, expect, it } from "vitest";
import {
  buildChatReplay,
  filterChatHistoryAfterClear,
} from "@/features/chat-history/chat-history-data";
import {
  filterAttemptsByStatus,
  groupProblemHistoryAttempts,
  splitAttemptsByAge,
  type ProblemHistoryAttempt,
} from "@/features/problem-history/problem-history-data";

describe("problem history page helpers", () => {
  it("groups attempts by problem with the latest attempt first", () => {
    const first = createAttempt({
      id: "attempt-latest",
      createdAt: new Date("2026-06-10T10:00:00Z"),
    });
    const second = createAttempt({
      id: "attempt-older",
      createdAt: new Date("2026-06-09T10:00:00Z"),
    });

    const groups = groupProblemHistoryAttempts([first, second]);

    expect(groups).toHaveLength(1);
    expect(groups[0].latest.id).toBe("attempt-latest");
    expect(groups[0].attempts.map((attempt) => attempt.id)).toEqual([
      "attempt-latest",
      "attempt-older",
    ]);
  });

  it("derives first-pass attempt counts from facts only", () => {
    const groups = groupProblemHistoryAttempts([
      createAttempt({
        id: "failed",
        runStatus: "failed",
        createdAt: new Date("2026-06-09T10:00:00Z"),
      }),
      createAttempt({
        id: "passed",
        runStatus: "passed_visible_tests",
        createdAt: new Date("2026-06-10T10:00:00Z"),
      }),
    ]);

    expect(groups[0].firstAcAttemptCount).toBe(2);
  });

  it("splits old attempts into the secondary history bucket", () => {
    const split = splitAttemptsByAge(
      [
        createAttempt({ id: "recent", createdAt: new Date("2026-06-01T10:00:00Z") }),
        createAttempt({ id: "old", createdAt: new Date("2026-01-01T10:00:00Z") }),
      ],
      new Date("2026-06-29T10:00:00Z"),
    );

    expect(split.recent.map((item) => item.id)).toEqual(["recent"]);
    expect(split.older.map((item) => item.id)).toEqual(["old"]);
  });

  it("keeps infrastructure and user-input statuses neutral in history stats", () => {
    const attempts = [
      createAttempt({ id: "passed", runStatus: "passed_visible_tests" }),
      createAttempt({ id: "failed", runStatus: "failed" }),
      createAttempt({ id: "runner", runStatus: "runner_error" }),
      createAttempt({ id: "empty", runStatus: "empty_code" }),
      createAttempt({ id: "tests", runStatus: "no_tests" }),
      createAttempt({ id: "lang", runStatus: "unsupported_language" }),
    ];

    expect(filterAttemptsByStatus(attempts, "failed").map((item) => item.id)).toEqual([
      "failed",
    ]);
  });
});

describe("chat history page helpers", () => {
  it("inserts paired tool steps between the user message and the final reply", () => {
    const userTime = new Date("2026-06-10T10:00:00Z");
    const toolTime = new Date("2026-06-10T10:00:01Z");
    const assistantTime = new Date("2026-06-10T10:00:02Z");

    const replay = buildChatReplay({
      messages: [
        {
          id: "message-user",
          role: "user",
          contentMarkdown: "Try `s='abba'`.",
          metadataJson: "{}",
          sequence: 1,
          createdAt: userTime,
        },
        {
          id: "message-assistant",
          role: "assistant",
          contentMarkdown: "The tool result shows it passes.",
          metadataJson: JSON.stringify({ type: "chat_reply" }),
          sequence: 2,
          createdAt: assistantTime,
        },
      ],
      toolEvents: [
        {
          id: "tool-call",
          eventType: "tool_call",
          occurredAt: toolTime,
          createdAt: toolTime,
          eventJson: JSON.stringify({
            toolCallId: "call-1",
            toolName: "run_code",
            arguments: {
              language: "Python",
              tests: [{ label: "abba" }],
            },
          }),
        },
        {
          id: "tool-result",
          eventType: "tool_result",
          occurredAt: toolTime,
          createdAt: toolTime,
          eventJson: JSON.stringify({
            toolCallId: "call-1",
            toolName: "run_code",
            result: {
              result: {
                status: "passed_visible_tests",
                passedCount: 1,
                failedCount: 0,
              },
            },
          }),
        },
      ],
    });

    expect(replay.map((item) => item.kind)).toEqual([
      "message",
      "tool",
      "message",
    ]);
    expect(replay[1]).toMatchObject({
      kind: "tool",
      displayName: "Run Code",
      argumentSummary: "Python; tests: abba",
      resultSummary: "passed_visible_tests: 1 passed, 0 failed.",
    });
  });

  it("uses English labels for durable-write tool replay", () => {
    const userTime = new Date("2026-06-10T10:00:00Z");
    const toolTime = new Date("2026-06-10T10:00:01Z");
    const assistantTime = new Date("2026-06-10T10:00:02Z");
    const replay = buildChatReplay({
      messages: [
        {
          id: "message-user",
          role: "user",
          contentMarkdown: "Save this heapq note.",
          metadataJson: "{}",
          sequence: 1,
          createdAt: userTime,
        },
        {
          id: "message-assistant",
          role: "assistant",
          contentMarkdown: "Saved.",
          metadataJson: JSON.stringify({ type: "chat_reply" }),
          sequence: 2,
          createdAt: assistantTime,
        },
      ],
      toolEvents: [
        {
          id: "tool-call",
          eventType: "tool_call",
          occurredAt: toolTime,
          createdAt: toolTime,
          eventJson: JSON.stringify({
            toolCallId: "call-knowledge",
            toolName: "save_knowledge_note",
            arguments: { title: "Python heapq" },
          }),
        },
        {
          id: "tool-result",
          eventType: "tool_result",
          occurredAt: toolTime,
          createdAt: toolTime,
          eventJson: JSON.stringify({
            toolCallId: "call-knowledge",
            toolName: "save_knowledge_note",
            result: {
              saved: true,
              title: "Python heapq",
              lookupCount: 2,
            },
          }),
        },
      ],
    });

    expect(replay[1]).toMatchObject({
      kind: "tool",
      displayName: "Knowledge Handbook",
      resultSummary: "Python heapq saved to Knowledge Handbook, lookup #2.",
    });
  });

  it("renders atomic history recall with human-readable problem and mistake labels", () => {
    const userTime = new Date("2026-06-10T10:00:00Z");
    const problemRecallTime = new Date("2026-06-10T10:00:01Z");
    const mistakeRecallTime = new Date("2026-06-10T10:00:02Z");
    const assistantTime = new Date("2026-06-10T10:00:03Z");
    const replay = buildChatReplay({
      messages: [
        {
          id: "message-user",
          role: "user",
          contentMarkdown:
            "What similar problems have I solved, and what mistakes have I repeated?",
          metadataJson: "{}",
          sequence: 1,
          createdAt: userTime,
        },
        {
          id: "message-assistant",
          role: "assistant",
          contentMarkdown: "Here are the two separate history results.",
          metadataJson: JSON.stringify({ type: "chat_reply" }),
          sequence: 2,
          createdAt: assistantTime,
        },
      ],
      toolEvents: [
        createToolEvent("problem-call", {
          occurredAt: problemRecallTime,
          eventJson: JSON.stringify({
            toolCallId: "call-problem-history",
            toolName: "past_problem_recall",
            arguments: { query: "similar sliding-window problems" },
          }),
        }),
        createToolEvent("problem-result", {
          eventType: "tool_result",
          occurredAt: problemRecallTime,
          eventJson: JSON.stringify({
            toolCallId: "call-problem-history",
            toolName: "past_problem_recall",
            result: { items: [{ title: "Minimum Window Substring" }] },
          }),
        }),
        createToolEvent("mistake-call", {
          occurredAt: mistakeRecallTime,
          eventJson: JSON.stringify({
            toolCallId: "call-mistake-history",
            toolName: "past_mistake_recall",
            arguments: { query: "repeated DP transition mistakes" },
          }),
        }),
        createToolEvent("mistake-result", {
          eventType: "tool_result",
          occurredAt: mistakeRecallTime,
          eventJson: JSON.stringify({
            toolCallId: "call-mistake-history",
            toolName: "past_mistake_recall",
            result: {
              items: [{ title: "DP transition missed a predecessor" }],
            },
          }),
        }),
      ],
    });

    expect(replay.slice(1, 3)).toEqual([
      expect.objectContaining({
        kind: "tool",
        displayName: "Past Problem Recall",
        argumentSummary: "similar sliding-window problems",
        resultSummary:
          "1 past problem item(s): Minimum Window Substring.",
      }),
      expect.objectContaining({
        kind: "tool",
        displayName: "Past Mistake Recall",
        argumentSummary: "repeated DP transition mistakes",
        resultSummary:
          "1 past mistake item(s): DP transition missed a predecessor.",
      }),
    ]);
  });

  it("filters messages and tool steps before the clear boundary", () => {
    const clearedAt = new Date("2026-06-10T10:00:05Z");
    const visible = filterChatHistoryAfterClear({
      clearedBeforeSequence: 2,
      clearedAt,
      messages: [
        createChatMessage("old-user", 1),
        createChatMessage("old-assistant", 2),
        createChatMessage("new-user", 3),
      ],
      toolEvents: [
        createToolEvent("old-tool", {
          occurredAt: new Date("2026-06-10T10:00:01Z"),
          eventJson: JSON.stringify({
            toolCallId: "call-old",
            toolName: "run_code",
            sequence: 1,
          }),
        }),
        createToolEvent("new-tool-sequence", {
          occurredAt: new Date("2026-06-10T10:00:02Z"),
          eventJson: JSON.stringify({
            toolCallId: "call-new",
            toolName: "run_code",
            sequence: 3,
          }),
        }),
        createToolEvent("new-tool-time", {
          occurredAt: new Date("2026-06-10T10:00:06Z"),
          eventJson: JSON.stringify({
            toolCallId: "call-no-sequence",
            toolName: "past_problem_recall",
          }),
        }),
      ],
    });

    expect(visible.messages.map((message) => message.id)).toEqual(["new-user"]);
    expect(visible.toolEvents.map((event) => event.id)).toEqual([
      "new-tool-sequence",
      "new-tool-time",
    ]);
  });

});

function createChatMessage(id: string, sequence: number) {
  return {
    id,
    role: "user",
    contentMarkdown: id,
    metadataJson: "{}",
    sequence,
    createdAt: new Date(`2026-06-10T10:00:0${sequence}Z`),
  };
}

function createToolEvent(
  id: string,
  overrides: {
    eventType?: "tool_call" | "tool_result";
    occurredAt: Date;
    eventJson: string;
  },
) {
  return {
    id,
    eventType: overrides.eventType ?? "tool_call",
    createdAt: overrides.occurredAt,
    ...overrides,
  };
}

function createAttempt(
  overrides: Partial<ProblemHistoryAttempt> = {},
): ProblemHistoryAttempt {
  return {
    id: "attempt",
    reviewAttemptId: "review",
    chatSessionId: "chat",
    problem: {
      id: "problem-1",
      slug: "search-insert-position",
      title: "Search Insert Position",
      leetcodeNumber: 35,
      difficulty: "Easy",
    },
    createdAt: new Date("2026-06-10T10:00:00Z"),
    language: "Python",
    userState: "My idea feels right but my code has bugs",
    tags: ["binary-search", "array"],
    runStatus: "failed",
    failedCaseSummary: "insert in middle: expected 1, actual 2",
    userIssueSummary: "boundary confusion",
    durationSeconds: null,
    hasFlashcard: false,
    ...overrides,
  };
}
