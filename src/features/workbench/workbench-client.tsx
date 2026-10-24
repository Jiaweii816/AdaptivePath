"use client";

import { bffErrorMessage } from "./bff-errors";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripHorizontal,
  GripVertical,
  Loader2,
  Maximize2,
  Minimize2,
  NotebookPen,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { CoachMarkdown } from "@/components/coach/coach-markdown";
import { ActionOutcomeCard } from "@/features/workbench/action-outcome-card";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/layout/sidebar";
import { CodeDraftEditor } from "@/components/workbench/code-draft-editor";
import { ProblemStatement } from "@/components/workbench/problem-statement";
import {
  markReviewReplyRevealed,
  shouldMaskReviewReply,
} from "@/components/workbench/review-reply-mask";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getCodeRunErrorDetail } from "@/lib/code-run-error-detail";
import { cn } from "@/lib/utils";
import {
  endCurrentRuntimeTraceSession,
  useCurrentRuntimeTrace,
  useRuntimeTraceEventFilter,
  useRuntimeTraceHistory,
  useRuntimeTraceSessionDetail,
} from "@/features/runtime-trace";
import {
  filterTraceEvents,
  RuntimeTraceCapsule,
  RuntimeTraceDrawer,
  RuntimeTraceHistoryList,
  RuntimeTraceMetricsView,
  RuntimeTraceRawView,
  RuntimeTraceTimeline,
  type RuntimeTraceDrawerView,
  type RuntimeTraceSessionMode,
} from "@/features/runtime-trace/components";
import {
  buildRuntimeTraceSummary,
  filterRuntimeTraceEventsForDisplay,
  toRuntimeTraceHistorySession,
  toRuntimeTraceMetricsEvents,
  toRuntimeTraceMetricsRuns,
  toRuntimeTraceRawEvents,
  toRuntimeTraceSessionOption,
  toRuntimeTraceSessionViewModel,
  toRuntimeTraceTimelineEvents,
  toRuntimeTraceTimelineRuns,
} from "@/features/runtime-trace/runtime-trace-workbench-adapter";
import type {
  CodeRunErrorLocation,
  CodeRunResult,
  CodeRunTestResult,
  CodeRunTestStatus,
} from "@/types/code-runner";
import {
  createCustomTestCase,
  loadWorkbenchProblemBySlug,
  saveDraftState,
} from "./actions";
import {
  buildWorkbenchHref,
  writeLastWorkbenchContext,
} from "./workbench-context";
import {
  createDraftSaveCoordinator,
  type DraftSaveAttemptResult,
} from "./draft-save-liveness";
import { useActiveTimer } from "./use-active-timer";
import { getOrCreateBrowserInstanceId } from "./browser-instance";
import { resolveProblemInput } from "./problem-resolver";
import { readReviewStream } from "./review-stream";
import type {
  WorkbenchChatResult,
  WorkbenchChatTurn,
  WorkbenchClearChatResult,
  WorkbenchCoachMemoryBrief,
  WorkbenchHandbookCapture,
  WorkbenchLanguage,
  WorkbenchMistakeBookCapture,
  WorkbenchPracticeRunResult,
  WorkbenchProblem,
  WorkbenchProfile,
  WorkbenchRunEvidence,
  WorkbenchSession,
  WorkbenchTestCase,
} from "./types";
import type { CampaignWorkbenchContextView } from "@/server/campaign";
import { WorkbenchCampaignBanner } from "@/features/campaign/workbench-campaign-banner";
import {
  actualOutputText,
  deriveTestcaseStatus,
  formatCapturedOutput,
  formatOutputDiff,
  formatTestcaseStreamOutput,
  hasActualOutput,
  isErrorStatus,
  runEvidenceTotal,
  testcaseStatusLabel,
} from "./run-evidence-ui";

type WorkbenchClientProps = {
  initialProblems: WorkbenchProblem[];
  profile: WorkbenchProfile;
  hasLeetCodeSession: boolean;
  initialLanguage?: WorkbenchLanguage;
  initialPlanItemId?: string;
  initialProblemSlug?: string;
  initialSession?: WorkbenchSession | null;
  traceUiEnabled: boolean;
  campaignContext?: CampaignWorkbenchContextView | null;
};

type ReviewPhase = "judge" | "coach" | null;

type DraftSaveStateInput = Parameters<typeof saveDraftState>[0];

const autosaveDraftTimeoutMs = 4_000;
const foregroundDraftTimeoutMs = 2_500;

type DraftShadow = {
  content: string;
  selectedTestCaseIds: string[];
  savedAt: number;
};

const draftShadowStoragePrefix = "patterncoach.workbenchDraft.v1";

function readHandbookCapture(
  toolTrace: WorkbenchChatResult["toolTrace"],
): WorkbenchHandbookCapture | undefined {
  const entry = toolTrace?.find(
    (trace) => trace.name === "save_knowledge_note",
  );
  const result = entry?.result as
    | {
        saved?: boolean;
        noteId?: string | null;
        title?: string;
        lookupCount?: number;
      }
    | undefined;
  if (!result?.saved || !result.noteId) {
    return undefined;
  }
  return {
    noteId: result.noteId,
    title: result.title ?? "Knowledge note",
    lookupCount: result.lookupCount ?? 1,
  };
}

function readMistakeBookCapture(
  toolTrace: WorkbenchChatResult["toolTrace"],
): WorkbenchMistakeBookCapture | undefined {
  const entry = toolTrace?.find(
    (trace) => trace.name === "save_mistake_book_entry",
  );
  const result = entry?.result as
    | {
        saved?: boolean;
        entryId?: string | null;
        problemSlug?: string;
        title?: string;
        saveCount?: number;
      }
    | undefined;
  if (!result?.saved || !result.entryId || !result.problemSlug) {
    return undefined;
  }
  return {
    entryId: result.entryId,
    problemSlug: result.problemSlug,
    title: result.title ?? "Mistake Book entry",
    saveCount: result.saveCount ?? 1,
  };
}

type NotePosition = {
  x: number;
  y: number;
};

type ActiveResizeHandle = "problem" | "coach" | "codeTest" | null;

const notesStorageKey = "patterncoach:floating-notes:v1";
const notesPositionStorageKey = "patterncoach:floating-notes-position:v1";
const lcReviewConfirmationStorageKey =
  "patterncoach:leetcode-review-confirmed:v1";
const collapsedPanelWidth = 48;
const defaultProblemPanelWidth = 380;
const defaultCoachPanelWidth = 390;
const minProblemPanelWidth = 280;
const maxProblemPanelWidth = 640;
const minCoachPanelWidth = 300;
const minEditorPanelWidth = 420;
const resizeHandleWidth = 16;
const defaultCodePanelHeightPercent = 68;
const minCodeTestSplitPercent = 38;
const maxCodeTestSplitPercent = 82;
const minCodePanelHeight = 320;
const minTestPanelHeight = 220;
const codeTestResizeHandleHeight = 12;
const codeTestResizeKeyboardStep = 4;

const defaultNotes = [
  "- deque: use popleft",
  "- Store current element before checking only when the logic needs it",
  "- Sliding window: expand right, then shrink left",
].join("\n");

type ExecutionMode = {
  kind: "leetcode" | "local_hot150" | "piston_fallback" | "blocked";
  canReview: boolean;
  canRun: boolean;
  label: string;
  description: string;
  reviewDescription: string;
  reviewKind: "leetcode" | "local_demo" | "blocked";
  runDescription: string;
};

export function executionModeFor(
  problem: WorkbenchProblem,
  hasLeetCodeSession: boolean,
  language: WorkbenchLanguage,
): ExecutionMode {
  if (problem.isDemoSupported) {
    return {
      kind: "piston_fallback",
      canReview: true,
      canRun: true,
      label: "Local demo runner",
      description:
        "Run uses local sample/custom visible tests. Review My Code creates a persisted Coach review.",
      reviewDescription: hasLeetCodeSession
        ? "Review My Code uses configured LeetCode judge evidence; if that service is unavailable, eligible local visible tests are labeled local-only."
        : "Review My Code uses the local demo adapter evidence.",
      reviewKind: hasLeetCodeSession ? "leetcode" : "local_demo",
      runDescription:
        "Run uses local sample/custom visible tests through Piston and does not submit to LeetCode.",
    };
  }

  if (problem.localRunStatus === "runnable") {
    const canRun = language === "Python";

    return {
      kind: "local_hot150",
      canReview: hasLeetCodeSession,
      canRun,
      label: "Local Hot-150 Run",
      description: canRun
        ? "Run uses local Hot-150 visible tests with reference-solution-generated expected outputs. Review prefers remote judge evidence and labels eligible fallback as local-only."
        : "C++ local Run is not supported yet for this Hot-150 problem. Switch to Python or open the official problem.",
      reviewDescription: hasLeetCodeSession
        ? "Review My Code uses configured LeetCode judge evidence; if that service is unavailable, eligible Python local visible tests are labeled local-only."
        : "Review My Code requires the remote judge for non-demo problems in this pass.",
      reviewKind: hasLeetCodeSession ? "leetcode" : "blocked",
      runDescription: canRun
        ? "Run uses local Hot-150 visible tests through Piston. It does not submit to LeetCode or guarantee official acceptance."
        : "C++ local Run is not supported yet for this problem; use Python or open the official problem.",
    };
  }

  return {
    kind: "blocked",
    canReview: hasLeetCodeSession,
    canRun: false,
    label:
      problem.localRunStatus === "harness_review"
        ? "Local Run needs harness review"
        : "Local Run not generated",
    description:
      problem.localRunStatusMessage ??
      "Local Run is not generated yet for this Hot-150 problem.",
    reviewDescription: hasLeetCodeSession
      ? "Review My Code uses the configured LeetCode judge evidence."
      : "Review My Code requires the remote judge for non-demo problems in this pass.",
    reviewKind: hasLeetCodeSession ? "leetcode" : "blocked",
    runDescription:
      problem.localRunStatusMessage ??
      "Local Run is not generated yet for this Hot-150 problem.",
  };
}

function selectedIdsFor(
  problem: WorkbenchProblem,
  language: WorkbenchLanguage,
) {
  const draftIds =
    readDraftShadow(problem.id, language)?.selectedTestCaseIds ??
    problem.drafts[language]?.selectedTestCaseIds ??
    [];
  const visibleIds = new Set(problem.testCases.map((testCase) => testCase.id));
  const validDraftIds = draftIds.filter((id) => visibleIds.has(id));

  if (validDraftIds.length > 0) {
    return validDraftIds;
  }

  return problem.testCases.map((testCase) => testCase.id);
}

function codeFor(problem: WorkbenchProblem, language: WorkbenchLanguage) {
  const draftShadow = readDraftShadow(problem.id, language);

  if (draftShadow) {
    return draftShadow.content;
  }

  const starterCode = problem.starterCode[language] ?? "";
  const draftContent = problem.drafts[language]?.content;

  if (draftContent === undefined) {
    return starterCode;
  }

  if (!draftContent.trim() && starterCode.trim()) {
    return starterCode;
  }

  return draftContent;
}

function draftShadowStorageKey(problemId: string, language: WorkbenchLanguage) {
  return `${draftShadowStoragePrefix}:${problemId}:${language}`;
}

function readDraftShadow(
  problemId: string,
  language: WorkbenchLanguage,
): DraftShadow | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(
      draftShadowStorageKey(problemId, language),
    );

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<DraftShadow>;

    if (
      typeof parsed.content !== "string" ||
      !Array.isArray(parsed.selectedTestCaseIds)
    ) {
      return null;
    }

    return {
      content: parsed.content,
      selectedTestCaseIds: parsed.selectedTestCaseIds.filter(
        (id): id is string => typeof id === "string",
      ),
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeDraftShadow(input: {
  content: string;
  language: WorkbenchLanguage;
  problemId: string;
  selectedTestCaseIds: string[];
}) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      draftShadowStorageKey(input.problemId, input.language),
      JSON.stringify({
        content: input.content,
        selectedTestCaseIds: input.selectedTestCaseIds,
        savedAt: Date.now(),
      } satisfies DraftShadow),
    );
  } catch {
    // Local draft shadow is a best-effort guard for navigation restores.
  }
}

function workbenchHrefForContext({
  language,
  planItemId,
  problemSlug,
}: {
  language: WorkbenchLanguage;
  planItemId?: string | null;
  problemSlug: string;
}) {
  return buildWorkbenchHref({ language, planItemId, problemSlug });
}

export function errorHighlightForRunResult(
  result: CodeRunResult,
  codeSnapshot: string,
): CodeRunErrorLocation | null {
  const location = result.errorLocation;

  if (!location) {
    return null;
  }

  const lineCount = Math.max(1, codeSnapshot.split(/\r\n|\r|\n/).length);

  if (location.line < 1 || location.line > lineCount) {
    return null;
  }

  return {
    ...location,
    message:
      location.message ??
      result.firstFailedCase?.error ??
      result.stderr ??
      runStatusLabel(result.status),
  };
}

