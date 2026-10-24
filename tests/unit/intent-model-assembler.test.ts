import { describe, expect, it, vi } from "vitest";

import {
  assembleWithModel,
  MODEL_ASSEMBLER_TIMEOUT_MS,
} from "@/server/agents/coach-agent/turn-understanding-v2/assembler/model-assembler";
import { modelAssemblerOutputSchema } from "@/server/agents/coach-agent/turn-understanding-v2/assembler/model-assembler.types";

const input = {
  message: "把当前代码跑下看看",
  clauses: [{ id: "c0", text: "把当前代码跑下看看", start: 0, end: 9 }],
  evidence: [],
  workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
  projection: "assistant: try `run_solution()` with ```python\nsecret_code\n```",
};

function proposal(confidence = 0.9) {
  return {
    requests: [{
      id: "m0",
      kind: "execute",
      target: "current",
      sourceClauseIds: ["c0"],
      dependsOn: [],
    }],
    denials: [],
    certainty: { status: "confident", confidence },
  };
}

function client(payload: unknown) {
  return { complete: vi.fn().mockResolvedValue(JSON.stringify(payload)) };
}

describe("assembleWithModel", () => {
  it("rejects context and capability fields from the constrained proposal schema", () => {
    const parsed = modelAssemblerOutputSchema.safeParse({
      ...proposal(),
      contextNeeds: ["current_problem"],
      toolCapabilities: ["run_current_code"],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts a confident well-formed proposal and traces the accepted call", async () => {
    const injectedClient = client(proposal());
    const traceWriter = vi.fn(async () => undefined);
    const result = await assembleWithModel(input, {
      client: injectedClient,
      traceContext: undefined,
      traceWriter,
    });

    expect(result.ok).toBe(true);
    expect(injectedClient.complete).toHaveBeenCalledWith(
      expect.not.stringContaining("secret_code"),
    );
    expect(injectedClient.complete).toHaveBeenCalledWith(
      expect.stringContaining("Valid response shape example"),
    );
    expect(traceWriter).toHaveBeenCalledWith(expect.objectContaining({
      task: "chat.turn_model_assembler_v3",
      status: "ok",
      extraEventJson: { assemblerOutcome: "accepted" },
    }));
  });

  it("reports and traces low confidence rather than silently degrading", async () => {
    const traceWriter = vi.fn(async () => undefined);
    const result = await assembleWithModel(input, {
      client: client(proposal(0.4)),
      traceContext: undefined,
      traceWriter,
    });

    expect(result).toEqual({ ok: false, outcome: "low_confidence" });
    expect(traceWriter).toHaveBeenCalledWith(expect.objectContaining({
      status: "error",
      extraEventJson: { assemblerOutcome: "low_confidence" },
    }));
  });

  it("reports invalid_json for an unparseable response", async () => {
    const result = await assembleWithModel(input, {
      client: { complete: vi.fn().mockResolvedValue("not json") },
      traceContext: undefined,
    });

    expect(result).toEqual({ ok: false, outcome: "invalid_json" });
  });

  it("reports timeout when the provider exceeds the budget", async () => {
    const result = await assembleWithModel(input, {
      client: {
        complete: () => new Promise((resolve) => {
          setTimeout(() => resolve("{}"), MODEL_ASSEMBLER_TIMEOUT_MS + 50);
        }),
      },
      traceContext: undefined,
    });

    expect(result).toEqual({ ok: false, outcome: "timeout" });
  });
});
