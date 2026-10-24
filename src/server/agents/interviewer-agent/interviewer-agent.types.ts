import type { CodeRunnerLanguage, CodeRunResult } from "@/types/code-runner";
import type { EvidenceVerdict } from "@/types/evidence";
import type { TraceContext } from "@/server/llm/trace-context";
import type {
  MockInterviewPhase,
  MockInterviewReport,
  MockInterviewScores,
} from "@/types/mock-interview";

export type InterviewProblemContext = {
  id: string;
  slug: string;
  title: string;
  leetcodeNumber: number | null;
  difficulty: string | null;
  tags: string[];
  statementMarkdown?: string;
};

export type InterviewDossier = {
  displayName: string;
  targetLabel?: string;
  focusTags: string[];
  strongSignals: string[];
  weakSignals: string[];
  recentMistakes: string[];
  solvedTags: string[];
  latestReadinessGoal?: string;
  languagePreference: "zh" | "en";
};

export type InterviewTranscriptTurn = {
  role: "interviewer" | "candidate" | "system";
  phase: MockInterviewPhase;
  contentMarkdown: string;
};

export type InterviewerTurnInput = {
  sessionId: string;
  problem: InterviewProblemContext;
  dossier: InterviewDossier;
  transcript: InterviewTranscriptTurn[];
  currentPhase: MockInterviewPhase;
  legalPhases: MockInterviewPhase[];
  questionCount: number;
  maxQuestions: number;
  durationMinutes: number;
  elapsedMinutes: number;
  language: CodeRunnerLanguage;
  latestCode?: string;
  latestRunResult?: CodeRunResult;
  latestRunVerdict?: EvidenceVerdict;
  responseLanguage: "zh" | "en";
  traceContext?: TraceContext;
};

export type InterviewerStartInput = Omit<
  InterviewerTurnInput,
  "transcript" | "currentPhase" | "legalPhases" | "questionCount" | "elapsedMinutes"
>;

export type InterviewerTurnResult = {
  messageMarkdown: string;
  proposedPhase: MockInterviewPhase | "stay";
  questionAsked: boolean;
};

export type InterviewerReportInput = {
  sessionId: string;
  problem: InterviewProblemContext;
  dossier: InterviewDossier;
  transcript: InterviewTranscriptTurn[];
  language: CodeRunnerLanguage;
  latestCode?: string;
  latestRunResult?: CodeRunResult;
  latestRunVerdict?: EvidenceVerdict;
  responseLanguage: "zh" | "en";
  traceContext?: TraceContext;
};

export type InterviewerReportResult = {
  reportMarkdown: string;
  report: MockInterviewReport;
};

export type InterviewerProvider = {
  start(input: InterviewerStartInput): Promise<InterviewerTurnResult>;
  continue(input: InterviewerTurnInput): Promise<InterviewerTurnResult>;
  discussCode(input: InterviewerTurnInput): Promise<InterviewerTurnResult>;
  complete(input: InterviewerReportInput): Promise<InterviewerReportResult>;
};

export const DEFAULT_INTERVIEW_SCORES: MockInterviewScores = {
  communication: 0.5,
  problemDecomposition: 0.5,
  correctness: 0.5,
  complexityReasoning: 0.5,
  debuggingWithEvidence: 0.5,
  codeQuality: 0.5,
};
