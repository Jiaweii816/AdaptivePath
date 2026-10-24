import type {
  InterviewerReportInput,
  InterviewerTurnInput,
  InterviewerStartInput,
} from "./interviewer-agent.types";
import {
  INTERVIEW_REPORT_JSON_SENTINEL,
  INTERVIEW_TURN_JSON_SENTINEL,
} from "./interview-output-protocol";

export function buildInterviewerSystemPrompt(responseLanguage: "zh" | "en") {
  const languageLine =
    responseLanguage === "zh"
      ? "Respond to the candidate in Chinese."
      : "Respond to the candidate in English.";

  return [
    "You are PatternCoach AI's InterviewerAgent, a direct but fair senior coding interviewer.",
    languageLine,
    "This is not CoachAgent. Do not teach step by step during the interview.",
    "Ask exactly one main question per turn. Prefer probing evidence, boundaries, complexity, and debugging habits.",
    "If the candidate asks for a hint, give only a small interviewer-style nudge, not a full solution.",
    "Never use the word Submit. Never claim hidden-test success, accepted status, guaranteed AC, or all hidden tests passed.",
    "Use run evidence only as evidence. Do not invent execution results.",
    "If run evidence says failureProvenance is user_code, treat stderr as user-code behavior; do not imply Piston, LeetCode, the judge, or the sandbox crashed unless the verdict says the service failed.",
    "Output visible markdown first. Then write the sentinel and one JSON object.",
  ].join("\n");
}

export function buildStartPrompt(input: InterviewerStartInput) {
  return [
    "Start a text-only coding mock interview.",
    formatSessionFacts({
      problem: input.problem,
      dossier: input.dossier,
      language: input.language,
      responseLanguage: input.responseLanguage,
      durationMinutes: input.durationMinutes,
      questionCount: 0,
      maxQuestions: input.maxQuestions,
      currentPhase: "intro",
      legalPhases: ["intro", "technical_screen"],
    }),
    "Opening turn requirements:",
    "- Briefly set expectations.",
    "- Ask one opening/background or approach-calibration question.",
    "- The opening question is not counted in questionCount.",
    "- Do not reveal a solution.",
    "",
    `After the visible markdown, write ${INTERVIEW_TURN_JSON_SENTINEL} and JSON:`,
    `{"proposedPhase":"intro","questionAsked":false}`,
  ].join("\n");
}

export function buildTurnPrompt(input: InterviewerTurnInput, mode: "turn" | "code") {
  const codeInstruction =
    mode === "code"
      ? "Focus this turn on the submitted code snapshot and latest run evidence."
      : "Continue the interview from the candidate's latest answer.";

  return [
    codeInstruction,
    formatSessionFacts(input),
    "Recent transcript:",
    formatTranscript(input.transcript),
    "Latest code snapshot:",
    input.latestCode ? fenced(input.latestCode, input.language) : "No code snapshot yet.",
    "Latest run evidence:",
    input.latestRunResult
      ? JSON.stringify(summarizeRunResult(input.latestRunResult), null, 2)
      : "No run evidence yet.",
    "Latest run verdict:",
    input.latestRunVerdict
      ? JSON.stringify(input.latestRunVerdict, null, 2)
      : "No evidence verdict yet.",
    "",
    "Turn requirements:",
    "- Ask one pointed follow-up unless the legal phase is only wrap_up.",
    "- If evidenceVerdict.canVerdict is false, do not say the code passed or failed and do not ask about a first failed case.",
    "- If verdict-bearing evidence failed, ask the candidate to reason about the first failed case before giving a fix.",
    "- If evidence passed, probe complexity, edge cases, or explainability.",
    "- proposedPhase must be stay or one of the legal phases listed above.",
    "",
    `After the visible markdown, write ${INTERVIEW_TURN_JSON_SENTINEL} and JSON:`,
    `{"proposedPhase":"stay","questionAsked":true}`,
  ].join("\n");
}

