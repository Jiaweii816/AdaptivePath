import { describe, expect, it } from "vitest";
import {
  DURABLE_WRITE_TOOL_NAMES,
  isDurableWriteToolName,
} from "@/server/tools/chat-tools/durable-write-types";
import {
  evaluateDurableWriteResult,
  getDurableWriteResultSemantics,
} from "@/server/tools/chat-tools/durable-write-result-semantics";

describe("durable write result semantics", () => {
  it("defines the three durable write tools in one canonical list", () => {
    expect(DURABLE_WRITE_TOOL_NAMES).toEqual([
      "note_memory",
      "save_knowledge_note",
      "save_mistake_book_entry",
    ]);
    expect(isDurableWriteToolName("save_knowledge_note")).toBe(true);
    expect(isDurableWriteToolName("lookup_api_reference")).toBe(false);
  });

  it.each(DURABLE_WRITE_TOOL_NAMES)(
    "%s never treats saved:false as completed",
    (toolName) => {
      const evaluation = evaluateDurableWriteResult(toolName, {
        ...validResultFor(toolName),
        saved: false,
      });

      expect(evaluation).toMatchObject({
        status: "failed",
        failureReason: "durable_write_not_completed",
        outcome: {
          toolName,
          status: "failed",
          reason: "durable_write_not_completed",
        },
      });
      expect(
        getDurableWriteResultSemantics(toolName).isCompleted({
          ...validResultFor(toolName),
          saved: false,
        }),
      ).toBe(false);
    },
  );

  it.each(DURABLE_WRITE_TOOL_NAMES)(
    "%s requires both a valid result schema and semantic success",
    (toolName) => {
      const evaluation = evaluateDurableWriteResult(
        toolName,
        validResultFor(toolName),
      );

      expect(evaluation.status).toBe("completed");
      expect(evaluation.outcome).toMatchObject({
        toolName,
        status: "completed",
      });
    },
  );

  it("rejects malformed results before applying semantic predicates", () => {
    expect(
      evaluateDurableWriteResult("save_knowledge_note", {
        saved: true,
        noteId: "note-1",
      }),
    ).toMatchObject({
      status: "failed",
      failureReason: "invalid_tool_result",
      outcome: {
        status: "failed",
        reason: "invalid_tool_result",
      },
    });
  });

  it("requires a durable record id when record-producing writes claim success", () => {
    expect(
      evaluateDurableWriteResult("save_knowledge_note", {
        ...validResultFor("save_knowledge_note"),
        noteId: null,
      }).status,
    ).toBe("failed");
    expect(
      evaluateDurableWriteResult("save_mistake_book_entry", {
        ...validResultFor("save_mistake_book_entry"),
        entryId: null,
      }).status,
    ).toBe("failed");
  });
});

function validResultFor(toolName: (typeof DURABLE_WRITE_TOOL_NAMES)[number]) {
  switch (toolName) {
    case "note_memory":
      return {
        saved: true,
        factType: "preference" as const,
        tag: "explanation_style",
        value: "short",
        message: "saved",
      };
    case "save_knowledge_note":
      return {
        saved: true,
        noteId: "note-1",
        conceptKey: "python_truncate",
        title: "Python truncation",
        alreadyExisted: false,
        lookupCount: 1,
        message: "saved",
      };
    case "save_mistake_book_entry":
      return {
        saved: true,
        entryId: "entry-1",
        problemSlug: "evaluate-reverse-polish-notation",
        title: "RPN truncation",
        saveCount: 1,
        message: "saved",
      };
  }
}
