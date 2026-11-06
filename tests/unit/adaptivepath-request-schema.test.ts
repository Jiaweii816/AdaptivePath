import { describe, expect, it } from "vitest";
import { practiceRequestSchema } from "@/server/adaptivepath/request-schema";

const chat = { action: "chat", focus: { kind: "current_question", questionId: "q1" }, message: "Explain Reference 1 (p. 316)" };

describe("practice chat request", () => {
  it("accepts clicked prompt ids and an attached passage", () => {
    const parsed = practiceRequestSchema.parse({ ...chat, promptIds: ["explain_reference"], referenceChunkId: "b2e-12-2-p01-c05" });
    expect(parsed).toMatchObject({ promptIds: ["explain_reference"], referenceChunkId: "b2e-12-2-p01-c05" });
  });

  it("requires the prompt list, empty for a typed message", () => {
    expect(() => practiceRequestSchema.parse(chat)).toThrow();
    expect(practiceRequestSchema.parse({ ...chat, promptIds: [] })).toMatchObject({ promptIds: [] });
  });

  it("rejects unknown and repeated prompt ids", () => {
    expect(() => practiceRequestSchema.parse({ ...chat, promptIds: ["make_it_up"] })).toThrow();
    expect(() => practiceRequestSchema.parse({ ...chat, promptIds: ["check_reasoning", "check_reasoning"] })).toThrow();
  });
});