function compactValue(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return compactValue(value);
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key}=${compactValue(entry)}`)
    .join(", ");
}

function formatGtProvenance(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value === "ac_solution") {
    return "reference solution";
  }

  return value.replaceAll("_", " ");
}

function problemLabel(problem: WorkbenchProblem) {
  return problem.leetcodeNumber
    ? `LC${problem.leetcodeNumber} · ${problem.title}`
    : problem.title;
}

function runSummary(result: CodeRunResult | null) {
  if (!result) {
    return "No run yet";
  }

  if (result.status === "runner_error") {
    return "Execution service unavailable";
  }

  const total = result.passedCount + result.failedCount;
  return `${result.passedCount}/${total} passed · ${result.durationMs ?? 0}ms`;
}

function runEvidenceSummary(evidence: WorkbenchRunEvidence | null) {
  if (!evidence) {
    return "No run evidence yet";
  }

  const { runResult } = evidence;
  const total = runEvidenceTotal({
    result: runResult,
    selectedTestCaseIds: evidence.selectedTestCaseIds,
  });
  const errorCount =
    runResult.status === "compile_error" ||
    runResult.status === "syntax_error" ||
    runResult.status === "runtime_error" ||
    runResult.status === "timeout" ||
    runResult.status === "runner_error" ||
    runResult.status === "unsupported_language"
      ? Math.max(1, runResult.failedCount)
      : 0;
  const parts = [
    `${runResult.passedCount} / ${total} passed`,
    `${runResult.failedCount} failed`,
    `${errorCount} errors`,
    `${runResult.durationMs ?? 0}ms`,
    evidence.language,
    evidence.runnerProvider,
    evidence.evidenceSource,
  ];
  const scopeLabel = evidence.evidenceVerdict?.scopeLabel;

  if (scopeLabel && scopeLabel !== evidence.evidenceSource) {
    parts.push(scopeLabel);
  }

  return parts.join(" · ");
}

function runStatusLabel(status: CodeRunResult["status"]) {
  switch (status) {
    case "passed_visible_tests":
      return "Passed";
    case "failed":
      return "Wrong answer";
    case "compile_error":
      return "Compile error";
    case "syntax_error":
      return "Syntax error";
    case "runtime_error":
      return "Runtime error";
    case "timeout":
      return "Timeout";
    case "runner_error":
      return "Unavailable";
    case "empty_code":
      return "Needs code";
    case "no_tests":
      return "Needs tests";
    case "unsupported_language":
      return "Unsupported";
  }
}

function evidenceActionLabel(source: WorkbenchRunEvidence["source"]) {
  return source === "practice_run" ? "Local Run" : "Review My Code";
}

function testcaseStatusToneClassName(status: CodeRunTestStatus) {
  switch (status) {
    case "passed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "runtime_error":
    case "compile_error":
    case "timeout":
    case "internal_error":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "running":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "not_run":
      return "border-border bg-muted/35 text-muted-foreground";
  }
}

function statusDotClassName(status: CodeRunTestStatus) {
  switch (status) {
    case "passed":
      return "bg-emerald-500";
    case "failed":
      return "bg-rose-500";
    case "runtime_error":
    case "compile_error":
    case "timeout":
    case "internal_error":
      return "bg-amber-500";
    case "running":
      return "bg-blue-500";
    case "not_run":
      return "bg-muted-foreground/35";
  }
}

function runStatusToneClassName(status: CodeRunResult["status"]) {
  if (status === "passed_visible_tests") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    status === "runner_error" ||
    status === "empty_code" ||
    status === "no_tests" ||
    status === "unsupported_language"
  ) {
    return "border-border bg-muted/40 text-muted-foreground";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

function readJudgeFirstFailedOrdinal(result: CodeRunResult) {
  if (!result.rawResult || typeof result.rawResult !== "object") {
    return undefined;
  }

  const raw = result.rawResult as Record<string, unknown>;
  const evidence = raw.judgeEvidence;

  if (!evidence || typeof evidence !== "object") {
    return undefined;
  }

  const ordinal = (evidence as Record<string, unknown>).firstFailedOrdinal;

  return typeof ordinal === "number" && Number.isFinite(ordinal)
    ? ordinal
    : undefined;
}

function readRunProvider(result: CodeRunResult | null) {
  if (!result?.rawResult || typeof result.rawResult !== "object") {
    return undefined;
  }

  const providerUsed = (result.rawResult as Record<string, unknown>)
    .providerUsed;

  return typeof providerUsed === "string" ? providerUsed : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function codeTestSplitBounds(containerHeight: number) {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return {
      min: minCodeTestSplitPercent,
      max: maxCodeTestSplitPercent,
    };
  }

  const dynamicMin = Math.max(
    minCodeTestSplitPercent,
    (minCodePanelHeight / containerHeight) * 100,
  );
  const dynamicMax = Math.min(
    maxCodeTestSplitPercent,
    ((containerHeight - minTestPanelHeight - codeTestResizeHandleHeight) /
      containerHeight) *
      100,
  );

  if (dynamicMax >= dynamicMin) {
    return {
      min: dynamicMin,
      max: dynamicMax,
    };
  }

  const fallback = clamp(
    defaultCodePanelHeightPercent,
    minCodeTestSplitPercent,
    maxCodeTestSplitPercent,
  );

  return {
    min: Math.min(dynamicMin, fallback),
    max: Math.max(dynamicMax, fallback),
  };
}

async function readApiJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(
      `${label} returned an unexpected response. Check the dev server logs and try again.`,
    );
  }
  const message = bffErrorMessage(data);
  if (message) throw new Error(message);
  return data;
}

function draftSaveStatusText(result: DraftSaveAttemptResult) {
  if (result.ok) {
    return "Draft saved";
  }
  return result.status === "timed_out"
    ? "Draft save delayed"
    : "Draft save failed";
}

function draftSaveIssueText(result: DraftSaveAttemptResult) {
  if (result.ok) {
    return null;
  }

  if (result.status === "timed_out") {
    return result.saveStarted
      ? "Draft save is taking longer than expected."
      : "A previous draft save is still pending.";
  }

  return `Draft save failed: ${result.error.message}`;
}

function blockingDraftSaveError(result: DraftSaveAttemptResult) {
  const issue = draftSaveIssueText(result);
  return issue ? `${issue} Please retry the action.` : null;
}

function CompactMarkdown({ markdown }: { markdown: string }) {
  return <CoachMarkdown markdown={markdown} />;
}

export function WorkbenchClient({
  campaignContext,
  hasLeetCodeSession,
  initialLanguage,
  initialProblems,
  initialPlanItemId,
  initialProblemSlug,
  initialSession,
  profile,
  traceUiEnabled,
}: WorkbenchClientProps) {
  const router = useRouter();
  const [problems, setProblems] = useState(initialProblems);
  const [selectedProblemId, setSelectedProblemId] = useState(
    (initialProblemSlug &&
      initialProblems.find((problem) => problem.slug === initialProblemSlug)
        ?.id) ||
      initialProblems[0]?.id ||
      "",
  );
  const defaultLanguage: WorkbenchLanguage =
    initialLanguage ??
    (profile.preferredLanguages.includes("Python") ? "Python" : "C++");
  const [language, setLanguage] = useState<WorkbenchLanguage>(defaultLanguage);
  const selectedProblem =
    problems.find((problem) => problem.id === selectedProblemId) ?? problems[0];
  const { getActiveSeconds, resetActiveTimer } = useActiveTimer(
    selectedProblem?.id ?? "no-problem",
  );
  const [code, setCode] = useState(() =>
    selectedProblem ? codeFor(selectedProblem, language) : "",
  );
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>(() =>
    selectedProblem ? selectedIdsFor(selectedProblem, language) : [],
  );
  const [query, setQuery] = useState("");
  const [resolutionMessage, setResolutionMessage] = useState<string | null>(
    null,
  );
  const [isProblemPanelCollapsed, setIsProblemPanelCollapsed] = useState(false);
  const [isCoachPanelCollapsed, setIsCoachPanelCollapsed] = useState(false);
  const [problemPanelWidth, setProblemPanelWidth] = useState(
    defaultProblemPanelWidth,
  );
  const [coachPanelWidth, setCoachPanelWidth] = useState(
    defaultCoachPanelWidth,
  );
  const [codePanelHeightPercent, setCodePanelHeightPercent] = useState(
    defaultCodePanelHeightPercent,
  );
  const [activeResizeHandle, setActiveResizeHandle] =
    useState<ActiveResizeHandle>(null);
  const [expandedTestIds, setExpandedTestIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isCustomTestOpen, setIsCustomTestOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [latestEvidence, setLatestEvidence] =
    useState<WorkbenchRunEvidence | null>(
      initialSession?.latestReview?.evidence ?? null,
    );
  const [editorErrorHighlight, setEditorErrorHighlight] =
    useState<CodeRunErrorLocation | null>(null);
  const [practiceRunSummary, setPracticeRunSummary] = useState<string | null>(
    null,
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewPhase, setReviewPhase] = useState<ReviewPhase>(null);
  const [isLcReviewConfirmed, setIsLcReviewConfirmed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(lcReviewConfirmationStorageKey) === "1",
  );
  const [isLcConfirmOpen, setIsLcConfirmOpen] = useState(false);
  const [isResetDraftOpen, setIsResetDraftOpen] = useState(false);
  const [isResettingDraft, setIsResettingDraft] = useState(false);
  const [isClearChatOpen, setIsClearChatOpen] = useState(false);
  const [clearChatError, setClearChatError] = useState<string | null>(null);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [isResolvingProblem, setIsResolvingProblem] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatTurns, setChatTurns] = useState<WorkbenchChatTurn[]>(
    initialSession?.chatTurns ?? [],
  );
  const [newlyCreatedReviewAttemptId, setNewlyCreatedReviewAttemptId] =
    useState<string | null>(null);
  const [revealedReviewAttemptIds, setRevealedReviewAttemptIds] = useState<
    Set<string>
  >(() => new Set());
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(
    initialSession?.chatSessionId ??
      initialSession?.latestReview?.chatSessionId ??
      null,
  );
  const [activePlanItemId, setActivePlanItemId] = useState<string | null>(
    initialPlanItemId ?? null,
  );
  const [pendingPlannerOutcome, setPendingPlannerOutcome] = useState<{
    planItemId?: string;
    problemHistoryId: string;
    reviewAttemptId: string;
  } | null>(null);
  const [plannerOutcomeError, setPlannerOutcomeError] = useState<string | null>(
    null,
  );
  const [isRecordingPlannerOutcome, setIsRecordingPlannerOutcome] =
    useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);
  const [isChatting, setIsChatting] = useState(false);
  const [saveMessage, setSaveMessage] = useState("Draft ready");
  const [traceBrowserInstanceId] = useState<string | null>(() =>
    traceUiEnabled ? (getOrCreateBrowserInstanceId() ?? null) : null,
  );
  const [isTraceDrawerOpen, setIsTraceDrawerOpen] = useState(false);
  const [traceSessionMode, setTraceSessionMode] =
    useState<RuntimeTraceSessionMode>("current");
  const [traceDrawerView, setTraceDrawerView] =
    useState<RuntimeTraceDrawerView>("timeline");
  const [selectedTraceHistorySessionId, setSelectedTraceHistorySessionId] =
    useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const layoutRef = useRef<HTMLElement | null>(null);
  const codeTestPanelRef = useRef<HTMLElement | null>(null);
  const draftSaveCoordinatorRef = useRef(
    createDraftSaveCoordinator<DraftSaveStateInput>(saveDraftState),
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedPlanItemRef = useRef<string | null>(null);
  const resizeOriginRef = useRef({
    startX: 0,
    startY: 0,
    problemWidth: defaultProblemPanelWidth,
    coachWidth: defaultCoachPanelWidth,
    codePanelHeightPercent: defaultCodePanelHeightPercent,
  });

  const currentRuntimeTrace = useCurrentRuntimeTrace({
    enabled: traceUiEnabled,
    open: isTraceDrawerOpen,
    keepAliveWhenEmpty: isRunning || isReviewing || isChatting,
    browserInstanceId: traceBrowserInstanceId,
    problemId: selectedProblem?.id ?? null,
  });
  const refreshCurrentRuntimeTrace = currentRuntimeTrace.refresh;
  const runtimeTraceHistory = useRuntimeTraceHistory({
    enabled: traceUiEnabled,
    open: isTraceDrawerOpen && traceSessionMode === "history",
  });
  const historicalRuntimeTrace = useRuntimeTraceSessionDetail({
    enabled: traceUiEnabled,
    open:
      isTraceDrawerOpen &&
      traceSessionMode === "history" &&
      Boolean(selectedTraceHistorySessionId),
    sessionId: selectedTraceHistorySessionId,
  });
  const visibleRuntimeTrace =
    traceSessionMode === "history"
      ? selectedTraceHistorySessionId
        ? historicalRuntimeTrace
        : null
      : currentRuntimeTrace;
  const runtimeTraceSessionView = toRuntimeTraceSessionViewModel(
    visibleRuntimeTrace?.session ?? null,
  );
  const runtimeTraceTimelineRuns = toRuntimeTraceTimelineRuns(
    visibleRuntimeTrace?.runs ?? [],
  );
  const runtimeTraceDisplayEvents = filterRuntimeTraceEventsForDisplay(
    visibleRuntimeTrace?.events ?? [],
  );
  const runtimeTraceTimelineEvents = toRuntimeTraceTimelineEvents(
    runtimeTraceDisplayEvents,
  );
  const runtimeTraceEventFilter = useRuntimeTraceEventFilter();
  const runtimeTraceFilteredTimelineEvents = filterTraceEvents(
    runtimeTraceTimelineEvents,
    { kinds: runtimeTraceEventFilter.kinds, query: runtimeTraceEventFilter.query },
  );
  const runtimeTraceMetricsRuns = toRuntimeTraceMetricsRuns(
    visibleRuntimeTrace?.runs ?? [],
  );
  const runtimeTraceMetricsEvents = toRuntimeTraceMetricsEvents(
    runtimeTraceDisplayEvents,
  );
  const runtimeTraceRawEvents = toRuntimeTraceRawEvents(
    runtimeTraceDisplayEvents,
  );
  const runtimeTraceSummary = visibleRuntimeTrace
    ? buildRuntimeTraceSummary({
        ...visibleRuntimeTrace,
        events: runtimeTraceDisplayEvents,
      })
    : null;
  const closeRuntimeTraceSession = useCallback(
    async (
      reason: "problem_changed" | "workbench_navigation" | "explicit_exit",
    ) => {
      if (!traceUiEnabled || !traceBrowserInstanceId || !selectedProblem?.id) {
        return;
      }
      await endCurrentRuntimeTraceSession({
        browserInstanceId: traceBrowserInstanceId,
        problemId: selectedProblem.id,
        reason,
        keepalive: true,
      }).catch(() => undefined);
      refreshCurrentRuntimeTrace();
    },
    [
      refreshCurrentRuntimeTrace,
      selectedProblem,
      traceBrowserInstanceId,
      traceUiEnabled,
    ],
  );

  const saveDraftSnapshot = useCallback(
    async (
      input: DraftSaveStateInput,
      options: {
        label?: string;
        mode: "autosave" | "foreground";
        timeoutMs?: number;
      },
    ) => {
      return draftSaveCoordinatorRef.current.save(input, {
        label: options.label,
        mode: options.mode,
        timeoutMs:
          options.timeoutMs ??
          (options.mode === "autosave"
            ? autosaveDraftTimeoutMs
            : foregroundDraftTimeoutMs),
      });
    },
    [],
  );

  useEffect(() => {
    if (!traceUiEnabled || (!isRunning && !isReviewing && !isChatting)) {
      return;
    }
    refreshCurrentRuntimeTrace();
  }, [
    refreshCurrentRuntimeTrace,
    isChatting,
    isReviewing,
    isRunning,
    traceUiEnabled,
  ]);

  useEffect(() => {
    if (!activePlanItemId || startedPlanItemRef.current === activePlanItemId) {
      return;
    }

    startedPlanItemRef.current = activePlanItemId;
    void fetch("/api/planner/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planItemId: activePlanItemId }),
    }).catch(() => undefined);
  }, [activePlanItemId]);

  useEffect(() => {
    if (!selectedProblem || window.location.pathname !== "/workbench") {
      return;
    }

    const nextHref = workbenchHrefForContext({
      language,
      planItemId: activePlanItemId,
      problemSlug: selectedProblem.slug,
    });
    const currentHref = `${window.location.pathname}${window.location.search}`;

    writeLastWorkbenchContext({
      language,
      planItemId: activePlanItemId,
      problemSlug: selectedProblem.slug,
    });

    if (currentHref !== nextHref) {
      router.replace(nextHref, { scroll: false });
    }
  }, [activePlanItemId, language, router, selectedProblem]);

  useEffect(() => {
    if (!selectedProblem) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      startTransition(async () => {
        const saveResult = await saveDraftSnapshot(
          {
            problemId: selectedProblem.id,
            language,
            content: code,
            selectedTestCaseIds: selectedTestIds,
          },
          {
            label: "Workbench draft autosave",
            mode: "autosave",
          },
        );
        setSaveMessage(draftSaveStatusText(saveResult));
      });
    }, 450);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [code, language, saveDraftSnapshot, selectedProblem, selectedTestIds]);

  useEffect(() => {
    if (!activeResizeHandle) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor =
      activeResizeHandle === "codeTest" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      if (activeResizeHandle === "codeTest") {
        const containerHeight =
          codeTestPanelRef.current?.getBoundingClientRect().height ?? 0;
        const bounds = codeTestSplitBounds(containerHeight);
        const delta = event.clientY - resizeOriginRef.current.startY;
        const nextPercent =
          resizeOriginRef.current.codePanelHeightPercent +
          (delta / Math.max(containerHeight, 1)) * 100;

        setCodePanelHeightPercent(clamp(nextPercent, bounds.min, bounds.max));
        return;
      }

      const layoutWidth =
        layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const problemWidth = isProblemPanelCollapsed
        ? collapsedPanelWidth
        : resizeOriginRef.current.problemWidth;
      const coachWidth = isCoachPanelCollapsed
        ? collapsedPanelWidth
        : resizeOriginRef.current.coachWidth;
      const maxResizableWidth =
        layoutWidth -
        minEditorPanelWidth -
        resizeHandleWidth -
        resizeHandleWidth;
      const delta = event.clientX - resizeOriginRef.current.startX;

      if (activeResizeHandle === "problem") {
        const maxWidth = Math.max(
          minProblemPanelWidth,
          Math.min(maxProblemPanelWidth, maxResizableWidth - coachWidth),
        );
        setProblemPanelWidth(
          clamp(
            resizeOriginRef.current.problemWidth + delta,
            minProblemPanelWidth,
            maxWidth,
          ),
        );
        return;
      }

      const maxWidth = Math.max(
        minCoachPanelWidth,
        maxResizableWidth - problemWidth,
      );
      setCoachPanelWidth(
        clamp(
          resizeOriginRef.current.coachWidth - delta,
          minCoachPanelWidth,
          maxWidth,
        ),
      );
    };

    const handlePointerUp = () => setActiveResizeHandle(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [activeResizeHandle, isCoachPanelCollapsed, isProblemPanelCollapsed]);

  if (!selectedProblem) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <section className="max-w-xl rounded-md border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">Problems are not seeded yet</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Run the database migration and seed commands, then reopen the
            Workbench.
          </p>
        </section>
      </main>
    );
  }

  const executionMode = executionModeFor(
    selectedProblem,
    hasLeetCodeSession,
    language,
  );

  const saveCurrentDraftNow = async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    writeDraftShadow({
      problemId: selectedProblem.id,
      language,
      content: code,
      selectedTestCaseIds: selectedTestIds,
    });
    const saveResult = await saveDraftSnapshot(
      {
        problemId: selectedProblem.id,
        language,
        content: code,
        selectedTestCaseIds: selectedTestIds,
      },
      {
        label: "Workbench draft save",
        mode: "foreground",
      },
    );
    setSaveMessage(draftSaveStatusText(saveResult));
    const saveError = blockingDraftSaveError(saveResult);
    if (saveError) {
      throw new Error(saveError);
    }
  };

  const resetCurrentDraft = async () => {
    if (isResettingDraft || isRunning || isReviewing || isChatting) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const starterCode = selectedProblem.starterCode[language] ?? "";

    setIsResettingDraft(true);
    setSaveMessage("Resetting draft...");
    setCode(starterCode);
    writeDraftShadow({
      problemId: selectedProblem.id,
      language,
      content: starterCode,
      selectedTestCaseIds: selectedTestIds,
    });
    setEditorErrorHighlight(null);
    setLatestEvidence(null);
    setPracticeRunSummary(null);
    setRunError(null);
    setReviewError(null);
    setDraftWarning(null);
    setExpandedTestIds(new Set());

    try {
      const saveResult = await saveDraftSnapshot(
        {
          problemId: selectedProblem.id,
          language,
          content: starterCode,
          selectedTestCaseIds: selectedTestIds,
        },
        {
          label: "Reset workbench draft",
          mode: "foreground",
        },
      );
      setSaveMessage(draftSaveStatusText(saveResult));
      const saveError = blockingDraftSaveError(saveResult);
      if (saveError) {
        throw new Error(saveError);
      }

      setIsResetDraftOpen(false);
    } catch {
      // The reset remains in the editor and local shadow. The visible status
      // tells the learner that the durable draft save needs another attempt.
    } finally {
      setIsResettingDraft(false);
    }
  };

  const openHandbookFromWorkbench = async (href: string) => {
    try {
      setChatError(null);
      await saveCurrentDraftNow();
      await closeRuntimeTraceSession("workbench_navigation");
      router.replace(
        workbenchHrefForContext({
          language,
          planItemId: activePlanItemId,
          problemSlug: selectedProblem.slug,
        }),
        { scroll: false },
      );
      router.push(href);
    } catch (error) {
      setChatError(
        error instanceof Error
          ? `Failed to save the draft before opening the saved item: ${error.message}`
          : "Failed to save the draft before opening the saved item. Please try again.",
      );
    }
  };

  const selectProblem = (
    problem: WorkbenchProblem,
    options: { planItemId?: string | null } = {},
  ) => {
    if (selectedProblem?.id && selectedProblem.id !== problem.id) {
      void closeRuntimeTraceSession("problem_changed");
    }
    setSelectedProblemId(problem.id);
    setActivePlanItemId(options.planItemId ?? null);
    setCode(codeFor(problem, language));
    setSelectedTestIds(selectedIdsFor(problem, language));
    setLatestEvidence(null);
    setEditorErrorHighlight(null);
    setPracticeRunSummary(null);
    setRunError(null);
    setReviewError(null);
    setChatTurns([]);
    setChatInput("");
    setNewlyCreatedReviewAttemptId(null);
    setPendingPlannerOutcome(null);
    setPlannerOutcomeError(null);
    setActiveChatSessionId(null);
    setExpandedTestIds(new Set());
    setSaveMessage("Draft ready");
  };

  const resolveQuery = () => {
    const result = resolveProblemInput(query, problems);

    if (result.status !== "resolved") {
      setResolutionMessage(result.message);
      return;
    }

    setIsResolvingProblem(true);
    startTransition(async () => {
      try {
        let nextProblem = result.problem;

        if (hasLeetCodeSession && !nextProblem.statementMarkdown.trim()) {
          const loaded = await loadWorkbenchProblemBySlug(nextProblem.slug);
          nextProblem = loaded.problem;
          setProblems((current) =>
            current.map((problem) =>
              problem.slug === nextProblem.slug ? nextProblem : problem,
            ),
          );
        }

        selectProblem(nextProblem);
        setResolutionMessage(`${nextProblem.title} selected.`);
      } catch (error) {
        setResolutionMessage(
          error instanceof Error
            ? error.message
            : "Unable to load that problem.",
        );
      } finally {
        setIsResolvingProblem(false);
      }
    });
  };

  const updateSelectedTests = (testCaseId: string, checked: boolean) => {
    setSaveMessage("Saving draft...");
    setSelectedTestIds((current) => {
      const nextIds = checked
        ? Array.from(new Set([...current, testCaseId]))
        : current.filter((id) => id !== testCaseId);

      writeDraftShadow({
        problemId: selectedProblem.id,
        language,
        content: code,
        selectedTestCaseIds: nextIds,
      });

      return nextIds;
    });
  };

  const addCustomTest = () => {
    setCustomError(null);

    let parsedInput: unknown;
    let parsedExpected: unknown;

    try {
      parsedInput = JSON.parse(customInput);
      parsedExpected = JSON.parse(customExpected);
    } catch {
      setCustomError("Custom input and expected output must be valid JSON.");
      return;
    }

    startTransition(async () => {
      const result = await createCustomTestCase({
        problemId: selectedProblem.id,
        label: customLabel,
        input: parsedInput,
        expected: parsedExpected,
      });

      const nextTestCase = result.testCase;
      setProblems((current) =>
        current.map((problem) =>
          problem.id === selectedProblem.id
            ? {
                ...problem,
                testCases: [...problem.testCases, nextTestCase].sort(
                  (left, right) => left.sortOrder - right.sortOrder,
                ),
              }
            : problem,
        ),
      );
      setSelectedTestIds((current) => {
        const nextIds = Array.from(new Set([...current, nextTestCase.id]));

        writeDraftShadow({
          problemId: selectedProblem.id,
          language,
          content: code,
          selectedTestCaseIds: nextIds,
        });

        return nextIds;
      });
      setExpandedTestIds((current) => new Set([...current, nextTestCase.id]));
      setSaveMessage("Saving draft...");
      setCustomLabel("");
      setCustomInput("");
      setCustomExpected("");
      setIsCustomTestOpen(false);
    });
  };

  const runSelectedTests = async () => {
    if (!selectedProblem || isRunning) {
      return;
    }

    if (!executionMode.canRun) {
      setRunError(executionMode.runDescription);
      return;
    }

    setIsRunning(true);
    setRunError(null);
    setReviewError(null);
    setChatError(null);
    setDraftWarning(null);
    setPracticeRunSummary(null);
    setLatestEvidence(null);
    setEditorErrorHighlight(null);

    try {
      const saveResult = await saveDraftSnapshot(
        {
          problemId: selectedProblem.id,
          language,
          content: code,
          selectedTestCaseIds: selectedTestIds,
        },
        {
          label: "Run draft save",
          mode: "foreground",
        },
      );
      setSaveMessage(draftSaveStatusText(saveResult));
      const saveError = blockingDraftSaveError(saveResult);
      if (saveError) {
        throw new Error(saveError);
      }

      const response = await fetch("/api/workbench/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserInstanceId: getOrCreateBrowserInstanceId(),
          clientOccurredAt: new Date().toISOString(),
          problemId: selectedProblem.id,
          problemSlug: selectedProblem.slug,
          language,
          code,
          selectedTestCaseIds: selectedTestIds,
          activeSeconds: getActiveSeconds(),
          planItemId: activePlanItemId ?? undefined,
        }),
      });
      const data = await readApiJson<
        WorkbenchPracticeRunResult | { ok: false; error?: string }
      >(response, "Run");

      if (!response.ok || data.ok !== true) {
        throw new Error(
          ("error" in data ? data.error : undefined) ?? "Run failed.",
        );
      }

      setLatestEvidence(data.evidence);
      setEditorErrorHighlight(errorHighlightForRunResult(data.runResult, code));
      setPracticeRunSummary(data.summary);
      const failedCaseId = data.runResult.firstFailedCase?.id;
      const hasVisibleFailedCase =
        failedCaseId &&
        selectedProblem.testCases.some(
          (testCase) => testCase.id === failedCaseId,
        );

      setExpandedTestIds(
        hasVisibleFailedCase && failedCaseId
          ? new Set([failedCaseId])
          : new Set(),
      );
      setSaveMessage("Draft saved");
      resetActiveTimer();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Run failed.");
    } finally {
      setIsRunning(false);
    }
  };

  const runReview = async (options: { skipLcConfirm?: boolean } = {}) => {
    if (!selectedProblem || isReviewing) {
      return;
    }

    if (!executionMode.canReview) {
      setReviewError(executionMode.reviewDescription);
      return;
    }

    if (
      executionMode.reviewKind === "leetcode" &&
      !isLcReviewConfirmed &&
      !options.skipLcConfirm
    ) {
      setIsLcConfirmOpen(true);
      return;
    }

    setIsReviewing(true);
    setReviewPhase("judge");
    setReviewError(null);
    setChatError(null);
    setDraftWarning(null);
    setLatestEvidence(null);
    setEditorErrorHighlight(null);

    try {
      const saveResult = await saveDraftSnapshot(
        {
          problemId: selectedProblem.id,
          language,
          content: code,
          selectedTestCaseIds: selectedTestIds,
        },
        {
          label: "Review draft save",
          mode: "foreground",
        },
      );
      setSaveMessage(draftSaveStatusText(saveResult));
      const saveError = blockingDraftSaveError(saveResult);
      if (saveError) {
        throw new Error(saveError);
      }

      const response = await fetch("/api/coach/review", {
        method: "POST",
        headers: {
          Accept: "text/event-stream, application/x-ndjson",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          browserInstanceId: getOrCreateBrowserInstanceId(),
          clientOccurredAt: new Date().toISOString(),
          problemId: selectedProblem.id,
          problemSlug: selectedProblem.slug,
          language,
          code,
          selectedTestCaseIds: selectedTestIds,
          planItemId: activePlanItemId ?? undefined,
        }),
      });
      if (!response.ok) {
        const errorData = await readApiJson<{ error?: string }>(response, "Review");
        throw new Error(errorData.error ?? "Review failed.");
      }
      const data = await readReviewStream(response, (evidence) => {
        setLatestEvidence(evidence);
        setEditorErrorHighlight(errorHighlightForRunResult(evidence.runResult, code));
        setReviewPhase("coach");
      });

      if (data.ok !== true) throw new Error("Review failed.");

      setLatestEvidence(data.evidence);
      setEditorErrorHighlight(errorHighlightForRunResult(data.runResult, code));
      setPracticeRunSummary(null);
      setActiveChatSessionId(data.chatSessionId);
      setNewlyCreatedReviewAttemptId(data.reviewAttemptId);
      setPendingPlannerOutcome({
        planItemId: activePlanItemId ?? undefined,
        problemHistoryId: data.problemHistoryId,
        reviewAttemptId: data.reviewAttemptId,
      });
      setPlannerOutcomeError(null);
      setChatTurns((current) => [
        ...current,
        {
          id: data.reviewAttemptId,
          role: "review",
          content: data.coachReply,
          evidence: data.evidence,
          runResult: data.runResult,
          reviewAttemptId: data.reviewAttemptId,
          memoryBrief: data.memoryBrief,
          degraded: data.degraded,
        },
      ]);
      const failedCaseId = data.runResult.firstFailedCase?.id;
      const hasVisibleFailedCase =
        failedCaseId &&
        selectedProblem.testCases.some(
          (testCase) => testCase.id === failedCaseId,
        );

      setExpandedTestIds(
        hasVisibleFailedCase && failedCaseId
          ? new Set([failedCaseId])
          : new Set(),
      );
      setSaveMessage("Draft saved");
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Review failed.");
    } finally {
      setIsReviewing(false);
      setReviewPhase(null);
    }
  };

  const confirmLcReview = () => {
    window.localStorage.setItem(lcReviewConfirmationStorageKey, "1");
    setIsLcReviewConfirmed(true);
    setIsLcConfirmOpen(false);
    void runReview({ skipLcConfirm: true });
  };

  const recordPlannerOutcome = async (
    selfRating: "easy" | "hesitated" | "struggled" | "unsolved",
  ) => {
    if (!pendingPlannerOutcome || isRecordingPlannerOutcome) {
      return;
    }

    setIsRecordingPlannerOutcome(true);
    setPlannerOutcomeError(null);

    try {
      const response = await fetch("/api/planner/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pendingPlannerOutcome,
          selfRating,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
        redirectTo?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Unable to record readiness outcome.");
      }

      await closeRuntimeTraceSession("workbench_navigation");
      router.replace(data.redirectTo ?? "/campaign/today");
    } catch (error) {
      setPlannerOutcomeError(
        error instanceof Error
          ? error.message
          : "Unable to record readiness outcome.",
      );
    } finally {
      setIsRecordingPlannerOutcome(false);
    }
  };

  const sendChatMessage = async () => {
    const message = chatInput.trim();

    if (!message || isChatting) {
      return;
    }

    setIsChatting(true);
    setChatError(null);
    setDraftWarning(null);

    try {
      const saveResult = await saveDraftSnapshot(
        {
          problemId: selectedProblem.id,
          language,
          content: code,
          selectedTestCaseIds: selectedTestIds,
        },
        {
          label: "Coach chat draft save",
          mode: "foreground",
        },
      );
      setSaveMessage(draftSaveStatusText(saveResult));
      // Chat sends the current editor content in its request, even when the
      // asynchronous draft write is delayed. Keep the durable-save status in
      // the editor UI, but do not interrupt an interview conversation with a
      // transient persistence warning.

      const response = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserInstanceId: getOrCreateBrowserInstanceId(),
          clientOccurredAt: new Date().toISOString(),
          chatSessionId: activeChatSessionId ?? undefined,
          problemId: selectedProblem.id,
          problemSlug: selectedProblem.slug,
          message,
          language,
          code,
          selectedTestCaseIds: selectedTestIds,
        }),
      });
      const data = await readApiJson<
        WorkbenchChatResult | { ok: false; error?: string }
      >(response, "Coach chat");

      if (!response.ok || data.ok !== true) {
        throw new Error(
          ("error" in data ? data.error : undefined) ?? "Chat failed.",
        );
      }

      setActiveChatSessionId(data.chatSessionId);
      setChatTurns((current) => [
        ...current,
        {
          id: data.userMessageId,
          role: "user",
          content: message,
        },
        {
          id: data.assistantMessageId,
          role: "assistant",
          content: data.coachReply,
          handbookCapture: readHandbookCapture(data.toolTrace),
          mistakeBookCapture: readMistakeBookCapture(data.toolTrace),
          actionOutcomes: data.actionOutcomes,
        },
      ]);
      setChatInput("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Chat failed.");
    } finally {
      setIsChatting(false);
    }
  };

  const clearCoachChatHistory = async () => {
    if (
      !selectedProblem ||
      isClearingChat ||
      isReviewing ||
      isChatting ||
      chatTurns.length === 0
    ) {
      return;
    }

    setIsClearingChat(true);
    setClearChatError(null);

    try {
      const response = await fetch("/api/coach/chat/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatSessionId: activeChatSessionId ?? undefined,
          problemId: selectedProblem.id,
          problemSlug: selectedProblem.slug,
        }),
      });
      const data = await readApiJson<
        WorkbenchClearChatResult | { ok: false; error?: string }
      >(response, "Clear chat history");

      if (!response.ok || data.ok !== true) {
        throw new Error(
          ("error" in data ? data.error : undefined) ??
            "Unable to clear chat history.",
        );
      }

      if (data.chatSessionId) {
        setActiveChatSessionId(data.chatSessionId);
      }
      setChatTurns([]);
      setNewlyCreatedReviewAttemptId(null);
      setRevealedReviewAttemptIds(new Set());
      setIsClearChatOpen(false);
    } catch (error) {
      setClearChatError(
        error instanceof Error
          ? error.message
          : "Unable to clear chat history.",
      );
    } finally {
      setIsClearingChat(false);
    }
  };

  const toggleExpandedTest = (testCaseId: string) => {
    setExpandedTestIds((current) => {
      const next = new Set(current);

      if (next.has(testCaseId)) {
        next.delete(testCaseId);
      } else {
        next.add(testCaseId);
      }

      return next;
    });
  };

  const updateCodeTestSplit = (nextPercent: number) => {
    const containerHeight =
      codeTestPanelRef.current?.getBoundingClientRect().height ?? 0;
    const bounds = codeTestSplitBounds(containerHeight);

    setCodePanelHeightPercent(clamp(nextPercent, bounds.min, bounds.max));
  };

  const startProblemResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isProblemPanelCollapsed) {
      return;
    }

    event.preventDefault();
    resizeOriginRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      problemWidth: problemPanelWidth,
      coachWidth: coachPanelWidth,
      codePanelHeightPercent,
    };
    setActiveResizeHandle("problem");
  };

  const startCoachResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isCoachPanelCollapsed) {
      return;
    }

    event.preventDefault();
    resizeOriginRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      problemWidth: problemPanelWidth,
      coachWidth: coachPanelWidth,
      codePanelHeightPercent,
    };
    setActiveResizeHandle("coach");
  };

  const startCodeTestResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizeOriginRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      problemWidth: problemPanelWidth,
      coachWidth: coachPanelWidth,
      codePanelHeightPercent,
    };
    setActiveResizeHandle("codeTest");
  };

  const handleCodeTestResizeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    const bounds = codeTestSplitBounds(
      codeTestPanelRef.current?.getBoundingClientRect().height ?? 0,
    );

    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateCodeTestSplit(codePanelHeightPercent - codeTestResizeKeyboardStep);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateCodeTestSplit(codePanelHeightPercent + codeTestResizeKeyboardStep);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      updateCodeTestSplit(bounds.min);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      updateCodeTestSplit(bounds.max);
    }
  };

  const layoutStyle = {
    "--problem-panel-width": `${
      isProblemPanelCollapsed ? collapsedPanelWidth : problemPanelWidth
    }px`,
    "--coach-panel-width": `${
      isCoachPanelCollapsed ? collapsedPanelWidth : coachPanelWidth
    }px`,
    "--code-panel-height": `${codePanelHeightPercent}%`,
  } as CSSProperties;

  return (
    <div className="pl-14">
      <Sidebar
        displayName={profile.displayName}
        mode="overlay"
        onNavigate={(href) => {
          if (!href.startsWith("/workbench")) {
            void closeRuntimeTraceSession("workbench_navigation");
          }
        }}
      />
      <AppShell
        currentProblemDifficulty={selectedProblem.difficulty}
        currentProblemLabel={problemLabel(selectedProblem)}
        headerActions={
          <RuntimeTraceCapsule
            enabled={traceUiEnabled}
            eventCount={currentRuntimeTrace.events.length}
            open={isTraceDrawerOpen}
            onOpenChange={setIsTraceDrawerOpen}
            state={runtimeTraceCapsuleState({
              availability: currentRuntimeTrace.availability,
              backgroundStatus: currentRuntimeTrace.backgroundStatus,
              hasActiveTurn: currentRuntimeTrace.hasActiveTurn,
              hasSession: Boolean(currentRuntimeTrace.session),
            })}
          />
        }
        language={language}
        onLanguageChange={(nextLanguage) => {
          setLanguage(nextLanguage);
          setCode(codeFor(selectedProblem, nextLanguage));
          setSelectedTestIds(selectedIdsFor(selectedProblem, nextLanguage));
          setLatestEvidence(null);
          setEditorErrorHighlight(null);
          setPracticeRunSummary(null);
          setRunError(null);
          setReviewError(null);
          setDraftWarning(null);
          setChatTurns([]);
          setChatInput("");
          setNewlyCreatedReviewAttemptId(null);
          setPendingPlannerOutcome(null);
          setPlannerOutcomeError(null);
          setActiveChatSessionId(null);
          setExpandedTestIds(new Set());
          setSaveMessage("Draft ready");
        }}
        onProblemQueryChange={setQuery}
        onProblemResolve={resolveQuery}
        problemQuery={query}
        resolutionMessage={resolutionMessage}
      >
        {campaignContext && campaignContext.problemSlug === selectedProblem.slug ? (
          <WorkbenchCampaignBanner context={campaignContext} />
        ) : null}
        <main
          ref={layoutRef}
          style={layoutStyle}
          className={cn(
            "mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-[1800px] gap-3 overflow-y-auto p-3 lg:h-[calc(100vh-4rem)] lg:grid-cols-[var(--problem-panel-width)_8px_minmax(0,1fr)_8px_var(--coach-panel-width)] lg:gap-0 lg:overflow-hidden",
          )}
        >
          <ProblemPanel
            isCollapsed={isProblemPanelCollapsed}
            onToggleCollapsed={() =>
              setIsProblemPanelCollapsed((current) => !current)
            }
            problem={selectedProblem}
          />

          <ResizeHandle
            ariaLabel="Resize problem panel"
            disabled={isProblemPanelCollapsed}
            isActive={activeResizeHandle === "problem"}
            onPointerDown={startProblemResize}
          />

          <section
            aria-label="Code and Tests Panel"
            ref={codeTestPanelRef}
            className="flex min-h-[720px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:mx-1 lg:min-h-0"
          >
            <EditorPanel
              code={code}
              errorHighlight={editorErrorHighlight}
              isResettingDraft={isResettingDraft}
              language={language}
              methodName={selectedProblem.methodName}
              onCodeChange={(nextCode) => {
                setCode(nextCode);
                writeDraftShadow({
                  problemId: selectedProblem.id,
                  language,
                  content: nextCode,
                  selectedTestCaseIds: selectedTestIds,
                });
                setEditorErrorHighlight(null);
                setDraftWarning(null);
                setSaveMessage("Saving draft...");
              }}
              onErrorHighlightSeen={() => setEditorErrorHighlight(null)}
              onRequestReset={() => setIsResetDraftOpen(true)}
              resetDisabled={
                isResettingDraft || isRunning || isReviewing || isChatting
              }
              saveMessage={saveMessage}
            />
            <CodeTestResizeHandle
              ariaLabel="Resize code and tests panels"
              isActive={activeResizeHandle === "codeTest"}
              onKeyDown={handleCodeTestResizeKeyDown}
              onPointerDown={startCodeTestResize}
              value={codePanelHeightPercent}
            />
            <TestPanel
              customError={customError}
              customExpected={customExpected}
              customInput={customInput}
              customLabel={customLabel}
              expandedTestIds={expandedTestIds}
              executionMode={executionMode}
              isAddingCustomTest={isPending}
              isCustomTestOpen={isCustomTestOpen}
              isRunning={isRunning}
              isResolvingProblem={isResolvingProblem}
              isReviewing={isReviewing}
              reviewPhase={reviewPhase}
              latestEvidence={latestEvidence}
              onAddCustomTest={addCustomTest}
              onCustomExpectedChange={setCustomExpected}
              onCustomInputChange={setCustomInput}
              onCustomLabelChange={setCustomLabel}
              onRunReview={() => void runReview()}
              onRunTests={() => void runSelectedTests()}
              onToggleCustomTest={() =>
                setIsCustomTestOpen((current) => !current)
              }
              onToggleExpanded={toggleExpandedTest}
              onToggleSelected={updateSelectedTests}
              problem={selectedProblem}
              practiceRunSummary={practiceRunSummary}
              runError={runError}
              selectedTestIds={selectedTestIds}
            />
          </section>

          <ResizeHandle
            ariaLabel="Resize coach panel"
            disabled={isCoachPanelCollapsed}
            isActive={activeResizeHandle === "coach"}
            onPointerDown={startCoachResize}
          />

          <CoachPanel
            chatError={chatError}
            chatInput={chatInput}
            chatTurns={chatTurns}
            clearChatError={clearChatError}
            draftWarning={draftWarning}
            isCollapsed={isCoachPanelCollapsed}
            isChatting={isChatting}
            isClearChatOpen={isClearChatOpen}
            isClearingChat={isClearingChat}
            isReviewing={isReviewing}
            reviewPhase={reviewPhase}
            executionMode={executionMode}
            onClearChatHistory={clearCoachChatHistory}
            onClearChatOpenChange={(open) => {
              setIsClearChatOpen(open);
              if (!open) {
                setClearChatError(null);
              }
            }}
            onChatInputChange={setChatInput}
            onOpenFailedCase={(failedCaseId) => {
              if (!failedCaseId) {
                return;
              }

              setExpandedTestIds(
                (current) => new Set([...current, failedCaseId]),
              );
            }}
            newlyCreatedReviewAttemptId={newlyCreatedReviewAttemptId}
            onRevealReview={(reviewAttemptId) => {
              let storage: Storage | null = null;
              try {
                storage = window.localStorage;
              } catch {
                storage = null;
              }
              markReviewReplyRevealed(reviewAttemptId, storage);
              setRevealedReviewAttemptIds(
                (current) => new Set([...current, reviewAttemptId]),
              );
            }}
            onOpenHandbook={openHandbookFromWorkbench}
            onSendChatMessage={sendChatMessage}
            onRecordPlannerOutcome={recordPlannerOutcome}
            onToggleCollapsed={() =>
              setIsCoachPanelCollapsed((current) => !current)
            }
            pendingPlannerOutcome={pendingPlannerOutcome}
            plannerOutcomeError={plannerOutcomeError}
            isRecordingPlannerOutcome={isRecordingPlannerOutcome}
            revealedReviewAttemptIds={revealedReviewAttemptIds}
            reviewError={reviewError}
            visibleTestCaseIds={selectedProblem.testCases.map(
              (testCase) => testCase.id,
            )}
          />
        </main>

        <RuntimeTraceDrawer
          activeView={traceDrawerView}
          historySessions={runtimeTraceHistory.sessions.map(
            toRuntimeTraceSessionOption,
          )}
          metrics={
            visibleRuntimeTrace?.session ? (
              <RuntimeTraceMetricsView
                className="p-4"
                events={runtimeTraceMetricsEvents}
                runs={runtimeTraceMetricsRuns}
                session={visibleRuntimeTrace.session}
              />
            ) : (
              <RuntimeTraceEmptyState
                label={traceEmptyStateLabel({
                  availability:
                    traceSessionMode === "history"
                      ? runtimeTraceHistory.availability
                      : currentRuntimeTrace.availability,
                  error:
                    traceSessionMode === "history"
                      ? runtimeTraceHistory.error
                      : currentRuntimeTrace.error,
                  history: traceSessionMode === "history",
                })}
              />
            )
          }
          onAcknowledgeUnseen={
            traceSessionMode === "history"
              ? historicalRuntimeTrace.acknowledgeUnseen
              : currentRuntimeTrace.acknowledgeUnseen
          }
          onActiveViewChange={setTraceDrawerView}
          eventFilterKinds={runtimeTraceEventFilter.kinds}
          onEventFilterKindsChange={runtimeTraceEventFilter.setKinds}
          eventFilterQuery={runtimeTraceEventFilter.query}
          onEventFilterQueryChange={runtimeTraceEventFilter.setQuery}
          onHistorySessionChange={(sessionId) => {
            setSelectedTraceHistorySessionId(sessionId || null);
            setTraceDrawerView("timeline");
          }}
          onOpenChange={setIsTraceDrawerOpen}
          onSessionModeChange={(mode) => {
            setTraceSessionMode(mode);
            if (mode === "history") {
              runtimeTraceHistory.refresh();
            }
          }}
          onViewportAtTailChange={
            traceSessionMode === "history"
              ? historicalRuntimeTrace.setViewportAtTail
              : currentRuntimeTrace.setViewportAtTail
          }
          open={isTraceDrawerOpen}
          raw={
            visibleRuntimeTrace?.session ? (
              <RuntimeTraceRawView
                className="p-4"
                events={runtimeTraceRawEvents}
              />
            ) : (
              <RuntimeTraceEmptyState label="Select a trace Session to inspect normalized events." />
            )
          }
          selectedHistorySessionId={selectedTraceHistorySessionId}
          session={runtimeTraceSessionView}
          sessionMode={traceSessionMode}
          summary={runtimeTraceSummary}
          timeline={
            traceSessionMode === "history" && !selectedTraceHistorySessionId ? (
              <RuntimeTraceHistoryList
                className="p-4"
                onSelectSession={setSelectedTraceHistorySessionId}
                selectedSessionId={selectedTraceHistorySessionId}
                sessions={runtimeTraceHistory.sessions.map(
                  toRuntimeTraceHistorySession,
                )}
              />
            ) : (
              <RuntimeTraceTimeline
                events={runtimeTraceFilteredTimelineEvents}
                runs={runtimeTraceTimelineRuns}
              />
            )
          }
          unseenCount={visibleRuntimeTrace?.unseenCount ?? 0}
        />

        <Dialog open={isLcConfirmOpen} onOpenChange={setIsLcConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Use LeetCode Judge for this review?</DialogTitle>
              <DialogDescription>
                PatternCoach will send your current code to LeetCode through the
                configured local session and use the returned judge result as
                coaching evidence. This confirmation is shown once on this
                browser.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setIsLcConfirmOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button onClick={confirmLcReview} type="button">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Start Review
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isResetDraftOpen}
          onOpenChange={(open) => {
            if (!isResettingDraft) {
              setIsResetDraftOpen(open);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset this code draft?</DialogTitle>
              <DialogDescription>
                Your editor will return to this problem&apos;s starter function
                header. Selected visible tests stay selected, while the current
                run result and error highlight are cleared. Review and chat
                history are preserved.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button disabled={isResettingDraft} type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={isResettingDraft}
                onClick={() => void resetCurrentDraft()}
                type="button"
                variant="destructive"
              >
                {isResettingDraft ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                )}
                Reset draft
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <FloatingNotes />
      </AppShell>
    </div>
  );
}

function runtimeTraceCapsuleState(input: {
  availability: "disabled" | "idle" | "loading" | "ready" | "error";
  backgroundStatus: "idle" | "pending" | "settled" | "failed" | null;
  hasActiveTurn: boolean;
  hasSession: boolean;
}): "live" | "settled" | "error" | "idle" {
  if (input.availability === "error" || input.backgroundStatus === "failed") {
    return "error";
  }
  if (
    input.availability === "loading" ||
    input.hasActiveTurn ||
    input.backgroundStatus === "pending"
  ) {
    return "live";
  }
  return input.hasSession ? "settled" : "idle";
}

function traceEmptyStateLabel(input: {
  availability: "disabled" | "idle" | "loading" | "ready" | "error";
  error: string | null;
  history: boolean;
}) {
  if (input.availability === "disabled") {
    return "Runtime Trace is disabled in this environment.";
  }
  if (input.availability === "error") {
    return input.error ?? "Runtime Trace could not be loaded.";
  }
  if (input.availability === "loading") {
    return input.history
      ? "Loading trace Session history…"
      : "Loading the current trace Session…";
  }
  return input.history
    ? "Select a completed Session from History."
    : "No observable action yet. Review, Chat, or Practice Run will start the trace Session.";
}

function RuntimeTraceEmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-64 place-items-center px-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function ProblemPanel({
  isCollapsed,
  onToggleCollapsed,
  problem,
}: {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  problem: WorkbenchProblem;
}) {
  return (
    <section
      aria-label="Problem Panel"
      className={cn(
        "flex min-h-[360px] min-w-0 flex-col rounded-md border border-border bg-card transition-[width] lg:min-h-0",
        isCollapsed && "items-center",
      )}
    >
      {isCollapsed ? (
        <div className="flex h-full w-full flex-col items-center gap-4 py-3">
          <Button
            aria-label="Expand problem panel"
            onClick={onToggleCollapsed}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div className="writing-mode-vertical rotate-180 text-xs font-medium uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
            Problem
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {problem.leetcodeNumber
                  ? `LC ${problem.leetcodeNumber}`
                  : "Demo"}
              </p>
              <h2 className="truncate text-base font-semibold">
                {problem.title}
              </h2>
            </div>
            <Button
              aria-label="Collapse problem panel"
              onClick={onToggleCollapsed}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <ProblemStatement dense problem={problem} />
          </div>

          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Collapse for a wider editor.
          </div>
        </>
      )}
    </section>
  );
}

function ResizeHandle({
  ariaLabel,
  disabled,
  isActive,
  onPointerDown,
}: {
  ariaLabel: string;
  disabled: boolean;
  isActive: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className={cn(
        "group hidden min-h-0 cursor-col-resize items-center justify-center lg:flex",
        disabled && "cursor-default opacity-30",
      )}
      disabled={disabled}
      onPointerDown={onPointerDown}
      role="separator"
      type="button"
    >
      <span
        className={cn(
          "h-14 w-1 rounded-full bg-border transition-colors group-hover:bg-primary/70",
          isActive && "bg-primary",
        )}
      />
    </button>
  );
}

function CodeTestResizeHandle({
  ariaLabel,
  isActive,
  onKeyDown,
  onPointerDown,
  value,
}: {
  ariaLabel: string;
  isActive: boolean;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  value: number;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemax={maxCodeTestSplitPercent}
      aria-valuemin={minCodeTestSplitPercent}
      aria-valuenow={Math.round(value)}
      className={cn(
        "group flex h-3 shrink-0 cursor-row-resize items-center justify-center border-y border-border/80 bg-muted/20 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
        isActive && "bg-primary/10",
      )}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role="separator"
      title="Resize Code and Tests"
      type="button"
    >
      <GripHorizontal
        className={cn(
          "h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-primary",
          isActive && "text-primary",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function EditorPanel({
  code,
  errorHighlight,
  isResettingDraft,
  language,
  methodName,
  onCodeChange,
  onErrorHighlightSeen,
  onRequestReset,
  resetDisabled,
  saveMessage,
}: {
  code: string;
  errorHighlight: CodeRunErrorLocation | null;
  isResettingDraft: boolean;
  language: WorkbenchLanguage;
  methodName: string;
  onCodeChange: (code: string) => void;
  onErrorHighlightSeen: () => void;
  onRequestReset: () => void;
  resetDisabled: boolean;
  saveMessage: string;
}) {
  return (
    <section
      className="flex min-h-[320px] flex-none flex-col border-b border-border px-4 py-3 lg:min-h-0"
      style={{ flexBasis: "var(--code-panel-height)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Code</h2>
          <p className="text-xs text-muted-foreground">
            {methodName} · {language}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                saveMessage === "Draft saved"
                  ? "bg-emerald-500"
                  : "bg-amber-500",
              )}
            />
            {saveMessage}
          </span>
          <Button
            aria-label="Reset code draft to starter code"
            className="h-8 gap-1.5 px-2 text-xs"
            disabled={resetDisabled}
            onClick={onRequestReset}
            type="button"
            variant="outline"
          >
            {isResettingDraft ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Reset
          </Button>
        </div>
      </div>

      <CodeDraftEditor
        className="min-h-[240px]"
        code={code}
        errorHighlight={errorHighlight}
        language={language}
        onChange={onCodeChange}
        onErrorHighlightSeen={onErrorHighlightSeen}
      />
    </section>
  );
}

function TestPanel({
  customError,
  customExpected,
  customInput,
  customLabel,
  expandedTestIds,
  executionMode,
  isAddingCustomTest,
  isCustomTestOpen,
  isRunning,
  isResolvingProblem,
  isReviewing,
  reviewPhase,
  latestEvidence,
  onAddCustomTest,
  onCustomExpectedChange,
  onCustomInputChange,
  onCustomLabelChange,
  onRunReview,
  onRunTests,
  onToggleCustomTest,
  onToggleExpanded,
  onToggleSelected,
  problem,
  practiceRunSummary,
  runError,
  selectedTestIds,
}: {
  customError: string | null;
  customExpected: string;
  customInput: string;
  customLabel: string;
  expandedTestIds: Set<string>;
  executionMode: ExecutionMode;
  isAddingCustomTest: boolean;
  isCustomTestOpen: boolean;
  isRunning: boolean;
  isResolvingProblem: boolean;
  isReviewing: boolean;
  reviewPhase: ReviewPhase;
  latestEvidence: WorkbenchRunEvidence | null;
  onAddCustomTest: () => void;
  onCustomExpectedChange: (value: string) => void;
  onCustomInputChange: (value: string) => void;
  onCustomLabelChange: (value: string) => void;
  onRunReview: () => void;
  onRunTests: () => void;
  onToggleCustomTest: () => void;
  onToggleExpanded: (testCaseId: string) => void;
  onToggleSelected: (testCaseId: string, checked: boolean) => void;
  problem: WorkbenchProblem;
  practiceRunSummary: string | null;
  runError: string | null;
  selectedTestIds: string[];
}) {
  const executionNoticeKey = [
    problem.id,
    executionMode.kind,
    executionMode.label,
    executionMode.runDescription,
    executionMode.reviewDescription,
  ].join(":");
  const [dismissedExecutionNoticeKey, setDismissedExecutionNoticeKey] =
    useState<string | null>(null);
  const isExecutionNoticeDismissed =
    dismissedExecutionNoticeKey === executionNoticeKey;
  const latestResults = useMemo(
    () =>
      new Map(
        latestEvidence?.runResult.testResults.map((result) => [
          result.id,
          result,
        ]) ?? [],
      ),
    [latestEvidence],
  );
  const latestRunResult = latestEvidence?.runResult ?? null;
  const isReviewDisabled =
    isReviewing || isResolvingProblem || !executionMode.canReview;
  const isRunDisabled =
    isRunning || isResolvingProblem || !executionMode.canRun;

  return (
    <section
      aria-label="Tests Panel"
      className="flex min-h-[220px] flex-1 flex-col px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Run Evidence</h2>
            {latestEvidence ? (
              <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {evidenceActionLabel(latestEvidence.source)}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {runEvidenceSummary(latestEvidence)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            disabled={isRunDisabled}
            onClick={onRunTests}
            size="sm"
            type="button"
            variant="secondary"
          >
            {isRunning || isResolvingProblem ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            Run
          </Button>
          <Button
            disabled={isReviewDisabled}
            onClick={onRunReview}
            size="sm"
            type="button"
          >
            {isReviewing || isResolvingProblem ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            Review My Code
          </Button>
          <Button
            onClick={onToggleCustomTest}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add custom
          </Button>
        </div>
      </div>

      {isReviewing ? (
        <div
          aria-live="polite"
          className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/25 px-3 py-2 text-xs"
        >
          {reviewPhase === "coach" ? (
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-emerald-600"
              aria-hidden="true"
            />
          ) : (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
          )}
          <span>
            {reviewPhase === "coach"
              ? "Judge result received. Coach is generating a short review (25s max)."
              : executionMode.reviewKind === "leetcode"
                ? "Waiting for the LeetCode judge result..."
                : "Running Review evidence..."}
          </span>
        </div>
      ) : null}

      {practiceRunSummary || runError ? (
        <div
          className={cn(
            "mt-3 rounded-md border px-3 py-2 text-xs leading-5",
            runError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {runError ?? practiceRunSummary}
        </div>
      ) : null}

      {isExecutionNoticeDismissed ? null : (
        <div
          className={cn(
            "relative mt-3 rounded-md border py-2 pl-3 pr-10 text-xs leading-5",
            executionMode.kind === "blocked"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : executionMode.kind === "local_hot150"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-border bg-muted/35 text-muted-foreground",
          )}
        >
          <p className="font-medium text-foreground">{executionMode.label}</p>
          <p>{executionMode.runDescription}</p>
          <p className="mt-1">{executionMode.reviewDescription}</p>
          <button
            aria-label="Dismiss runner notice"
            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-current opacity-75 transition hover:bg-background/70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setDismissedExecutionNoticeKey(executionNoticeKey)}
            type="button"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {isCustomTestOpen ? (
          <form
            className="space-y-3 rounded-md border border-border bg-muted/25 p-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              onAddCustomTest();
            }}
          >
            <Input
              aria-label="Custom test label"
              onChange={(event) => onCustomLabelChange(event.target.value)}
              placeholder="custom test label"
              value={customLabel}
            />
            <textarea
              aria-label="Custom test input JSON"
              className="min-h-20 w-full rounded-md border border-input bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              onChange={(event) => onCustomInputChange(event.target.value)}
              placeholder='{"nums":[2,7,11,15],"target":9}'
              value={customInput}
            />
            <textarea
              aria-label="Custom test expected JSON"
              className="min-h-16 w-full rounded-md border border-input bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              onChange={(event) => onCustomExpectedChange(event.target.value)}
              placeholder="[0,1]"
              value={customExpected}
            />
            {customError ? (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {customError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                onClick={onToggleCustomTest}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={isAddingCustomTest} size="sm" type="submit">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Test
              </Button>
            </div>
          </form>
        ) : null}

        {latestRunResult &&
        readRunProvider(latestRunResult)?.startsWith("lc_") ? (
          <LeetCodeJudgeResultCard result={latestRunResult} />
        ) : null}

        {problem.testCases.map((testCase) => (
          <TestCaseRow
            evidence={latestEvidence}
            isExpanded={expandedTestIds.has(testCase.id)}
            isPending={isRunning || isReviewing}
            isSelected={selectedTestIds.includes(testCase.id)}
            key={testCase.id}
            onToggleExpanded={() => onToggleExpanded(testCase.id)}
            onToggleSelected={(checked) =>
              onToggleSelected(testCase.id, checked)
            }
            testCase={testCase}
            testResult={latestResults.get(testCase.id)}
          />
        ))}
      </div>

      <div className="mt-3 rounded-md border border-border bg-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <p className="flex items-start gap-2">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 text-primary"
            aria-hidden="true"
          />
          <span>
            {latestEvidence
              ? `${evidenceActionLabel(latestEvidence.source)} evidence source: ${latestEvidence.evidenceSource}. `
              : "Run evidence will show the latest Local Run or Review My Code result. "}
            {latestEvidence?.evidenceVerdict?.evidenceClass === "local_only"
              ? "Remote review was unavailable, so this is local visible-test fallback evidence only. "
              : ""}
            PatternCoach does not guarantee official acceptance.
          </span>
        </p>
      </div>
    </section>
  );
}

function LeetCodeJudgeResultCard({ result }: { result: CodeRunResult }) {
  const failed = result.firstFailedCase;
  const firstFailedOrdinal = readJudgeFirstFailedOrdinal(result);
  const errorDetail = getCodeRunErrorDetail(result);

  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        runStatusToneClassName(result.status),
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">LeetCode result</p>
          <p className="mt-1 text-xs opacity-80">
            {runStatusLabel(result.status)} · {runSummary(result)}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-current/20 px-2 py-1 text-xs font-medium">
          remote
        </span>
      </div>

      {errorDetail ? <ErrorDetailBlock result={result} /> : null}

      {failed ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium">
            First failed case
            {firstFailedOrdinal ? ` #${firstFailedOrdinal}` : ""}:{" "}
            {failed.label}
          </p>
          <EvidenceValue label="input" value={failed.input} />
          <div className="grid gap-2 md:grid-cols-2">
            <EvidenceValue label="expected" value={failed.expected} />
            <EvidenceValue
              label={failed.error ? "error" : "actual"}
              value={failed.error ?? failed.actual}
            />
          </div>
        </div>
      ) : result.stderr ? (
        <div className="mt-3">
          <EvidenceValue
            label={rawMessageLabel(result)}
            value={result.stderr}
          />
        </div>
      ) : null}
    </div>
  );
}

