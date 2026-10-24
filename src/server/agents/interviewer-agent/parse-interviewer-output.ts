import {
  mockInterviewPhaseSchema,
  mockInterviewReportSchema,
  type MockInterviewPhase,
} from "@/types/mock-interview";
import {
  INTERVIEW_REPORT_JSON_SENTINEL,
  INTERVIEW_TURN_JSON_SENTINEL,
} from "./interview-output-protocol";
import {
  DEFAULT_INTERVIEW_SCORES,
  type InterviewerReportResult,
  type InterviewerTurnResult,
} from "./interviewer-agent.types";

export function parseInterviewerTurnOutput(
  raw: string,
  fallback: { currentPhase: MockInterviewPhase },
): InterviewerTurnResult {
  const { markdown, jsonText } = splitSentinel(raw, INTERVIEW_TURN_JSON_SENTINEL);
  const parsed = parseJsonObject(jsonText);
  const proposed = parsed
    ? readProposedPhase(parsed.proposedPhase, fallback.currentPhase)
    : "stay";
  const questionAsked =
    typeof parsed?.questionAsked === "boolean"
      ? parsed.questionAsked
      : fallback.currentPhase !== "wrap_up";

  return {
    messageMarkdown: markdown.trim() || fallbackQuestion(fallback.currentPhase),
    proposedPhase: proposed,
    questionAsked,
  };
}

export function parseInterviewerReportOutput(raw: string): InterviewerReportResult {
  const { markdown, jsonText } = splitSentinel(raw, INTERVIEW_REPORT_JSON_SENTINEL);
  const parsed = parseJsonObject(jsonText);
  const report = mockInterviewReportSchema.safeParse(parsed);

  if (report.success) {
    return {
      reportMarkdown: markdown.trim() || buildReportMarkdown(report.data),
      report: report.data,
    };
  }

  return {
    reportMarkdown: markdown.trim() || buildFallbackReportMarkdown(),
    report: {
      verdict: "The interview produced partial evidence; review the transcript before drawing a strong conclusion.",
      overallSignal: "needs_work",
      scores: DEFAULT_INTERVIEW_SCORES,
      strengths: [],
      concerns: ["The final report JSON could not be parsed reliably."],
      missedFollowUps: [],
      codeNotes: [],
      recommendations: [],
      memoryUpdateCandidate: { facts: [] },
    },
  };
}

function splitSentinel(raw: string, sentinel: string) {
  const index = raw.lastIndexOf(sentinel);

  if (index < 0) {
    return { markdown: raw, jsonText: "" };
  }

  return {
    markdown: raw.slice(0, index),
    jsonText: raw.slice(index + sentinel.length).trim(),
  };
}

function parseJsonObject(jsonText: string): Record<string, unknown> | undefined {
  if (!jsonText) {
    return undefined;
  }

  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");

  if (start < 0 || end < start) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(jsonText.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readProposedPhase(
  value: unknown,
  currentPhase: MockInterviewPhase,
): MockInterviewPhase | "stay" {
  if (value === "stay") {
    return "stay";
  }

  const parsed = mockInterviewPhaseSchema.safeParse(value);
  return parsed.success ? parsed.data : currentPhase;
}

function fallbackQuestion(phase: MockInterviewPhase) {
  if (phase === "wrap_up") {
    return "Let's stop the interview here and move into the debrief.";
  }

  return "I want to pin this down more concretely. Walk me through the next edge case you would test and why.";
}

function buildReportMarkdown(report: {
  verdict: string;
  strengths: string[];
  concerns: string[];
  missedFollowUps: string[];
  codeNotes: string[];
  recommendations: Array<{ tag: string; reason: string }>;
}) {
  return [
    "## Verdict",
    report.verdict,
    "## Strong Signals",
    listOrNone(report.strengths),
    "## Concerns",
    listOrNone(report.concerns),
    "## Follow-up Questions You Missed",
    listOrNone(report.missedFollowUps),
    "## Code And Debugging Notes",
    listOrNone(report.codeNotes),
    "## Recommended Drills",
    listOrNone(report.recommendations.map((item) => `${item.tag}: ${item.reason}`)),
  ].join("\n\n");
}

function buildFallbackReportMarkdown() {
  return [
    "## Verdict",
    "The interview completed, but the structured report could not be parsed reliably.",
    "## Strong Signals",
    "No reliable structured strengths were extracted.",
    "## Concerns",
    "Review the transcript manually before updating your learning plan.",
    "## Follow-up Questions You Missed",
    "No reliable structured follow-ups were extracted.",
    "## Code And Debugging Notes",
    "Use the latest run evidence as the source of truth.",
    "## Recommended Drills",
    "Repeat the same problem in Workbench Review mode.",
  ].join("\n\n");
}

function listOrNone(values: string[]) {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : "- None recorded.";
}
