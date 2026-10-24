import { describe, expect, it } from "vitest";

import { segmentClausesV2 } from "@/server/agents/coach-agent/turn-understanding-v2/clause-segmenter-v2";
import type { TurnClauseV2 } from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";

function expectExactSpans(message: string, clauses: TurnClauseV2[]): void {
  for (const clause of clauses) {
    expect(message.slice(clause.start, clause.end)).toBe(clause.text);
  }
}

function project(clauses: TurnClauseV2[]) {
  return clauses.map(({ text, connectorBefore }) => ({
    text,
    ...(connectorBefore ? { connectorBefore } : {}),
  }));
}

describe("V2 clause segmenter", () => {
  it.each([
    "Can you explain that again?",
    "再解释一次",
    "再运行一次",
  ])("keeps a repeat request as one unordered clause: %s", (message) => {
    const clauses = segmentClausesV2(message);

    expect(project(clauses)).toEqual([{ text: message }]);
    expectExactSpans(message, clauses);
  });

  it("segments the reported Chinese hint request without assigning a route", () => {
    const message = "这个题目我没有什么思路，请你给我一点暗示";
    const clauses = segmentClausesV2(message);

    expect(project(clauses)).toEqual([
      { text: "这个题目我没有什么思路" },
      { text: "请你给我一点暗示" },
    ]);
    expectExactSpans(message, clauses);
  });

  it("segments a scoped English negation at a semicolon", () => {
    const message = "Don't run it; just explain why this boundary works.";
    const clauses = segmentClausesV2(message);

    expect(project(clauses)).toEqual([
      { text: "Don't run it" },
      { text: "just explain why this boundary works" },
    ]);
    expectExactSpans(message, clauses);
  });

  it.each([
    {
      message: "运行代码，解释结果",
      expected: [{ text: "运行代码" }, { text: "解释结果" }],
    },
    {
      message: "Run the code; explain the result",
      expected: [{ text: "Run the code" }, { text: "explain the result" }],
    },
    {
      message: "Explain this\nRun the code",
      expected: [{ text: "Explain this" }, { text: "Run the code" }],
    },
  ])("uses top-level punctuation only as span boundaries: $message", ({ message, expected }) => {
    const clauses = segmentClausesV2(message);

    expect(project(clauses)).toEqual(expected);
    expectExactSpans(message, clauses);
  });

  it.each([
    "Use values 3, 2, 4 to test",
    "Use nums=[3,2,4] to test",
    "Compare versions 3.12 and 3.13",
    "1. Explain the invariant\n2. Run the code",
  ])("does not split numeric or structured-list punctuation: %s", (message) => {
    const clauses = segmentClausesV2(message);

    if (message.includes("\n")) {
      expect(project(clauses)).toEqual([
        { text: "1. Explain the invariant" },
        { text: "2. Run the code" },
      ]);
    } else {
      expect(project(clauses)).toEqual([{ text: message }]);
    }
    expectExactSpans(message, clauses);
  });

  it("keeps fenced and inline code punctuation protected", () => {
    const message =
      "Review ```python\nnums = [3,2,4]\nprint(nums)\n```; explain `a,b; c`";
    const clauses = segmentClausesV2(message);

    expect(project(clauses)).toEqual([
      { text: "Review ```python\nnums = [3,2,4]\nprint(nums)\n```" },
      { text: "explain `a,b; c`" },
    ]);
    expectExactSpans(message, clauses);
  });

  it.each([
    {
      message: 'Explain "left, right; mid"; then continue',
      first: 'Explain "left, right; mid"',
      second: "continue",
    },
    {
      message: "请解释“先运行，再分析”；然后继续",
      first: "请解释“先运行，再分析”",
      second: "继续",
    },
    {
      message: "Explain solve(nums=[3,2], options={mode: 'a,b'}); then continue",
      first: "Explain solve(nums=[3,2], options={mode: 'a,b'})",
      second: "continue",
    },
  ])("protects quoted and nested punctuation: $message", ({ message, first, second }) => {
    const clauses = segmentClausesV2(message);

    expect(project(clauses)).toEqual([
      { text: first },
      { text: second, connectorBefore: "then" },
    ]);
    expectExactSpans(message, clauses);
  });

  it("marks an explicit 先…再… sequence as ordered", () => {
    const message = "先运行当前代码，再解释失败原因";
    const clauses = segmentClausesV2(message);

    expect(project(clauses)).toEqual([
      { text: "先运行当前代码" },
      { text: "解释失败原因", connectorBefore: "then" },
    ]);
    expect(clauses[1]?.start).toBe(message.indexOf("解释失败原因"));
    expectExactSpans(message, clauses);
  });

  it("marks and/but/和/但是 as parallel or contrast, never as then", () => {
    const english = "Run the code and explain it but don't save anything";
    const chinese = "运行代码和解释结果，但是不要保存";

    const englishClauses = segmentClausesV2(english);
    expect(project(englishClauses)).toEqual([
      { text: "Run the code" },
      { text: "explain it", connectorBefore: "and" },
      { text: "don't save anything", connectorBefore: "but" },
    ]);
    expectExactSpans(english, englishClauses);

    const chineseClauses = segmentClausesV2(chinese);
    expect(project(chineseClauses)).toEqual([
      { text: "运行代码" },
      { text: "解释结果", connectorBefore: "and" },
      { text: "不要保存", connectorBefore: "but" },
    ]);
    expectExactSpans(chinese, chineseClauses);
  });

  it("ignores repeated punctuation instead of emitting empty clauses", () => {
    const message = "，，运行代码;;;；；解释结果。。";
    const clauses = segmentClausesV2(message);

    expect(project(clauses)).toEqual([
      { text: "运行代码" },
      { text: "解释结果" },
    ]);
    expect(segmentClausesV2("，，；；...\n")).toEqual([]);
    expectExactSpans(message, clauses);
  });
});
