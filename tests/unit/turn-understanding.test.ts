import { describe, expect, expectTypeOf, it } from "vitest";

import { segmentClauses } from "@/server/agents/coach-agent/turn-understanding/clause-segmenter";
import {
  annotateDiscourse,
  annotateNegation,
} from "@/server/agents/coach-agent/turn-understanding/discourse-annotators";
import * as turnUnderstandingTypes from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";
import type {
  Operation,
  OperationFamily,
  TurnUnderstanding,
} from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";

describe("turn-understanding types", () => {
  it("loads the canonical type module", () => {
    expect(Object.keys(turnUnderstandingTypes)).toEqual([]);
  });

  it("enumerates exactly the nine operation families", () => {
    const families: OperationFamily[] = [
      "answer",
      "lookup_api",
      "diagnose",
      "execute",
      "optimize",
      "recall",
      "profile_meta",
      "recommend",
      "persist",
    ];

    expect(new Set(families).size).toBe(9);
  });

  it("keeps operation topics aligned with the approved taxonomy", () => {
    expectTypeOf<Operation["topic"]>().toEqualTypeOf<
      "concept" | "api" | "general" | undefined
    >();
  });

  it("shapes a minimal understanding", () => {
    const understanding: TurnUnderstanding = {
      route: "fast_path",
      clauses: [{ id: "c0", text: "hi" }],
      operations: [],
      modifiers: {
        codeDisclosure: { level: "guided", source: "default" },
        affect: "none",
        deliveryMode: "direct",
        requestedArtifact: "explanation",
      },
      discourseMarkers: [],
      negationSignals: [],
      learnerStateSignals: [],
      unsupportedScope: {},
      ambiguity: { blocksSideEffect: false, unresolvedOperationIds: [] },
    };

    expect(understanding.route).toBe("fast_path");
  });
});

describe("clause segmenter", () => {
  it("keeps a single clause single", () => {
    expect(segmentClauses("请运行一下当前代码")).toEqual([
      { id: "c0", text: "请运行一下当前代码" },
    ]);
  });

  it("splits English connectors and preserves order metadata", () => {
    const clauses = segmentClauses(
      "Run it again and tell me why it fails, but only give me a hint",
    );

    expect(clauses).toEqual([
      { id: "c0", text: "Run it again" },
      {
        id: "c1",
        text: "tell me why it fails",
        connectorBefore: "and",
      },
      {
        id: "c2",
        text: "only give me a hint",
        connectorBefore: "but",
      },
    ]);
  });

  it("splits Chinese connectors and normalizes connector meaning", () => {
    const clauses = segmentClauses(
      "提醒我 deque 怎么写，另外跑一下当前代码，然后解释结果",
    );

    expect(clauses).toEqual([
      { id: "c0", text: "提醒我 deque 怎么写" },
      { id: "c1", text: "跑一下当前代码", connectorBefore: "and" },
      { id: "c2", text: "解释结果", connectorBefore: "then" },
    ]);
  });

  it("does not split commas inside code arrays, calls, or literals", () => {
    const clauses = segmentClauses(
      "Run nums=[3,2,4] and inspect solve(nums, target='a,b')",
    );

    expect(clauses).toEqual([
      { id: "c0", text: "Run nums=[3,2,4]" },
      {
        id: "c1",
        text: "inspect solve(nums, target='a,b')",
        connectorBefore: "and",
      },
    ]);
  });

  it("does not mistake words containing connector text for connectors", () => {
    expect(segmentClauses("Explain the candy algorithm")).toEqual([
      { id: "c0", text: "Explain the candy algorithm" },
    ]);
  });

  it("keeps bitwise and logical operator terms in one clause", () => {
    for (const message of [
      "Explain bitwise and in Python",
      "Explain logical and in Python",
    ]) {
      expect(segmentClauses(message)).toEqual([{ id: "c0", text: message }]);
    }
  });

  it("splits a top-level 先…再 sequence as an ordered dependency", () => {
    expect(segmentClauses("先运行当前代码，再解释结果")).toEqual([
      { id: "c0", text: "先运行当前代码" },
      { id: "c1", text: "解释结果", connectorBefore: "then" },
    ]);
  });

  it("keeps standalone Chinese repeat requests in one clause", () => {
    for (const message of ["再来一次", "再解释一次"]) {
      expect(segmentClauses(message)).toEqual([{ id: "c0", text: message }]);
      expect(annotateDiscourse(message)).toContainEqual({
        kind: "repeat_marker",
        span: message,
        strength: "soft",
        polarity: "positive",
      });
    }
  });
});

describe("discourse and negation annotators", () => {
  it("returns every discourse match with its exact original span", () => {
    const marks = annotateDiscourse(
      "Again, explain that again because it is STILL failing.",
    );

    expect(marks.map(({ kind, span }) => ({ kind, span }))).toEqual([
      { kind: "repeat_marker", span: "Again" },
      { kind: "reference_marker", span: "that" },
      { kind: "repeat_marker", span: "again" },
      { kind: "reference_marker", span: "it" },
      { kind: "continuation_marker", span: "STILL" },
    ]);
    expect(marks.every((mark) => mark.polarity === "positive")).toBe(true);
  });

  it("returns every English and Chinese negation with negative polarity", () => {
    const negations = annotateNegation(
      "Don't run it, NEVER save it, and 不要执行，也别记录。",
    );

    expect(negations.map((negation) => negation.span)).toEqual([
      "Don't",
      "NEVER",
      "不要",
      "别",
    ]);
    expect(
      negations.every(
        (negation) =>
          negation.kind === "negation" &&
          negation.strength === "hard" &&
          negation.polarity === "negative",
      ),
    ).toBe(true);
  });

  it("preserves curly-apostrophe negation spans", () => {
    expect(annotateNegation("Don’t execute it")[0]?.span).toBe("Don’t");
  });

  it("returns nothing for plain requests and code arrays", () => {
    for (const message of ["请运行一下当前代码", "Run nums=[3,2,4]"]) {
      expect(annotateDiscourse(message)).toEqual([]);
      expect(annotateNegation(message)).toEqual([]);
    }
  });

  it("does not match discourse or negation substrings inside words", () => {
    for (const message of [
      "Compare against the notebook implementation",
      "Stillness and distillation need iteration",
    ]) {
      expect(annotateDiscourse(message)).toEqual([]);
      expect(annotateNegation(message)).toEqual([]);
    }
  });

  it("annotates a general without phrase as negation evidence", () => {
    expect(annotateNegation("Explain it without extra space")).toEqual([
      {
        kind: "negation",
        span: "without",
        strength: "hard",
        polarity: "negative",
      },
    ]);
  });
});
