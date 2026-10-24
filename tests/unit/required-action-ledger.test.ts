import { describe, expect, it } from "vitest";
import {
  buildActionOutcomes,
  createRequiredActionLedger,
  markRequiredActionFailed,
  markRequiredActionUnfulfilled,
  recordInvalidArguments,
  recordRequiredActionResult,
} from "@/server/tools/chat-tools/required-action-ledger";

describe("required action ledger", () => {
  it("orders obligations by user expression order and rejects duplicates", () => {
    const ledger = createRequiredActionLedger([
      seed("save_knowledge_note", 20),
      seed("save_mistake_book_entry", 3),
    ]);

    expect(ledger.actions.map((action) => action.toolName)).toEqual([
      "save_mistake_book_entry",
      "save_knowledge_note",
    ]);
    expect(() =>
      createRequiredActionLedger([
        seed("save_knowledge_note", 1),
        seed("save_knowledge_note", 2),
      ]),
    ).toThrow(/duplicate required action/i);
  });

  it("allows exactly one invalid-argument correction", () => {
    const initial = createRequiredActionLedger([
      seed("save_knowledge_note", 1),
    ]);
    const first = recordInvalidArguments(initial, "save_knowledge_note");

    expect(first.retryAllowed).toBe(true);
    expect(first.ledger.actions[0]).toMatchObject({
      status: "pending",
      invalidArgumentFailures: 1,
    });

    const second = recordInvalidArguments(first.ledger, "save_knowledge_note");
    expect(second.retryAllowed).toBe(false);
    expect(second.ledger.actions[0]).toMatchObject({
      status: "failed",
      invalidArgumentFailures: 2,
      terminalReason: "invalid_tool_arguments",
      outcome: {
        status: "failed",
        reason: "invalid_tool_arguments",
      },
    });
  });

  it("completes only after schema-valid, tool-specific semantic success", () => {
    const initial = createRequiredActionLedger([
      seed("save_knowledge_note", 1),
    ]);
    const failed = recordRequiredActionResult(
      initial,
      "save_knowledge_note",
      knowledgeResult({ saved: false, noteId: null }),
    );

    expect(failed.actions[0]).toMatchObject({
      status: "failed",
      terminalReason: "durable_write_not_completed",
      outcome: { status: "failed" },
    });

    const completed = recordRequiredActionResult(
      initial,
      "save_knowledge_note",
      knowledgeResult({ saved: true, noteId: "note-1" }),
    );
    expect(completed.actions[0]).toMatchObject({
      status: "completed",
      outcome: {
        status: "completed",
        recordId: "note-1",
      },
    });
  });

  it("keeps terminal states immutable", () => {
    const completed = recordRequiredActionResult(
      createRequiredActionLedger([seed("save_knowledge_note", 1)]),
      "save_knowledge_note",
      knowledgeResult({ saved: true, noteId: "note-1" }),
    );

    expect(() =>
      markRequiredActionFailed(
        completed,
        "save_knowledge_note",
        "tool_execution_error",
      ),
    ).toThrow(/terminal/i);
    expect(() =>
      recordInvalidArguments(completed, "save_knowledge_note"),
    ).toThrow(/terminal/i);
  });

  it("marks pending obligations unfulfilled with backend-owned outcomes", () => {
    const initial = createRequiredActionLedger([
      seed("save_mistake_book_entry", 1),
      seed("save_knowledge_note", 2),
    ]);
    const partial = recordRequiredActionResult(
      initial,
      "save_mistake_book_entry",
      {
        saved: true,
        entryId: "entry-1",
        problemSlug: "evaluate-reverse-polish-notation",
        title: "RPN truncation",
        saveCount: 1,
        message: "saved",
      },
    );
    const stopped = markRequiredActionUnfulfilled(
      partial,
      "save_knowledge_note",
      "protocol_violation",
    );

    expect(buildActionOutcomes(stopped)).toEqual([
      expect.objectContaining({
        toolName: "save_mistake_book_entry",
        status: "completed",
        recordId: "entry-1",
      }),
      expect.objectContaining({
        toolName: "save_knowledge_note",
        status: "unfulfilled",
        reason: "protocol_violation",
      }),
    ]);
  });

  it("refuses to construct final outcomes while an obligation is pending", () => {
    expect(() =>
      buildActionOutcomes(
        createRequiredActionLedger([seed("save_knowledge_note", 1)]),
      ),
    ).toThrow(/pending/i);
  });
});

function seed(
  toolName: "note_memory" | "save_knowledge_note" | "save_mistake_book_entry",
  order: number,
) {
  return {
    toolName,
    order,
    evidence: [{ clause: `clause-${order}` }],
  } as const;
}

function knowledgeResult(overrides: { saved: boolean; noteId: string | null }) {
  return {
    saved: overrides.saved,
    noteId: overrides.noteId,
    conceptKey: "python_truncate",
    title: "Python truncation",
    alreadyExisted: false,
    lookupCount: overrides.saved ? 1 : 0,
    message: overrides.saved ? "saved" : "not saved",
  };
}