function ErrorDetailBlock({ result }: { result: CodeRunResult }) {
  const detail = getCodeRunErrorDetail(result);

  if (!detail) {
    return null;
  }

  return (
    <div className="mt-3 rounded-md border border-current/15 bg-background/65 p-2 text-xs">
      <p className="font-medium">{detail.title}</p>
      <p className="mt-1 opacity-80">{detail.summary}</p>
      {detail.nextStep ? (
        <p className="mt-1 opacity-80">Next: {detail.nextStep}</p>
      ) : null}
    </div>
  );
}

function rawMessageLabel(result: CodeRunResult) {
  if (
    result.status === "runtime_error" &&
    result.failureProvenance === "user_code"
  ) {
    return "raw runtime message";
  }

  if (
    result.failureProvenance === "judge_service" ||
    result.failureProvenance === "sandbox_service" ||
    result.failureProvenance === "network" ||
    result.failureProvenance === "adapter"
  ) {
    return "runner message";
  }

  return "raw message";
}

function EvidenceValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border border-current/15 bg-background/65 p-2">
      <p className="text-[11px] font-medium uppercase opacity-70">{label}</p>
      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
        {compactValue(value)}
      </pre>
    </div>
  );
}

function TestCaseRow({
  evidence,
  isExpanded,
  isSelected,
  isPending,
  onToggleExpanded,
  onToggleSelected,
  testCase,
  testResult,
}: {
  evidence: WorkbenchRunEvidence | null;
  isExpanded: boolean;
  isSelected: boolean;
  isPending: boolean;
  onToggleExpanded: () => void;
  onToggleSelected: (checked: boolean) => void;
  testCase: WorkbenchTestCase;
  testResult: CodeRunTestResult | undefined;
}) {
  const latestRunResult = evidence?.runResult ?? null;
  const isEvidenceSelected = isPending
    ? isSelected
    : Boolean(evidence?.selectedTestCaseIds.includes(testCase.id));
  const status = deriveTestcaseStatus({
    isEvidenceSelected,
    isPending,
    projectOverallError: readRunProvider(latestRunResult) !== "lc_submit",
    runStatus: latestRunResult?.status,
    testResult,
  });
  const expectedValue = testResult?.expected ?? testCase.expected;
  const actualValue = testResult?.actual;
  const expected = compactValue(expectedValue);
  const actual = actualOutputText(testResult);
  const diff =
    status === "failed" && hasActualOutput(testResult)
      ? formatOutputDiff(expectedValue, actualValue)
      : null;
  const stdoutDisplay = formatTestcaseStreamOutput({
    status,
    testValue: testResult?.stdout,
    testCaptured: testResult?.stdoutCaptured,
  });
  const stderrDisplay = formatTestcaseStreamOutput({
    status,
    testValue: testResult?.stderr,
    testCaptured: testResult?.stderrCaptured,
  });
  const errorText =
    testResult?.error ??
    testResult?.stderr ??
    (isErrorStatus(status) ? latestRunResult?.stderr : undefined) ??
    (isErrorStatus(status) && latestRunResult
      ? runStatusLabel(latestRunResult.status)
      : undefined);
  const provenanceLabel = formatGtProvenance(testCase.gtProvenance);

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="grid grid-cols-[auto_auto_minmax(110px,0.8fr)_auto_minmax(180px,1fr)_auto] items-center gap-3 px-3 py-2 text-sm">
        <span
          aria-label={testcaseStatusLabel(status)}
          className={cn("h-3 w-3 rounded-full", statusDotClassName(status))}
        />
        <input
          aria-label={`Run ${testCase.label}`}
          checked={isSelected}
          className="h-4 w-4 accent-primary"
          onChange={(event) => onToggleSelected(event.target.checked)}
          type="checkbox"
        />
        <button
          className="min-w-0 text-left"
          onClick={onToggleExpanded}
          type="button"
        >
          <span className="block truncate font-medium">{testCase.label}</span>
          <span className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
            <span>{testCase.source}</span>
            {provenanceLabel ? (
              <span>expected from: {provenanceLabel}</span>
            ) : null}
            {testCase.expectedSource ? (
              <span>expected: {testCase.expectedSource}</span>
            ) : null}
          </span>
        </button>
        <span
          className={cn(
            "justify-self-start rounded-md border px-2 py-0.5 text-[11px] font-medium",
            testcaseStatusToneClassName(status),
          )}
        >
          {testcaseStatusLabel(status)}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {compactInput(testCase.input)}
        </span>
        <Button
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${testCase.label}`}
          onClick={onToggleExpanded}
          size="icon"
          type="button"
          variant="ghost"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {isExpanded ? (
        <div className="border-t border-border px-3 py-3">
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <OutputPill label="input" value={compactValue(testCase.input)} />
            <OutputPill label="expected" value={expected} />
          </div>

          {isErrorStatus(status) ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="text-xs font-medium uppercase text-amber-800">
                {testcaseStatusLabel(status)}
              </p>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                {errorText || "No runner error detail captured"}
              </pre>
            </div>
          ) : (
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
              <OutputPill label="actual" value={actual} />
              {diff ? (
                <OutputPill
                  className="border-rose-200 bg-rose-50 text-rose-800"
                  label="diff"
                  value={diff}
                />
              ) : null}
            </div>
          )}

          <div className="mt-3 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <OutputStreamBlock label="stdout" output={stdoutDisplay} />
            <OutputStreamBlock label="stderr" output={stderrDisplay} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OutputPill({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/25 p-2",
        className,
      )}
    >
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
        {value}
      </pre>
    </div>
  );
}

function OutputStreamBlock({
  label,
  output,
}: {
  label: string;
  output: ReturnType<typeof formatCapturedOutput>;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/25 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          {label}
        </p>
        <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {output.label === "not_captured" ? "not captured" : output.label}
        </span>
      </div>
      <pre className="mt-2 min-h-28 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-xs leading-5 text-foreground">
        {output.text}
      </pre>
    </div>
  );
}

function CoachPanel({
  chatError,
  chatInput,
  chatTurns,
  clearChatError,
  draftWarning,
  isCollapsed,
  isChatting,
  isClearChatOpen,
  isClearingChat,
  isRecordingPlannerOutcome,
  isReviewing,
  reviewPhase,
  executionMode,
  newlyCreatedReviewAttemptId,
  onClearChatHistory,
  onClearChatOpenChange,
  onChatInputChange,
  onOpenFailedCase,
  onOpenHandbook,
  onRecordPlannerOutcome,
  onRevealReview,
  onSendChatMessage,
  onToggleCollapsed,
  pendingPlannerOutcome,
  plannerOutcomeError,
  revealedReviewAttemptIds,
  reviewError,
  visibleTestCaseIds,
}: {
  chatError: string | null;
  chatInput: string;
  chatTurns: WorkbenchChatTurn[];
  clearChatError: string | null;
  draftWarning: string | null;
  isCollapsed: boolean;
  isChatting: boolean;
  isClearChatOpen: boolean;
  isClearingChat: boolean;
  isRecordingPlannerOutcome: boolean;
  isReviewing: boolean;
  reviewPhase: ReviewPhase;
  executionMode: ExecutionMode;
  newlyCreatedReviewAttemptId: string | null;
  onClearChatHistory: () => void;
  onClearChatOpenChange: (open: boolean) => void;
  onChatInputChange: (value: string) => void;
  onOpenFailedCase: (failedCaseId?: string) => void;
  onOpenHandbook: (href: string) => Promise<void>;
  onRecordPlannerOutcome: (
    selfRating: "easy" | "hesitated" | "struggled" | "unsolved",
  ) => void;
  onRevealReview: (reviewAttemptId: string) => void;
  onSendChatMessage: () => void;
  onToggleCollapsed: () => void;
  pendingPlannerOutcome: {
    planItemId?: string;
    problemHistoryId: string;
    reviewAttemptId: string;
  } | null;
  plannerOutcomeError: string | null;
  revealedReviewAttemptIds: Set<string>;
  reviewError: string | null;
  visibleTestCaseIds: string[];
}) {
  const visibleTestCaseIdSet = new Set(visibleTestCaseIds);
  const canClearChat =
    chatTurns.length > 0 && !isReviewing && !isChatting && !isClearingChat;

  if (isCollapsed) {
    return (
      <section
        aria-label="Coach Panel"
        className="flex min-h-[360px] min-w-0 flex-col items-center rounded-md border border-border bg-card py-3 lg:min-h-0"
      >
        <Button
          aria-label="Expand coach panel"
          onClick={onToggleCollapsed}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="mt-4 rotate-180 text-xs font-medium uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
          Coach
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Coach Panel"
      className="flex min-h-[560px] min-w-0 flex-col rounded-md border border-border bg-card lg:min-h-0"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            Coach (single chat stream)
          </h2>
          <p className="text-xs text-muted-foreground">
            Review evidence appears inline.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Dialog open={isClearChatOpen} onOpenChange={onClearChatOpenChange}>
            <DialogTrigger asChild>
              <Button
                aria-label="Clear chat history"
                className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                disabled={!canClearChat}
                type="button"
                variant="ghost"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear chat history</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear Coach chat history for this problem?</DialogTitle>
                <DialogDescription>
                  This only clears the chat stream loaded for this problem. Memory,
                  problem history, and run evidence are preserved.
                </DialogDescription>
              </DialogHeader>
              {clearChatError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {clearChatError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button
                    disabled={isClearingChat}
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={isClearingChat}
                  onClick={onClearChatHistory}
                  type="button"
                  variant="destructive"
                >
                  {isClearingChat ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  Clear chat history
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <Button
            aria-label="Collapse coach panel"
            onClick={onToggleCollapsed}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="rounded-md border border-border bg-muted/25 p-3 text-sm leading-6 text-muted-foreground">
          {executionMode.canRun
            ? "Run checks local visible tests. Ask Coach when you want a diagnosis; Review My Code creates the persisted review record when remote/demo review evidence is available."
            : "Edit code or ask Coach directly. Run is enabled after this Hot-150 problem has validated local tests."}
        </div>

        {isReviewing ? (
          <div className="flex items-start gap-3 rounded-md border border-primary/25 bg-primary/5 p-3 text-sm leading-6 text-foreground">
            {reviewPhase === "coach" ? (
              <CheckCircle2
                className="mt-0.5 h-4 w-4 text-emerald-600"
                aria-hidden="true"
              />
            ) : (
              <Loader2
                className="mt-0.5 h-4 w-4 animate-spin text-primary"
                aria-hidden="true"
              />
            )}
            <div>
              <p className="font-medium">
                {reviewPhase === "coach"
                  ? "Judge result received"
                  : executionMode.reviewKind === "leetcode"
                    ? "Sending code to LeetCode Judge..."
                    : "Running selected tests..."}
              </p>
              <p className="text-muted-foreground">
                {reviewPhase === "coach"
                  ? "Coach is generating a short review (25s max). The evidence remains visible if Coach times out."
                  : "The result will appear as soon as the runner responds."}
              </p>
            </div>
          </div>
        ) : null}

        {reviewError ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" aria-hidden="true" />
            <span>{reviewError}</span>
          </div>
        ) : null}

        {chatTurns.map((turn, index) =>
          turn.role === "user" ? (
            <UserBubble key={turn.id ?? `${turn.role}-${index}`}>
              {turn.content}
            </UserBubble>
          ) : turn.role === "review" ? (
            <ReviewTurn
              canOpenFailedCase={Boolean(
                turn.runResult.firstFailedCase &&
                visibleTestCaseIdSet.has(turn.runResult.firstFailedCase.id),
              )}
              key={turn.id}
              isNewlyCreated={
                (turn.reviewAttemptId ?? turn.id) ===
                newlyCreatedReviewAttemptId
              }
              onOpenFailedCase={onOpenFailedCase}
              onRevealReview={onRevealReview}
              revealedReviewAttemptIds={revealedReviewAttemptIds}
              turn={turn}
            />
          ) : (
            <AssistantBubble key={turn.id ?? `${turn.role}-${index}`}>
              <CompactMarkdown markdown={turn.content} />
              {"actionOutcomes" in turn && turn.actionOutcomes?.length ? (
                <ActionOutcomeCard
                  outcomes={turn.actionOutcomes}
                  onOpen={onOpenHandbook}
                />
              ) : null}
              {(!("actionOutcomes" in turn) || !turn.actionOutcomes?.length) &&
              "handbookCapture" in turn &&
              turn.handbookCapture ? (
                <HandbookCaptureChip
                  capture={turn.handbookCapture}
                  onOpen={onOpenHandbook}
                />
              ) : null}
              {(!("actionOutcomes" in turn) || !turn.actionOutcomes?.length) &&
              "mistakeBookCapture" in turn &&
              turn.mistakeBookCapture ? (
                <MistakeBookCaptureChip
                  capture={turn.mistakeBookCapture}
                  onOpen={onOpenHandbook}
                />
              ) : null}
            </AssistantBubble>
          ),
        )}

        {pendingPlannerOutcome ? (
          <PlannerOutcomeCard
            error={plannerOutcomeError}
            isSaving={isRecordingPlannerOutcome}
            onRecord={onRecordPlannerOutcome}
          />
        ) : null}

        {chatError ? (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" aria-hidden="true" />
            {chatError}
          </p>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-md border border-input bg-background p-2">
          <textarea
            aria-label="Coach follow-up message"
            className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 outline-none"
            disabled={isChatting}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                void onSendChatMessage();
              }
            }}
            placeholder="Ask coach..."
            value={chatInput}
          />
          <Button
            aria-label="Send coach message"
            disabled={isChatting || !chatInput.trim()}
            onClick={onSendChatMessage}
            size="icon"
            type="button"
          >
            {isChatting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

function PlannerOutcomeCard({
  error,
  isSaving,
  onRecord,
}: {
  error: string | null;
  isSaving: boolean;
  onRecord: (rating: "easy" | "hesitated" | "struggled" | "unsolved") => void;
}) {
  const options: Array<{
    label: string;
    rating: "easy" | "hesitated" | "struggled" | "unsolved";
    variant: "default" | "secondary" | "outline";
  }> = [
    { label: "Easy", rating: "easy", variant: "default" },
    { label: "Hesitated", rating: "hesitated", variant: "secondary" },
    { label: "Struggled", rating: "struggled", variant: "outline" },
    { label: "Unsolved", rating: "unsolved", variant: "outline" },
  ];

  return (
    <div className="rounded-md border border-primary/25 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <NotebookPen
          className="mt-0.5 h-4 w-4 text-primary"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-semibold">Close this problem for Today</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Planner updates progress and review spacing only after your
            self-rating.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((option) => (
          <Button
            disabled={isSaving}
            key={option.rating}
            onClick={() => onRecord(option.rating)}
            size="sm"
            type="button"
            variant={option.variant}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {option.label}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReviewTurn({
  canOpenFailedCase,
  isNewlyCreated,
  onOpenFailedCase,
  onRevealReview,
  revealedReviewAttemptIds,
  turn,
}: {
  canOpenFailedCase: boolean;
  isNewlyCreated: boolean;
  onOpenFailedCase: (failedCaseId?: string) => void;
  onRevealReview: (reviewAttemptId: string) => void;
  revealedReviewAttemptIds: Set<string>;
  turn: Extract<WorkbenchChatTurn, { role: "review" }>;
}) {
  const revealKey = turn.reviewAttemptId ?? turn.id;
  const isRevealedInMemory = revealedReviewAttemptIds.has(revealKey);
  let storage: Storage | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    storage = null;
  }
  const isMasked =
    !isRevealedInMemory &&
    shouldMaskReviewReply({
      reviewAttemptId: revealKey,
      degraded: turn.degraded,
      isNewlyCreated,
      storage,
    });

  return (
    <>
      <RunSummaryCard
        canOpenFailedCase={canOpenFailedCase}
        onOpenFailedCase={() =>
          onOpenFailedCase(turn.runResult.firstFailedCase?.id)
        }
        result={turn.runResult}
      />
      <AssistantBubble>
        <ReviewMemoryBadge brief={turn.memoryBrief} />
        {isMasked ? (
          <ReviewReplyRevealMask onReveal={() => onRevealReview(revealKey)} />
        ) : (
          <CompactMarkdown markdown={turn.content} />
        )}
      </AssistantBubble>
    </>
  );
}

export function ReviewMemoryBadge({
  brief,
}: {
  brief?: WorkbenchCoachMemoryBrief;
}) {
  const groupedMemories = groupReviewBadgeMemories(brief);
  if (groupedMemories.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {groupedMemories.map((group) => (
        <div className="flex flex-wrap items-center gap-2" key={group.label}>
          <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
            {group.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {group.sourceLabels.join(", ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function groupReviewBadgeMemories(brief?: WorkbenchCoachMemoryBrief) {
  const groups = new Map<string, string[]>();
  for (const memory of brief?.teachableMemories ?? []) {
    if (memory.applicability === "teaching_style_only") continue;
    const sourceLabel = memory.sourceLabel.trim();
    if (!sourceLabel) continue;
    const label = memoryBadgeLabel(memory.learnerSignalBasis);
    groups.set(label, [...(groups.get(label) ?? []), sourceLabel]);
  }

  return [...groups].map(([label, sourceLabels]) => ({
    label,
    sourceLabels: [...new Set(sourceLabels)].slice(0, 2),
  }));
}

function memoryBadgeLabel(
  basis: WorkbenchCoachMemoryBrief["teachableMemories"][number]["learnerSignalBasis"],
) {
  if (basis === "self_reported") return "Uses your self-reported profile";
  if (basis === "saved_by_learner") return "Uses your saved notes";
  return "Uses your practice history";
}

function ReviewReplyRevealMask({ onReveal }: { onReveal: () => void }) {
  return (
    <div
      aria-label="Hidden coach review reply"
      className="rounded-md border border-border bg-muted/25 p-3"
    >
      <div aria-hidden="true" className="space-y-2">
        <div className="h-3 w-3/4 rounded bg-muted-foreground/20 blur-[1px]" />
        <div className="h-3 w-full rounded bg-muted-foreground/15 blur-[1px]" />
        <div className="h-3 w-5/6 rounded bg-muted-foreground/15 blur-[1px]" />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Coach feedback is ready when you want to review it.
        </p>
        <Button onClick={onReveal} size="sm" type="button" variant="outline">
          Reveal coach feedback
        </Button>
      </div>
    </div>
  );
}

function RunSummaryCard({
  canOpenFailedCase,
  onOpenFailedCase,
  result,
}: {
  canOpenFailedCase: boolean;
  onOpenFailedCase: () => void;
  result: CodeRunResult;
}) {
  return (
    <div
      aria-label="Run summary card"
      className="rounded-md border border-border bg-muted/25 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-background">
          <Play className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Run summary card</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {runSummary(result)}
          </p>
          <ErrorDetailBlock result={result} />
          {result.firstFailedCase && canOpenFailedCase ? (
            <button
              className="mt-2 text-sm font-medium text-primary"
              onClick={onOpenFailedCase}
              type="button"
            >
              Open the failed case in Tests
            </button>
          ) : null}
          {result.firstFailedCase ? (
            <div className="mt-3 rounded-md border border-border bg-background/70 p-2 text-xs">
              <p className="font-medium">
                First failed: {result.firstFailedCase.label}
              </p>
              <p className="mt-1 text-muted-foreground">
                expected {compactValue(result.firstFailedCase.expected)} ·
                actual{" "}
                {compactValue(
                  result.firstFailedCase.actual ?? result.firstFailedCase.error,
                )}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-label="Coach chat reply"
      className="flex items-start gap-3 text-sm leading-6"
    >
      <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-violet-200 bg-violet-100 text-violet-700">
        <Bot className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 rounded-md border border-border bg-background p-4">
        {children}
      </div>
    </div>
  );
}

function HandbookCaptureChip({
  capture,
  onOpen,
}: {
  capture: WorkbenchHandbookCapture;
  onOpen: (href: string) => Promise<void>;
}) {
  const [removed, setRemoved] = useState(false);
  const [openingHref, setOpeningHref] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  if (removed) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Removed from Knowledge Handbook.
      </p>
    );
  }

  async function remove() {
    setIsRemoving(true);
    try {
      await fetch("/api/handbook/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: capture.noteId }),
      });
      setRemoved(true);
    } finally {
      setIsRemoving(false);
    }
  }

  async function open(href: string) {
    setOpeningHref(href);
    try {
      await onOpen(href);
    } finally {
      setOpeningHref(null);
    }
  }

  const editHref = `/handbook?edit=${encodeURIComponent(capture.noteId)}`;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <NotebookPen
          className="h-3.5 w-3.5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span className="truncate">
          Saved to Knowledge Handbook: {capture.title} (lookup #{capture.lookupCount})
        </span>
      </span>
      <button
        className="text-primary hover:underline disabled:cursor-wait disabled:opacity-60"
        disabled={openingHref !== null}
        onClick={() => void open("/handbook")}
        type="button"
      >
        {openingHref === "/handbook" ? "Saving..." : "View"}
      </button>
      <button
        className="text-primary hover:underline disabled:cursor-wait disabled:opacity-60"
        disabled={openingHref !== null}
        onClick={() => void open(editHref)}
        type="button"
      >
        {openingHref === editHref ? "Saving..." : "Edit"}
      </button>
      <button
        className="text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isRemoving}
        onClick={remove}
        type="button"
      >
        Delete
      </button>
    </div>
  );
}

function MistakeBookCaptureChip({
  capture,
  onOpen,
}: {
  capture: WorkbenchMistakeBookCapture;
  onOpen: (href: string) => Promise<void>;
}) {
  const [openingHref, setOpeningHref] = useState<string | null>(null);

  async function open(href: string) {
    setOpeningHref(href);
    try {
      await onOpen(href);
    } finally {
      setOpeningHref(null);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <NotebookPen
          className="h-3.5 w-3.5 shrink-0 text-emerald-700"
          aria-hidden="true"
        />
        <span className="truncate">
          Saved to Mistake Book: {capture.title} (save #{capture.saveCount})
        </span>
      </span>
      <button
        className="text-emerald-700 hover:underline disabled:cursor-wait disabled:opacity-60"
        disabled={openingHref !== null}
        onClick={() => void open("/notebook")}
        type="button"
      >
        {openingHref === "/notebook" ? "Opening..." : "View Mistake Book"}
      </button>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-label="User chat message"
      className="ml-auto max-w-[88%] rounded-md border border-border bg-muted/40 p-3 text-sm leading-6"
    >
      {children}
    </div>
  );
}

function FloatingNotes() {
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState(defaultNotes);
  const [position, setPosition] = useState<NotePosition>({ x: 44, y: 620 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<NotePosition>({ x: 0, y: 0 });

  useEffect(() => {
    window.setTimeout(() => {
      const storedNotes = window.localStorage.getItem(notesStorageKey);
      const storedPosition = window.localStorage.getItem(
        notesPositionStorageKey,
      );

      if (storedNotes) {
        setNotes(storedNotes);
      }

      if (storedPosition) {
        try {
          const parsed = JSON.parse(storedPosition) as NotePosition;

          if (typeof parsed.x === "number" && typeof parsed.y === "number") {
            setPosition(parsed);
          }
        } catch {
          setPosition({ x: 44, y: 112 });
        }
      } else {
        setPosition({ x: 44, y: 112 });
      }
    }, 0);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(notesStorageKey, notes);
  }, [notes]);

  useEffect(() => {
    window.localStorage.setItem(
      notesPositionStorageKey,
      JSON.stringify(position),
    );
  }, [position]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setIsOpen(true);
        requestAnimationFrame(() => {
          document.getElementById("floating-notes-content")?.focus();
        });
      }
    };

    window.addEventListener("keydown", handleShortcut);

    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleMove = (event: PointerEvent) => {
      setPosition({
        x: Math.max(12, event.clientX - dragOffsetRef.current.x),
        y: Math.max(76, event.clientY - dragOffsetRef.current.y),
      });
    };
    const handleUp = () => setIsDragging(false);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [isDragging]);

  const startDragging = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragOffsetRef.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
    setIsDragging(true);
  };

  return (
    <>
      {isOpen ? (
        <aside
          aria-label="Floating notes"
          className="fixed z-50 flex h-[282px] w-[348px] flex-col rounded-md border border-amber-200 bg-[#fff4bd] shadow-xl"
          style={{ left: position.x, top: position.y }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-amber-200/80 px-3 py-2">
            <button
              aria-label="Drag notes board"
              className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left text-sm font-semibold active:cursor-grabbing"
              onPointerDown={startDragging}
              type="button"
            >
              <NotebookPen className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                Notes Board (floating · draggable · global)
              </span>
              <GripVertical
                className="ml-auto h-4 w-4 shrink-0 text-amber-700/70"
                aria-hidden="true"
              />
            </button>
            <Button
              aria-label="Close notes board"
              className="h-7 w-7"
              onClick={() => setIsOpen(false)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <textarea
            aria-label="Notes board content"
            className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-7 text-amber-950 outline-none"
            id="floating-notes-content"
            onChange={(event) => setNotes(event.target.value)}
            value={notes}
          />
          <div className="border-t border-amber-200/80 px-4 py-3 text-xs text-amber-800/75">
            Cmd+J open · auto saved
          </div>
        </aside>
      ) : null}

      <Button
        aria-label="Toggle notes board"
        className="fixed bottom-5 left-20 z-50 rounded-full shadow-lg"
        onClick={() => setIsOpen((current) => !current)}
        size="icon"
        type="button"
      >
        {isOpen ? (
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    </>
  );
}