export function buildReportPrompt(input: InterviewerReportInput) {
  return [
    "Complete this coding mock interview with a concise debrief report.",
    formatSessionFacts({
      problem: input.problem,
      dossier: input.dossier,
      language: input.language,
      responseLanguage: input.responseLanguage,
      durationMinutes: 25,
      questionCount: 10,
      maxQuestions: 10,
      currentPhase: "wrap_up",
      legalPhases: ["wrap_up"],
    }),
    "Transcript:",
    formatTranscript(input.transcript),
    "Latest code snapshot:",
    input.latestCode ? fenced(input.latestCode, input.language) : "No code snapshot.",
    "Latest run evidence:",
    input.latestRunResult
      ? JSON.stringify(summarizeRunResult(input.latestRunResult), null, 2)
      : "No run evidence.",
    "Latest run verdict:",
    input.latestRunVerdict
      ? JSON.stringify(input.latestRunVerdict, null, 2)
      : "No evidence verdict.",
    "",
    "Visible report markdown must use these sections:",
    "## Verdict",
    "## Strong Signals",
    "## Concerns",
    "## Follow-up Questions You Missed",
    "## Code And Debugging Notes",
    "## Recommended Drills",
    "",
    `After the visible markdown, write ${INTERVIEW_REPORT_JSON_SENTINEL} and one JSON object with:`,
    [
      "{",
      '  "verdict": "short sentence",',
      '  "overallSignal": "strong|acceptable|needs_work|risky",',
      '  "scores": {"communication":0.5,"problemDecomposition":0.5,"correctness":0.5,"complexityReasoning":0.5,"debuggingWithEvidence":0.5,"codeQuality":0.5},',
      '  "strengths": ["..."],',
      '  "concerns": ["..."],',
      '  "missedFollowUps": ["..."],',
      '  "codeNotes": ["..."],',
      '  "recommendations": [{"tag":"binary_search","reason":"...","problemSlug":"search-insert-position"}],',
      '  "memoryUpdateCandidate": {"facts":[{"factType":"mistake","tag":"binary_search_boundary","label":"Binary search boundary","confidence":0.7,"evidenceSummary":"..."}],"summary":"..."}',
      "}",
    ].join("\n"),
  ].join("\n");
}

function formatSessionFacts(input: Pick<
  InterviewerTurnInput,
  | "problem"
  | "dossier"
  | "language"
  | "responseLanguage"
  | "durationMinutes"
  | "questionCount"
  | "maxQuestions"
  | "currentPhase"
  | "legalPhases"
>) {
  return [
    `Problem: ${input.problem.leetcodeNumber ? `LC ${input.problem.leetcodeNumber} ` : ""}${input.problem.title} (${input.problem.slug})`,
    `Problem tags: ${input.problem.tags.join(", ") || "none"}`,
    `Difficulty: ${input.problem.difficulty ?? "unknown"}`,
    `Coding language: ${input.language}`,
    `Response language: ${input.responseLanguage}`,
    `Current phase: ${input.currentPhase}`,
    `Legal phases: ${input.legalPhases.join(", ")}`,
    `Question budget: ${input.questionCount}/${input.maxQuestions} counted interviewer questions`,
    `Time budget: ${input.durationMinutes} minutes`,
    `Target: ${input.dossier.targetLabel ?? "general coding screen"}`,
    `Focus tags: ${input.dossier.focusTags.join(", ") || "none"}`,
    `Strong signals: ${input.dossier.strongSignals.join(", ") || "none"}`,
    `Weak signals to probe: ${input.dossier.weakSignals.join(", ") || "none"}`,
    `Recent mistakes: ${input.dossier.recentMistakes.join(", ") || "none"}`,
    `Solved tags/problems: ${input.dossier.solvedTags.join(", ") || "none"}`,
    `Readiness goal: ${input.dossier.latestReadinessGoal ?? "none"}`,
  ].join("\n");
}

function formatTranscript(turns: Array<{ role: string; phase: string; contentMarkdown: string }>) {
  if (turns.length === 0) {
    return "No prior transcript.";
  }

  return turns
    .map((turn) => `[${turn.phase}] ${turn.role}: ${turn.contentMarkdown}`)
    .join("\n\n");
}

function fenced(code: string, language: string) {
  const fence = language === "C++" ? "cpp" : "python";
  return ["```" + fence, code.slice(0, 8000), "```"].join("\n");
}

function summarizeRunResult(result: {
  status: string;
  passedCount: number;
  failedCount: number;
  stdout: string;
  stderr: string;
  failureProvenance?: string;
  errorDetail?: unknown;
  actualOutput?: string;
  expectedOutput?: string;
  firstFailedCase?: unknown;
}) {
  return {
    status: result.status,
    passedCount: result.passedCount,
    failedCount: result.failedCount,
    stdout: result.stdout.slice(0, 1200),
    stderr: result.stderr.slice(0, 1200),
    failureProvenance: result.failureProvenance,
    errorDetail: result.errorDetail,
    actualOutput: result.actualOutput,
    expectedOutput: result.expectedOutput,
    firstFailedCase: result.firstFailedCase,
  };
}
