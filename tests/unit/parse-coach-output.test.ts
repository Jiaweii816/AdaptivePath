import { describe, expect, it } from "vitest";
import { parseCoachReviewOutput } from "@/server/agents/coach-agent/parse-coach-output";
import { DIAGNOSIS_SENTINEL } from "@/server/agents/coach-agent/review-output-protocol";
import type { CoachDiagnosis } from "@/types/coach";

const fallback: CoachDiagnosis = {
  problemSlug: "search-insert-position",
  runStatus: "failed",
  userIssueSummary: "fallback issue",
  coachSummary: "fallback summary",
  mistakeTags: [],
  skillTags: [],
  memoryUpdateCandidate: { facts: [], summary: "fallback" },
};

const goodDiagnosis: CoachDiagnosis = {
  problemSlug: "search-insert-position",
  runStatus: "failed",
  userIssueSummary: "Returned 2 instead of 1.",
  coachSummary: "Return left after the loop.",
  mistakeTags: ["binary_search_boundary_mistake"],
  skillTags: ["binary-search"],
  selfCheck: {
    question: "Search Insert 中 target 夹在两个数之间时返回哪个边界？",
    answer: "按第一个 >= target 的边界收缩，循环结束返回 left。",
  },
  memoryUpdateCandidate: { facts: [], summary: "boundary weakness" },
};

const reply = "Root cause: foo\nMinimal fix: bar";

describe("parseCoachReviewOutput", () => {
  it("parses a clean reply-first sentinel output", () => {
    const content = [
      reply,
      DIAGNOSIS_SENTINEL,
      JSON.stringify(goodDiagnosis),
    ].join("\n");
    const result = parseCoachReviewOutput(content, {
      fallbackDiagnosis: fallback,
    });

    expect(result.coachReply).toBe(reply);
    expect(result.diagnosis.mistakeTags).toEqual([
      "binary_search_boundary_mistake",
    ]);
    expect(result.diagnosis.selfCheck?.question).toContain("返回哪个边界");
    expect(result.degraded).toBeUndefined();
  });

  it("splits on the last sentinel line when the reply quotes it", () => {
    const replyWithSentinel = `${reply}\nI will write ${DIAGNOSIS_SENTINEL} below.`;
    const content = [
      replyWithSentinel,
      DIAGNOSIS_SENTINEL,
      JSON.stringify(goodDiagnosis),
    ].join("\n");
    const result = parseCoachReviewOutput(content, {
      fallbackDiagnosis: fallback,
    });

    expect(result.coachReply).toBe(replyWithSentinel);
    expect(result.diagnosis.coachSummary).toBe("Return left after the loop.");
  });

  it("ignores trailing prose after the diagnosis JSON object", () => {
    const content = [
      reply,
      DIAGNOSIS_SENTINEL,
      JSON.stringify(goodDiagnosis),
      "Thanks!",
    ].join("\n");
    const result = parseCoachReviewOutput(content, {
      fallbackDiagnosis: fallback,
    });

    expect(result.diagnosis.userIssueSummary).toBe("Returned 2 instead of 1.");
    expect(result.degraded).toBeUndefined();
  });

  it("degrades to fallback diagnosis when the JSON tail is corrupt", () => {
    const content = `${reply}\n${DIAGNOSIS_SENTINEL}\n{ not valid json `;
    const result = parseCoachReviewOutput(content, {
      fallbackDiagnosis: fallback,
    });

    expect(result.coachReply).toBe(reply);
    expect(result.diagnosis).toEqual(fallback);
    expect(result.degraded?.tier).toBe(1);
    expect(result.degraded?.memorySkipped).toBe(true);
  });

  it("treats the whole text as the reply when no sentinel exists", () => {
    const result = parseCoachReviewOutput(reply, {
      fallbackDiagnosis: fallback,
    });

    expect(result.coachReply).toBe(reply);
    expect(result.diagnosis).toEqual(fallback);
    expect(result.degraded?.tier).toBe(2);
  });

  it("parses legacy tagged-block output", () => {
    const content = [
      "<coach_reply_markdown>",
      reply,
      "</coach_reply_markdown>",
      "<diagnosis_json>",
      JSON.stringify(goodDiagnosis),
      "</diagnosis_json>",
    ].join("\n");
    const result = parseCoachReviewOutput(content, {
      fallbackDiagnosis: fallback,
    });

    expect(result.coachReply).toBe(reply);
    expect(result.diagnosis.mistakeTags).toEqual([
      "binary_search_boundary_mistake",
    ]);
    expect(result.degraded).toBeUndefined();
  });

  it("parses legacy whole-JSON review output", () => {
    const content = JSON.stringify({
      diagnosis: goodDiagnosis,
      coachReply: reply,
    });
    const result = parseCoachReviewOutput(content, {
      fallbackDiagnosis: fallback,
    });

    expect(result.coachReply).toBe(reply);
    expect(result.diagnosis.coachSummary).toBe("Return left after the loop.");
  });
});
