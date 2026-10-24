import { describe, expect, it } from "vitest";
import {
  INTERVIEW_REPORT_JSON_SENTINEL,
  INTERVIEW_TURN_JSON_SENTINEL,
} from "@/server/agents/interviewer-agent/interview-output-protocol";
import {
  parseInterviewerReportOutput,
  parseInterviewerTurnOutput,
} from "@/server/agents/interviewer-agent/parse-interviewer-output";

describe("interviewer output parser", () => {
  it("keeps visible markdown and reads turn metadata after the sentinel", () => {
    const result = parseInterviewerTurnOutput(
      [
        "先停一下，解释你的循环不变量。",
        INTERVIEW_TURN_JSON_SENTINEL,
        '{"proposedPhase":"technical_screen","questionAsked":true}',
      ].join("\n"),
      { currentPhase: "intro" },
    );

    expect(result.messageMarkdown).toBe("先停一下，解释你的循环不变量。");
    expect(result.proposedPhase).toBe("technical_screen");
    expect(result.questionAsked).toBe(true);
  });

  it("falls back to visible markdown when turn JSON is malformed", () => {
    const result = parseInterviewerTurnOutput(
      [
        "We will use the transcript as source of truth.",
        INTERVIEW_TURN_JSON_SENTINEL,
        "{not-json",
      ].join("\n"),
      { currentPhase: "coding" },
    );

    expect(result.messageMarkdown).toBe("We will use the transcript as source of truth.");
    expect(result.proposedPhase).toBe("stay");
    expect(result.questionAsked).toBe(true);
  });

  it("parses final reports without hiding markdown if JSON is valid", () => {
    const result = parseInterviewerReportOutput(
      [
        "## Verdict",
        "Acceptable signal.",
        INTERVIEW_REPORT_JSON_SENTINEL,
        JSON.stringify({
          verdict: "Acceptable signal.",
          overallSignal: "acceptable",
          scores: {
            communication: 0.7,
            problemDecomposition: 0.7,
            correctness: 0.6,
            complexityReasoning: 0.6,
            debuggingWithEvidence: 0.5,
            codeQuality: 0.6,
          },
          strengths: ["Clear invariant."],
          concerns: [],
          missedFollowUps: [],
          codeNotes: [],
          recommendations: [],
          memoryUpdateCandidate: { facts: [] },
        }),
      ].join("\n"),
    );

    expect(result.reportMarkdown).toContain("## Verdict");
    expect(result.report.overallSignal).toBe("acceptable");
    expect(result.report.strengths).toEqual(["Clear invariant."]);
  });
});
