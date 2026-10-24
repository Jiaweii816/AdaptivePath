import type { CoachDiagnosis, CoachReviewDegradation } from "@/types/coach";
import type { CodeRunResult } from "@/types/code-runner";
import type { EvidenceVerdict } from "@/types/evidence";

export type WorkbenchLanguage = "Python" | "C++";

export type WorkbenchTraceTurnInfo = {
  workspaceSessionId: string;
  traceRunId: string;
  turnOrdinal: number;
};

export type WorkbenchProfile = {
  displayName: string;
  preferredLanguages: string[];
  strongPatterns: string[];
  weakPatterns: string[];
  outputPreferences: string[];
};

export type WorkbenchTestCase = {
  id: string;
  label: string;
  input: unknown;
  expected: unknown;
  source: "sample" | "custom" | string;
  expectedSource?: string;
  gtProvenance?: string | null;
  validationStatus?: string;
  metadata?: Record<string, unknown>;
  isVisible: boolean;
  sortOrder: number;
};

export type WorkbenchDraft = {
  id: string;
  language: WorkbenchLanguage;
  content: string;
  selectedTestCaseIds: string[];
};

export type WorkbenchEvidenceSource = "practice_run" | "review";

export type WorkbenchRunEvidence = {
  source: WorkbenchEvidenceSource;
  language: WorkbenchLanguage;
  selectedTestCaseIds: string[];
  runnerProvider: string;
  evidenceSource: string;
  evidenceVerdict?: EvidenceVerdict;
  runResult: CodeRunResult;
};

export type WorkbenchTeachableMemory = {
  sourceLabel: string;
  learnerSignalBasis: "earned_evidence" | "self_reported" | "saved_by_learner";
  applicability: string;
};

export type WorkbenchCoachMemoryBrief = {
  teachableMemories: WorkbenchTeachableMemory[];
};

export type WorkbenchProblem = {
  id: string;
  leetcodeNumber: number | null;
  slug: string;
  title: string;
  difficulty: string | null;
  hot150Order?: number | null;
  hot150Section?: string | null;
  officialUrl?: string | null;
  statementMarkdown: string;
  examples: Array<{
    input: unknown;
    output: unknown;
    explanation?: string;
  }>;
  constraints: string[];
  tags: string[];
  starterCode: Record<WorkbenchLanguage, string>;
  methodName: string;
  inputContract: unknown;
  outputContract: unknown;
  isDemoSupported: boolean;
  localRunStatus:
    "not_ready" | "runnable" | "harness_review" | "unsupported" | string;
  localRunStatusMessage?: string | null;
  comparisonStrategy?: string;
  comparisonConfig?: Record<string, unknown>;
  contractKind?: string;
  testCases: WorkbenchTestCase[];
  drafts: Partial<Record<WorkbenchLanguage, WorkbenchDraft>>;
};

export type WorkbenchReviewResult = {
  ok: true;
  problem: {
    id: string;
    slug: string;
    title: string;
  };
  chatSessionId: string;
  reviewAttemptId: string;
  problemHistoryId: string;
  runResult: CodeRunResult;
  evidence: WorkbenchRunEvidence;
  diagnosis: CoachDiagnosis;
  coachReply: string;
  memoryBrief?: WorkbenchCoachMemoryBrief;
  degraded?: CoachReviewDegradation;
  trace?: WorkbenchTraceTurnInfo;
};

export type WorkbenchPracticeRunResult = {
  ok: true;
  problem: {
    id: string;
    slug: string;
    title: string;
  };
  practiceRunLogId: string;
  runOrdinal: number;
  summary: string;
  runResult: CodeRunResult;
  evidence: WorkbenchRunEvidence;
  trace?: WorkbenchTraceTurnInfo;
};

export type WorkbenchChatResult = {
  ok: true;
  chatSessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  coachReply: string;
  actionOutcomes: WorkbenchActionOutcome[];
  toolTrace?: Array<{
    toolCallId: string;
    name: string;
    result: unknown;
  }>;
  toolIterations?: number;
  toolBudgetReached?: boolean;
  trace?: WorkbenchTraceTurnInfo;
};

export type WorkbenchActionOutcome = {
  toolName: "note_memory" | "save_knowledge_note" | "save_mistake_book_entry";
  displayName: string;
  status: "completed" | "failed" | "unfulfilled";
  message: string;
  recordId?: string;
  reason?: string;
};

export type WorkbenchClearChatResult = {
  ok: true;
  chatSessionId: string | null;
  clearedBeforeSequence: number;
  clearedAt: string | null;
  hiddenMessageCount: number;
};

export type WorkbenchHandbookCapture = {
  noteId: string;
  title: string;
  lookupCount: number;
};

export type WorkbenchMistakeBookCapture = {
  entryId: string;
  problemSlug: string;
  title: string;
  saveCount: number;
};

export type WorkbenchChatTurn =
  | {
      id?: string;
      role: "user" | "assistant";
      content: string;
      handbookCapture?: WorkbenchHandbookCapture;
      mistakeBookCapture?: WorkbenchMistakeBookCapture;
      actionOutcomes?: WorkbenchActionOutcome[];
    }
  | {
      id: string;
      role: "review";
      content: string;
      runResult: CodeRunResult;
      evidence?: WorkbenchRunEvidence;
      reviewAttemptId?: string;
      memoryBrief?: WorkbenchCoachMemoryBrief;
      degraded?: CoachReviewDegradation;
    };

export type WorkbenchSession = {
  chatSessionId: string;
  latestReview: WorkbenchReviewResult | null;
  chatTurns: WorkbenchChatTurn[];
};
