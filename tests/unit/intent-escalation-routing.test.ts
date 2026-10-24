import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeAssemblerPrompt,
  resolveChatTurnUnderstandingV2,
} from "@/server/agents/coach-agent/turn-classifier/resolve-chat-turn-understanding-v2";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

const workspace = { hasCurrentCode: true, hasAssistantCandidate: true };
const originalAssembler = process.env.CHAT_MODEL_ASSEMBLER;

afterEach(() => {
  if (originalAssembler === undefined) delete process.env.CHAT_MODEL_ASSEMBLER;
  else process.env.CHAT_MODEL_ASSEMBLER = originalAssembler;
});

describe("Intent Compiler v3 escalation routing", () => {
  it("marks low coverage, effect ambiguity, and their union", () => {
    expect(routeFor("把当前代码跑下看看").escalationReasons).toContain("low_coverage");
    expect(routeFor("跑一下它").escalationReasons).toContain("effect_ambiguity");
    const reasons = routeFor("把它跑下看看行不行").escalationReasons;
    expect(reasons).toEqual(expect.arrayContaining(["low_coverage", "effect_ambiguity"]));
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("keeps fully matched and trivial turns deterministic", () => {
    expect(routeFor("请运行我的代码")).toEqual({
      kind: "fast_path", escalationReasons: [],
    });
    expect(routeFor("谢谢")).toEqual({ kind: "fast_path", escalationReasons: [] });
  });

  it.each([
    "把当前代码跑下看看",
    "跑一下它",
    "把它跑下看看行不行",
  ])("calls the model assembler once for %s", async (message) => {
    const complete = vi.fn(async () => JSON.stringify(respondProposal()));
    const result = await resolve(message, complete);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.classifierActuallyCalled).toBe(true);
  });

  it("does not call the assembler when CHAT_MODEL_ASSEMBLER=0", async () => {
    process.env.CHAT_MODEL_ASSEMBLER = "0";
    const complete = vi.fn(async () => JSON.stringify(respondProposal()));
    const result = await resolve("把当前代码跑下看看", complete);

    expect(complete).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provenance: "semantic_fallback",
      classifierActuallyCalled: false,
      fallbackReason: "assembler_disabled",
    });
  });

  it("uses strict JSON Schema and disables Qwen thinking for the assembler", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "{}" } }],
    });

    await completeAssemblerPrompt(
      { chat: { completions: { create } } } as never,
      "qwen3-8b",
      "Return JSON.",
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "qwen3-8b",
      enable_thinking: false,
      response_format: expect.objectContaining({
        type: "json_schema",
        json_schema: expect.objectContaining({
          name: "turn_assembly",
          strict: true,
        }),
      }),
    }));
  });
});

function routeFor(message: string) {
  return compileTurnUnderstandingV2(message, { workspace }).route;
}

async function resolve(message: string, complete: ReturnType<typeof vi.fn>) {
  const deterministic = compileTurnUnderstandingV2(message, { workspace });
  return resolveChatTurnUnderstandingV2({
    input: { message, code: "print(1)", language: "Python" },
    deps: { modelAssembler: { complete } },
    selectedTestCases: [],
    traceContext: undefined,
  } as never, {
    deterministic,
    requestedActions: resolveRequestedActions(message),
    historyProjection: { messages: [], decisions: [] },
  });
}

function respondProposal() {
  return {
    requests: [{
      id: "m0",
      kind: "respond",
      deliverable: "understand",
      target: "current",
      basis: ["current_evidence"],
      delivery: { depth: "normal", form: "prose" },
      sourceClauseIds: ["c0"],
      dependsOn: [],
    }],
    denials: [],
    certainty: { status: "confident", confidence: 0.9 },
  };
}
