import { describe, expect, it, vi } from "vitest";

import { deriveToolEligibility } from "@/server/agents/coach-agent/operation-plan/operation-tool-eligibility";
import type { BootstrappedChatTurn } from "@/server/agents/coach-agent/chat-turn-bootstrap";
import type { ClassifierOutput } from "@/server/agents/coach-agent/turn-classifier/classifier-output.schema";
import { resolveChatTurnUnderstanding } from "@/server/agents/coach-agent/turn-classifier/resolve-chat-turn-understanding";
import type { TurnClassifier } from "@/server/agents/coach-agent/turn-classifier/turn-classifier.types";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import { buildWorkspaceCodeRevision } from "@/server/agents/coach-agent/workspace-revision";

const NATURAL_RUN = "abba 这组我手算不稳，当前代码到底会吐多少？";
const CODE = [
  "class Solution:",
  "    def lengthOfLongestSubstring(self, s):",
  "        return 0  # SECRET_CURRENT_CODE",
].join("\n");

describe("chat-turn classifier wiring", () => {
  it("rejects LLM-invented execution when deterministic parsing did not grant it", async () => {
    const classify = vi.fn(
      async (context: Parameters<TurnClassifier["classify"]>[0]) => {
        expect(context.message).toBe(NATURAL_RUN);
        return executeCurrentCode();
      },
    );
    const fixture = chatTurn({ classify });
    const deterministic = parseTurnUnderstanding(NATURAL_RUN);
    expect(deterministic.route).toBe("llm");

    const result = await resolveChatTurnUnderstanding(fixture.turn, {
      deterministic,
      requestedActions: [],
      currentRevision: revision(),
    });

    expect(result).toMatchObject({
      provenance: "deterministic_fallback",
      fallbackReason: "validator_execute_not_explicitly_authorized",
      classifierActuallyCalled: true,
    });
    expect(deriveToolEligibility(result.understanding)).not.toContain(
      "run_current_code",
    );
    expect(fixture.findMany).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledTimes(1);
    const context = classify.mock.calls[0]?.[0];
    expect(context?.workspace).toMatchObject({
      language: "Python",
      codeState: "formed",
      currentCodeLength: CODE.length,
      selectedTestCount: 2,
      hasAssistantCandidate: false,
    });
    expect(JSON.stringify(context?.workspace)).not.toContain(
      "SECRET_CURRENT_CODE",
    );
  });

  it("does no classifier or history work on the fast path", async () => {
    const classify = vi.fn(
      async (context: Parameters<TurnClassifier["classify"]>[0]) => {
        expect(context.message).toBe("Run the current code");
        return executeCurrentCode();
      },
    );
    const fixture = chatTurn({ classify }, "Run the current code");
    const deterministic = parseTurnUnderstanding("Run the current code");
    expect(deterministic.route).toBe("fast_path");

    const result = await resolveChatTurnUnderstanding(fixture.turn, {
      deterministic,
      requestedActions: [],
      currentRevision: revision(),
    });

    expect(result.provenance).toBe("deterministic_fast");
    expect(result.classifierActuallyCalled).toBe(false);
    expect(classify).not.toHaveBeenCalled();
    expect(fixture.findMany).not.toHaveBeenCalled();
  });

  it("keeps an explicitly disabled slow path free of history and LLM work", async () => {
    const fixture = chatTurn(null);
    const deterministic = parseTurnUnderstanding(NATURAL_RUN);

    const result = await resolveChatTurnUnderstanding(fixture.turn, {
      deterministic,
      requestedActions: [],
      currentRevision: revision(),
    });

    expect(result).toMatchObject({
      understanding: deterministic,
      provenance: "deterministic_unconfigured",
      classifierActuallyCalled: false,
    });
    expect(fixture.findMany).not.toHaveBeenCalled();
  });
});

function executeCurrentCode(): ClassifierOutput {
  return {
    operations: [
      { family: "execute", target: "current_user_code", dependsOn: [] },
    ],
    modifiers: {
      deliveryMode: "direct",
      codeDisclosure: "guided",
      affect: "none",
    },
  };
}

function revision() {
  return buildWorkspaceCodeRevision({
    problemId: "longest-substring",
    language: "Python",
    code: CODE,
  });
}

function chatTurn(
  classifier: TurnClassifier | null,
  message = NATURAL_RUN,
) {
  const findMany = vi.fn(async () => []);
  const turn = {
    input: { message, language: "Python", code: CODE },
    selectedTestCases: [{ id: "case-1" }, { id: "case-2" }],
    chatSession: { id: "session-1", clearedBeforeSequence: 0 },
    deps: { turnClassifier: classifier },
    db: { chatMessage: { findMany } },
    traceContext: undefined,
  } as unknown as BootstrappedChatTurn;
  return { turn, findMany };
}
