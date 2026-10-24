import { describe, expect, it } from "vitest";
import { createMockInterviewerProvider } from "@/server/agents/interviewer-agent/mock-interviewer-provider";
import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import { filterMockInterviewMemoryUpdateCandidate } from "@/server/mock-interview/mock-interview-memory";
import type { CodeRunResult } from "@/types/code-runner";

describe("mock interview memory candidate filtering", () => {
  it("keeps problem tags and generic learning tags", () => {
    const result = filterMockInterviewMemoryUpdateCandidate({
      problemSlug: "two-sum",
      problemTags: ["array", "hash-table"],
      candidate: {
        facts: [
          {
            factType: "skill",
            tag: "hash-table",
            label: "Hash table",
            confidence: 0.7,
          },
          {
            factType: "mistake",
            tag: "debugging",
            label: "Debugging",
            confidence: 0.7,
          },
        ],
      },
    });

    expect(result.facts.map((fact) => fact.tag)).toEqual([
      "hash_table",
      "debugging_without_evidence",
    ]);
  });

  it("rejects parallel interview-only tags", () => {
    const result = filterMockInterviewMemoryUpdateCandidate({
      problemSlug: "two-sum",
      problemTags: ["array"],
      candidate: {
        facts: [
          {
            factType: "skill",
            tag: "interview_confidence",
            label: "Interview confidence",
            confidence: 0.6,
          },
          {
            factType: "interview_signal",
            tag: "array",
            label: "Array",
            confidence: 0.6,
          },
        ],
      },
    });

    expect(result.facts).toEqual([]);
  });
});

describe("mock interview evidence trust", () => {
  it("does not turn unavailable run evidence into failed-case questioning or mistake facts", async () => {
    const provider = createMockInterviewerProvider();
    const latestRunResult: CodeRunResult = {
      status: "runner_error",
      failureProvenance: "network",
      passedCount: 0,
      failedCount: 0,
      stdout: "",
      stderr: "ECONNRESET",
      testResults: [],
      rawResult: { providerUsed: "mock" },
    };
    const latestRunVerdict = classifyExecutionEvidence(latestRunResult, {
      consumer: "mock_interview",
      providerUsed: "mock",
    });
    const commonInput = {
      sessionId: "session-1",
      problem: {
        id: "problem-1",
        slug: "two-sum",
        title: "Two Sum",
        leetcodeNumber: 1,
        difficulty: "Easy",
        tags: ["hash-table"],
      },
      dossier: {
        displayName: "Iris",
        focusTags: ["hash-table"],
        strongSignals: [],
        weakSignals: [],
        recentMistakes: [],
        solvedTags: [],
        languagePreference: "en" as const,
      },
      transcript: [],
      language: "Python" as const,
      latestCode: "class Solution:\n    pass",
      latestRunResult,
      latestRunVerdict,
      responseLanguage: "en" as const,
    };

    const turn = await provider.discussCode({
      ...commonInput,
      currentPhase: "coding",
      legalPhases: ["code_discussion", "wrap_up"],
      questionCount: 3,
      maxQuestions: 10,
      durationMinutes: 25,
      elapsedMinutes: 8,
    });
    const report = await provider.complete(commonInput);

    expect(turn.messageMarkdown).not.toContain("first failed case");
    expect(turn.messageMarkdown).not.toContain("latest run status");
    expect(report.report.codeNotes[0]).toContain("not verdict-bearing");
    expect(report.report.memoryUpdateCandidate.facts).toEqual([]);
    expect(report.report.scores.debuggingWithEvidence).toBeLessThan(0.5);
  });
});
