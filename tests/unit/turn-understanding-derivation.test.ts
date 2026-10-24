import { describe, expect, it } from "vitest";

import { buildChatTurnPlan } from "@/server/agents/coach-agent/chat-intent-policy";
import { segmentClauses } from "@/server/agents/coach-agent/turn-understanding/clause-segmenter";
import {
  deriveModifiers,
  deriveOperations,
} from "@/server/agents/coach-agent/turn-understanding/derive-operations";
import {
  annotateDiscourse,
  annotateNegation,
} from "@/server/agents/coach-agent/turn-understanding/discourse-annotators";
import { classifyRoute } from "@/server/agents/coach-agent/turn-understanding/structural-route";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

describe("operation derivation and structural routing", () => {
  const parse = (message: string) => {
    const legacy = buildChatTurnPlan(message);
    const clauses = segmentClauses(message);
    const discourse = annotateDiscourse(message);
    const negation = annotateNegation(message);
    const operations = deriveOperations(
      legacy,
      clauses,
      resolveRequestedActions(message),
    );
    return {
      operations,
      modifiers: deriveModifiers(legacy, negation, message),
      route: classifyRoute({
        clauses,
        legacy,
        operations,
        discourse,
        negation,
      }),
    };
  };

  it("keeps ordered execute and diagnose operations for a compound turn", () => {
    const operations = parse(
      "Run my current code and diagnose why it fails",
    ).operations;
    expect(operations.map(({ family }) => family)).toEqual([
      "execute",
      "diagnose",
    ]);
    expect(operations.map(({ sourceClauseId }) => sourceClauseId)).toEqual([
      "c0",
      "c1",
    ]);
  });

  it("retains both history targets when both capabilities are present", () => {
    const message =
      "What similar problems have I solved before and what past mistakes have I made?";
    const recalls = parse(message).operations.filter(
      ({ family }) => family === "recall",
    );
    expect(recalls.map(({ target }) => target)).toEqual([
      "past_problem",
      "past_mistake",
    ]);
  });

  it("uses the canonical ledger for granted, denied, and ambiguous writes", () => {
    const granted = parse(
      "Please remember my preference, then run my current code",
    );
    expect(
      granted.operations.map(({ family, target }) => [family, target]),
    ).toEqual([
      ["persist", "preference"],
      ["execute", "current_user_code"],
    ]);
    expect(
      parse("Don't save this in my mistake book").operations.some(
        ({ family }) => family === "persist",
      ),
    ).toBe(false);
    const ambiguous = parse("The handbook note should be saved");
    expect(
      ambiguous.operations.find(({ family }) => family === "persist")
        ?.resolution,
    ).toBe("ambiguous");
    expect(ambiguous.route).toBe("llm");
  });

  it("keeps response controls orthogonal and scoped", () => {
    const hint = parse("Give me two hints, not the answer");
    expect(
      hint.operations.map(({ family, target }) => [family, target]),
    ).toEqual([["answer", "active_problem"]]);
    expect(hint.modifiers).toMatchObject({
      deliveryMode: "hint",
      requestedCount: 2,
    });
    expect(parse("I'm panicking, give me 三个例子").modifiers).toMatchObject({
      affect: "anxious_stuck",
      requestedCount: 3,
    });
    expect(parse("Give me pseudocode").modifiers.requestedArtifact).toBe(
      "pseudocode",
    );
    expect(
      parse("Explain it, but don't give me full code").modifiers.codeDisclosure
        .source,
    ).toBe("explicit_deny");
    expect(
      parse("Explain it without extra space").modifiers.codeDisclosure.source,
    ).toBe("default");
  });

  it("uses modifier answers only as a no-business-operation fallback", () => {
    const anxiousDebug = parse("I'm panicking; diagnose this bug");
    expect(anxiousDebug.operations.map(({ family }) => family)).toEqual([
      "diagnose",
    ]);
    expect(anxiousDebug.modifiers.affect).toBe("anxious_stuck");

    const hintedOptimization = parse(
      "Give me a hint and optimize my current code",
    );
    expect(hintedOptimization.operations.map(({ family }) => family)).toEqual([
      "optimize",
    ]);
    expect(hintedOptimization.modifiers.deliveryMode).toBe("hint");

    for (const message of [
      "Give me a hint",
      "I'm panicking",
      "Show me the full Python code",
    ]) {
      expect(parse(message).operations.map(({ family }) => family)).toEqual([
        "answer",
      ]);
    }
  });

  it("keeps stuck turns safe and retains affect beside a real operation", () => {
    const chineseFallback = parse("我卡住了，帮我看看");
    expect(chineseFallback.operations).toHaveLength(1);
    expect(chineseFallback.operations[0]).toMatchObject({
      family: "answer",
      target: "contextual_referent",
    });
    expect(chineseFallback.modifiers.affect).toBe("anxious_stuck");

    const stuckDebug = parse("I am still stuck; diagnose this bug");
    expect(stuckDebug.operations.map(({ family }) => family)).toEqual([
      "diagnose",
    ]);
    expect(stuckDebug.modifiers.affect).toBe("anxious_stuck");
    for (const message of ["I am stuck", "我卡住了", "我不会这题"]) {
      expect(parse(message).modifiers.affect).toBe("anxious_stuck");
    }
  });

  it("preserves candidate-run negation without suppressing current-code execution", () => {
    expect(
      parse("Run it again").operations.map(({ family }) => family),
    ).toEqual(["execute"]);
    const full = parse("Show me the full code again");
    expect(full.operations.map(({ family }) => family)).toEqual(["answer"]);
    expect(full.modifiers.codeDisclosure).toEqual({
      level: "full_code",
      source: "explicit_allow",
    });
    expect(
      parse("Don't run my current code").operations.some(
        ({ family }) => family === "execute",
      ),
    ).toBe(false);
    expect(
      parse("Don't run your candidate; run my current code").operations.map(
        ({ family, target }) => [family, target],
      ),
    ).toEqual([
      ["execute", "assistant_candidate"],
      ["execute", "current_user_code"],
    ]);
    expect(
      parse("Explain this, but don't run your candidate").operations.some(
        ({ family }) => family === "execute",
      ),
    ).toBe(true);
  });

  it("routes structural complexity while ignoring punctuation-only splits", () => {
    expect(parse("Run my current code").route).toBe("fast_path");
    expect(parse("Run my current code, please").route).toBe("fast_path");
    expect(parse("Explain queues, describe stacks").route).toBe("llm");
    expect(parse("Can you explain that again?").route).toBe("llm");
    expect(parse("Run my current code and diagnose why it fails").route).toBe(
      "llm",
    );
    expect(parse("Don't run my current code").route).toBe("llm");
  });
});
