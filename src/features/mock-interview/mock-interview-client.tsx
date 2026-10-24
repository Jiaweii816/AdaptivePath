"use client";

import { bffErrorMessage } from "@/features/workbench/bff-errors";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GripVertical,
  MessageSquareText,
  Play,
  Search,
  Send,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeDraftEditor } from "@/components/workbench/code-draft-editor";
import { ProblemStatement } from "@/components/workbench/problem-statement";
import { TagChip } from "@/components/shared/tag-chip";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { getCodeRunErrorDetail } from "@/lib/code-run-error-detail";
import { cn } from "@/lib/utils";
import type { CodeRunResult, CodeRunnerLanguage } from "@/types/code-runner";
import type {
  MockInterviewCompleteResponse,
  MockInterviewProblemDto,
  MockInterviewRunCodeResponse,
  MockInterviewSessionDto,
  MockInterviewStartResponse,
  MockInterviewTurnDto,
  MockInterviewTurnResponse,
} from "@/types/mock-interview";

type MockInterviewClientProps = {
  problems: MockInterviewProblemDto[];
  hasLeetCodeSession: boolean;
  initialProblemSlug?: string;
  initialPlanItemId?: string;
  initialTargetLabel: string;
};

type ApiErrorResponse = { ok: false; error?: string };

const phaseLabels: Record<MockInterviewSessionDto["currentPhase"], string> = {
  intro: "Intro",
  technical_screen: "Technical Screen",
  coding: "Coding",
  code_discussion: "Code Discussion",
  wrap_up: "Wrap Up",
};

const defaultInterviewWorkspaceWidth = 400;
const minInterviewWorkspaceWidth = 320;
const maxInterviewWorkspaceWidth = 680;
const minInterviewCodeWidth = 720;
const mockResizeHandleWidth = 12;
const defaultEvidenceWidth = 300;
const minEvidenceWidth = 260;
const maxEvidenceWidth = 480;
const minCodeEditorWidth = 620;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function problemLabel(problem: MockInterviewProblemDto) {
  const leetcodeLabel = problem.leetcodeNumber
    ? `LC ${problem.leetcodeNumber} · ${problem.title}`
    : problem.title;

  return problem.hot150Order
    ? `Hot 150 #${problem.hot150Order} · ${leetcodeLabel}`
    : leetcodeLabel;
}

function slugifyLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/^(lc|leetcode)\s*#?\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveProblemLookup(
  problems: MockInterviewProblemDto[],
  value: string,
) {
  const raw = value.trim();

  if (!raw) {
    return null;
  }

  const urlSlug = raw.match(/leetcode\.com\/problems\/([^/?#\s]+)/i)?.[1];
  const numeric = raw
    .replace(/^#/, "")
    .replace(/^(lc|leetcode)\s*#?\s*/i, "")
    .trim();

  if (/^\d+$/.test(numeric)) {
    const leetcodeNumber = Number(numeric);
    return (
      problems.find((candidate) => candidate.leetcodeNumber === leetcodeNumber) ??
      null
    );
  }

  const slug = slugifyLookup(urlSlug ?? raw);

  return (
    problems.find(
      (candidate) =>
        candidate.slug === slug || slugifyLookup(candidate.title) === slug,
    ) ?? null
  );
}

function codeFor(problem: MockInterviewProblemDto, language: CodeRunnerLanguage) {
  return problem.starterCode[language] ?? "";
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

function statusTone(status: CodeRunResult["status"]) {
  if (status === "passed_visible_tests") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "runner_error" || status === "compile_error") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
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
      return "Runner error";
    case "empty_code":
      return "Empty code";
    case "no_tests":
      return "No tests";
    case "unsupported_language":
      return "Unsupported language";
  }
}

function readApiError(data: ApiErrorResponse, fallback: string) {
  return bffErrorMessage(data) ?? (data.error?.trim() || fallback);
}

export function MockInterviewClient({
  problems,
  hasLeetCodeSession,
  initialProblemSlug,
  initialPlanItemId,
  initialTargetLabel,
}: MockInterviewClientProps) {
  const initialProblem =
    problems.find((problem) => problem.slug === initialProblemSlug) ??
    problems[0];
  const [selectedSlug, setSelectedSlug] = useState(initialProblem?.slug ?? "");
  const [activeProblem, setActiveProblem] =
    useState<MockInterviewProblemDto | null>(null);
  const [language, setLanguage] = useState<CodeRunnerLanguage>("Python");
  const [targetLabel, setTargetLabel] = useState(initialTargetLabel);
  const [session, setSession] = useState<MockInterviewSessionDto | null>(null);
  const [turns, setTurns] = useState<MockInterviewTurnDto[]>([]);
  const [code, setCode] = useState(
    initialProblem ? codeFor(initialProblem, "Python") : "",
  );
  const [message, setMessage] = useState("");
  const [problemQuery, setProblemQuery] = useState("");
  const [problemQueryError, setProblemQueryError] = useState<string | null>(
    null,
  );
  const [latestRun, setLatestRun] = useState<CodeRunResult | null>(null);
  const [report, setReport] = useState<MockInterviewCompleteResponse | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [workspaceWidth, setWorkspaceWidth] = useState(
    defaultInterviewWorkspaceWidth,
  );
  const [isWorkspaceResizeActive, setIsWorkspaceResizeActive] = useState(false);
  const activeLayoutRef = useRef<HTMLElement | null>(null);
  const workspaceResizeOriginRef = useRef({
    startX: 0,
    workspaceWidth: defaultInterviewWorkspaceWidth,
  });
  const selectedProblem = useMemo(
    () => problems.find((problem) => problem.slug === selectedSlug) ?? null,
    [problems, selectedSlug],
  );
  const problem = session ? activeProblem : selectedProblem;
  const selectedTestCaseIds =
    problem?.testCases.map((testCase) => testCase.id) ?? [];
  const isBlocked =
    Boolean(problem) && !hasLeetCodeSession && !problem?.isDemoSupported;
  const elapsedSeconds = session
    ? Math.max(0, Math.floor((now - new Date(session.startedAt).getTime()) / 1000))
    : 0;
  const remainingSeconds = session
    ? Math.max(0, session.durationMinutes * 60 - elapsedSeconds)
    : 25 * 60;
  const minutes = Math.floor(remainingSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (remainingSeconds % 60).toString().padStart(2, "0");
  const activeLayoutStyle = {
    "--mock-interview-workspace-width": `${workspaceWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isWorkspaceResizeActive) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const containerWidth =
        activeLayoutRef.current?.getBoundingClientRect().width ??
        window.innerWidth;
      const maxWidth = Math.max(
        minInterviewWorkspaceWidth,
        Math.min(
          maxInterviewWorkspaceWidth,
          containerWidth - minInterviewCodeWidth - mockResizeHandleWidth,
        ),
      );
      const delta = event.clientX - workspaceResizeOriginRef.current.startX;

      setWorkspaceWidth(
        clamp(
          workspaceResizeOriginRef.current.workspaceWidth + delta,
          minInterviewWorkspaceWidth,
          maxWidth,
        ),
      );
    };

    const handlePointerUp = () => setIsWorkspaceResizeActive(false);

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
  }, [isWorkspaceResizeActive]);

  const startWorkspaceResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    workspaceResizeOriginRef.current = {
      startX: event.clientX,
      workspaceWidth,
    };
    setIsWorkspaceResizeActive(true);
  };

  const changeSetupProblem = (slug: string) => {
    setSelectedSlug(slug);
    setProblemQuery("");
    setProblemQueryError(null);
    const nextProblem = problems.find((candidate) => candidate.slug === slug);

    if (!session && nextProblem) {
      setCode(codeFor(nextProblem, language));
    }
  };

  const chooseProblemFromQuery = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const match = resolveProblemLookup(problems, problemQuery);

    if (!problemQuery.trim()) {
      setProblemQueryError("Enter a LeetCode number or slug.");
      return;
    }

    if (!match) {
      setProblemQueryError(
        hasLeetCodeSession
          ? "Only Interview Hot 150 problems are available here."
          : "Only local demo problems are available without LeetCode mode.",
      );
      return;
    }

    changeSetupProblem(match.slug);
  };

  const changeLanguage = (nextLanguage: CodeRunnerLanguage) => {
    setLanguage(nextLanguage);

    if (!session && selectedProblem) {
      setCode(codeFor(selectedProblem, nextLanguage));
    }
  };

  const startInterview = async () => {
    if (!problem) {
      return;
    }

    setBusy("start");
    setError(null);

    try {
      const response = await fetch("/api/mock-interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemSlug: problem.slug,
          planItemId: initialPlanItemId,
          targetLabel,
          focusTags: problem.tags,
          language,
        }),
      });
      const data = (await response.json()) as
        | MockInterviewStartResponse
        | ApiErrorResponse;

      if (!data.ok) {
        throw new Error(readApiError(data, "Unable to start interview."));
      }
      if (!response.ok) {
        throw new Error("Unable to start interview.");
      }

      setSession(data.session);
      setActiveProblem(data.problem);
      setTurns([data.firstTurn]);
      setCode(codeFor(data.problem, data.session.language));
      setLatestRun(null);
      setReport(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to start interview.");
    } finally {
      setBusy(null);
    }
  };

  const sendResponse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session || !message.trim()) {
      return;
    }

    await postTurn("/api/mock-interview/respond", {
      sessionId: session.id,
      message,
    });
    setMessage("");
  };

  const runCode = async () => {
    if (!session) {
      return;
    }

    setBusy("run");
    setError(null);

    try {
      const response = await fetch("/api/mock-interview/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          language,
          code,
          selectedTestCaseIds,
        }),
      });
      const data = (await response.json()) as
        | MockInterviewRunCodeResponse
        | ApiErrorResponse;

      if (!data.ok) {
        throw new Error(readApiError(data, "Unable to run code."));
      }
      if (!response.ok) {
        throw new Error("Unable to run code.");
      }

      setLatestRun(data.runResult);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to run code.");
    } finally {
      setBusy(null);
    }
  };

  const sendCode = async () => {
    if (!session) {
      return;
    }

    await postTurn("/api/mock-interview/send-code", {
      sessionId: session.id,
      language,
      code,
      selectedTestCaseIds,
      message: "I am sending my current code for discussion.",
    });
  };

  const endInterview = async () => {
    if (!session) {
      return;
    }

    setBusy("complete");
    setError(null);

    try {
      const response = await fetch("/api/mock-interview/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const data = (await response.json()) as
        | MockInterviewCompleteResponse
        | ApiErrorResponse;

      if (!data.ok) {
        throw new Error(readApiError(data, "Unable to end interview."));
      }
      if (!response.ok) {
        throw new Error("Unable to end interview.");
      }

      setSession(data.session);
      setReport(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to end interview.");
    } finally {
      setBusy(null);
    }
  };

  const postTurn = async (url: string, body: unknown) => {
    setBusy(url);
    setError(null);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as
        | MockInterviewTurnResponse
        | ApiErrorResponse;

      if (!data.ok) {
        throw new Error(readApiError(data, "Unable to continue interview."));
      }
      if (!response.ok) {
        throw new Error("Unable to continue interview.");
      }

      setSession(data.session);
      setTurns((current) => [
        ...current,
        ...(data.candidateTurn ? [data.candidateTurn] : []),
        data.interviewerTurn,
      ]);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to continue interview.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (!problem) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No problems are available. Seed the database before starting a mock interview.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Mock Interview</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">
            Text coding screen
          </h1>
        </div>
        {session ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={phaseLabels[session.currentPhase]} />
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1 text-sm font-medium">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              {minutes}:{seconds}
            </span>
            <span className="rounded-md border border-border bg-card px-3 py-1 text-sm font-medium">
              {session.questionCount}/{session.maxQuestions} questions
            </span>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {!session ? (
        <section className="grid gap-4 rounded-lg border border-border bg-card p-5 lg:grid-cols-[1fr_1fr]">
          <div className="grid content-start gap-4">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Interview target</span>
              <Input
                onChange={(event) => setTargetLabel(event.target.value)}
                value={targetLabel}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Problem</span>
              <Select
                onValueChange={changeSetupProblem}
                value={selectedSlug}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {problems.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.slug}>
                      {problemLabel(candidate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <form
              className="grid gap-1 text-sm"
              onSubmit={chooseProblemFromQuery}
            >
              <span className="font-medium">LeetCode # / slug</span>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Input
                  aria-describedby={
                    problemQueryError
                      ? "mock-interview-problem-query-error"
                      : undefined
                  }
                  onChange={(event) => {
                    setProblemQuery(event.target.value);
                    setProblemQueryError(null);
                  }}
                  placeholder="1, LC 35, two-sum"
                  value={problemQuery}
                />
                <Button type="submit" variant="outline">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Use
                </Button>
              </div>
              {problemQueryError ? (
                <p
                  className="text-xs text-destructive"
                  id="mock-interview-problem-query-error"
                >
                  {problemQueryError}
                </p>
              ) : null}
            </form>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Language</span>
              <Select
                onValueChange={(value) =>
                  changeLanguage(value as CodeRunnerLanguage)
                }
                value={language}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Python">Python</SelectItem>
                  <SelectItem value="C++">C++</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {isBlocked ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                LeetCode mode is required for this non-demo problem. Choose a demo problem or enable the remote judge integration.
              </p>
            ) : null}
            <Button
              disabled={busy === "start" || isBlocked}
              onClick={startInterview}
              type="button"
            >
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />
              Start Interview
            </Button>
          </div>
          <ProblemBrief problem={problem} hasLeetCodeSession={hasLeetCodeSession} />
        </section>
      ) : (
        <section
          className="grid min-h-[calc(100vh-9rem)] gap-3 xl:grid-cols-[var(--mock-interview-workspace-width)_12px_minmax(0,1fr)]"
          ref={activeLayoutRef}
          style={activeLayoutStyle}
        >
          <InterviewWorkspacePanel
            busy={Boolean(busy)}
            completed={session.status === "completed"}
            hasLeetCodeSession={hasLeetCodeSession}
            message={message}
            onMessageChange={setMessage}
            onSend={sendResponse}
            problem={problem}
            session={session}
            turns={turns}
          />
          <MockResizeHandle
            ariaLabel="Resize conversation and code panels"
            isActive={isWorkspaceResizeActive}
            onPointerDown={startWorkspaceResize}
          />
          <CodePanel
            busy={busy}
            code={code}
            completed={session.status === "completed"}
            language={language}
            latestRun={latestRun}
            onCodeChange={setCode}
            onEnd={endInterview}
            onLanguageChange={changeLanguage}
            onRun={runCode}
            onSendCode={sendCode}
            problem={problem}
          />
        </section>
      )}

      {report ? <ReportPanel report={report} /> : null}
    </div>
  );
}

function ProblemBrief({
  hasLeetCodeSession,
  problem,
}: {
  hasLeetCodeSession: boolean;
  problem: MockInterviewProblemDto;
}) {
  return (
    <div className="max-h-[560px] overflow-y-auto rounded-md border border-border bg-muted/25 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={problem.difficulty ?? "Practice"} />
        {problem.hot150Section ? (
          <StatusBadge label={problem.hot150Section} />
        ) : null}
        <StatusBadge
          label={hasLeetCodeSession ? "LeetCode mode" : "Local demo mode"}
        />
      </div>
      <h2 className="mt-3 text-lg font-semibold">{problemLabel(problem)}</h2>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {problem.tags.slice(0, 6).map((tag) => (
          <TagChip key={tag} label={tag} />
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        This mode is intentionally less helpful during the interview. Run Code
        creates evidence; Send Code to Interviewer asks the interviewer to probe it.
      </p>
      <div className="mt-5 border-t border-border pt-4">
        <ProblemStatement dense problem={problem} showHeader={false} showTags={false} />
      </div>
    </div>
  );
}

function InterviewWorkspacePanel({
  busy,
  completed,
  hasLeetCodeSession,
  message,
  onMessageChange,
  onSend,
  problem,
  session,
  turns,
}: {
  busy: boolean;
  completed: boolean;
  hasLeetCodeSession: boolean;
  message: string;
  onMessageChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  problem: MockInterviewProblemDto;
  session: MockInterviewSessionDto;
  turns: MockInterviewTurnDto[];
}) {
  return (
    <section className="grid min-h-[620px] min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              {session.targetLabel ?? "Coding mock interview"}
            </p>
            <h2 className="mt-1 line-clamp-2 text-base font-semibold">
              {problemLabel(problem)}
            </h2>
          </div>
          <StatusBadge label={phaseLabels[session.currentPhase]} />
        </div>

        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <InfoRow label="Language" value={session.language} />
          <InfoRow
            label="Evidence"
            value={hasLeetCodeSession ? "Remote judge" : "Visible tests"}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(session.focusTags.length > 0 ? session.focusTags : problem.tags).map(
            (tag) => (
              <TagChip key={tag} label={tag} />
            ),
          )}
        </div>
      </div>

      <Tabs defaultValue="conversation" className="flex min-h-0 flex-col">
        <div className="border-b border-border px-3 py-2">
          <TabsList className="h-9 w-full justify-start rounded-md bg-muted/60 p-1">
            <TabsTrigger className="h-7 flex-1" value="conversation">
              Conversation
            </TabsTrigger>
            <TabsTrigger className="h-7 flex-1" value="problem">
              Problem
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          className="m-0 flex min-h-0 flex-1 flex-col rounded-none border-0 bg-transparent p-0"
          value="conversation"
        >
          <TranscriptPanel
            busy={busy}
            completed={completed}
            message={message}
            onMessageChange={onMessageChange}
            onSend={onSend}
            turns={turns}
          />
        </TabsContent>

        <TabsContent
          className="m-0 min-h-0 flex-1 overflow-y-auto rounded-none border-0 bg-transparent p-4"
          value="problem"
        >
          <ProblemStatement problem={problem} showHeader />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-muted/20 p-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function MockResizeHandle({
  ariaLabel,
  isActive,
  onPointerDown,
}: {
  ariaLabel: string;
  isActive: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className="group hidden min-h-0 cursor-col-resize items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring xl:flex"
      onPointerDown={onPointerDown}
      role="separator"
      title={ariaLabel}
      type="button"
    >
      <span
        className={cn(
          "flex h-20 w-2 items-center justify-center rounded-full border border-border bg-muted/50 transition-colors group-hover:border-primary/40 group-hover:bg-primary/10",
          isActive && "border-primary/50 bg-primary/15",
        )}
      >
        <GripVertical
          className={cn(
            "h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary",
            isActive && "text-primary",
          )}
          aria-hidden="true"
        />
      </span>
    </button>
  );
}

function TranscriptPanel({
  busy,
  completed,
  message,
  onMessageChange,
  onSend,
  turns,
}: {
  busy: boolean;
  completed: boolean;
  message: string;
  onMessageChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  turns: MockInterviewTurnDto[];
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] overflow-hidden">
      <div className="min-h-0 space-y-3 overflow-y-auto p-4">
        {turns.map((turn) => (
          <article
            className={cn(
              "rounded-md border p-3 text-sm leading-6",
              turn.role === "candidate"
                ? "border-sky-200 bg-sky-50 text-sky-950"
                : "border-border bg-muted/20",
            )}
            key={turn.id}
          >
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold">
                {turn.role === "candidate" ? "Candidate" : "Interviewer"}
              </span>
              <span className="text-muted-foreground">
                {phaseLabels[turn.phase]}
              </span>
            </div>
            <div className="text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {turn.contentMarkdown}
              </ReactMarkdown>
            </div>
          </article>
        ))}
      </div>
      <form className="border-t border-border p-3" onSubmit={onSend}>
        <div className="flex gap-2">
          <Input
            disabled={completed || busy}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Answer the interviewer..."
            value={message}
          />
          <Button disabled={completed || busy || !message.trim()} type="submit">
            <Send className="h-4 w-4" aria-hidden="true" />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function CodePanel({
  busy,
  code,
  completed,
  language,
  latestRun,
  onCodeChange,
  onEnd,
  onLanguageChange,
  onRun,
  onSendCode,
  problem,
}: {
  busy: string | null;
  code: string;
  completed: boolean;
  language: CodeRunnerLanguage;
  latestRun: CodeRunResult | null;
  onCodeChange: (value: string) => void;
  onEnd: () => void;
  onLanguageChange: (value: CodeRunnerLanguage) => void;
  onRun: () => void;
  onSendCode: () => void;
  problem: MockInterviewProblemDto;
}) {
  const [evidenceWidth, setEvidenceWidth] = useState(defaultEvidenceWidth);
  const [isEvidenceResizeActive, setIsEvidenceResizeActive] = useState(false);
  const codeLayoutRef = useRef<HTMLDivElement | null>(null);
  const evidenceResizeOriginRef = useRef({
    startX: 0,
    evidenceWidth: defaultEvidenceWidth,
  });

  useEffect(() => {
    if (!isEvidenceResizeActive) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const containerWidth =
        codeLayoutRef.current?.getBoundingClientRect().width ??
        window.innerWidth;
      const maxWidth = Math.max(
        minEvidenceWidth,
        Math.min(
          maxEvidenceWidth,
          containerWidth - minCodeEditorWidth - mockResizeHandleWidth,
        ),
      );
      const delta = event.clientX - evidenceResizeOriginRef.current.startX;

      setEvidenceWidth(
        clamp(
          evidenceResizeOriginRef.current.evidenceWidth - delta,
          minEvidenceWidth,
          maxWidth,
        ),
      );
    };

    const handlePointerUp = () => setIsEvidenceResizeActive(false);

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
  }, [isEvidenceResizeActive]);

  const startEvidenceResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    evidenceResizeOriginRef.current = {
      startX: event.clientX,
      evidenceWidth,
    };
    setIsEvidenceResizeActive(true);
  };

  const codeLayoutStyle = {
    "--mock-interview-evidence-width": `${evidenceWidth}px`,
  } as CSSProperties;

  return (
    <section className="grid min-h-[620px] min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Code Editor</h2>
          <p className="text-xs text-muted-foreground">
            {problem.testCases.length} visible tests available
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={completed}
            onValueChange={(value) =>
              onLanguageChange(value as CodeRunnerLanguage)
            }
            value={language}
          >
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Python">Python</SelectItem>
              <SelectItem value="C++">C++</SelectItem>
            </SelectContent>
          </Select>
          <Button
            disabled={completed || busy === "run"}
            onClick={onRun}
            size="sm"
            type="button"
            variant="outline"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Run
          </Button>
          <Button
            disabled={completed || Boolean(busy)}
            onClick={onSendCode}
            size="sm"
            type="button"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Send Code
          </Button>
          <Button
            disabled={completed || busy === "complete"}
            onClick={onEnd}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
            End
          </Button>
        </div>
      </div>

      <div
        className="grid min-h-0 gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_12px_var(--mock-interview-evidence-width)]"
        ref={codeLayoutRef}
        style={codeLayoutStyle}
      >
        <CodeDraftEditor
          className="min-h-[520px] xl:min-h-[620px]"
          code={code}
          language={language}
          onChange={onCodeChange}
        />
        <MockResizeHandle
          ariaLabel="Resize code editor and evidence panels"
          isActive={isEvidenceResizeActive}
          onPointerDown={startEvidenceResize}
        />
        <div className="grid min-h-0 content-start gap-3 overflow-hidden">
          <RunEvidencePanel result={latestRun} />
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <h3 className="text-sm font-semibold">Visible Tests</h3>
            <div className="mt-3 space-y-2">
              {problem.testCases.slice(0, 5).map((testCase) => (
                <div
                  className="rounded-md border border-border bg-card px-3 py-2 text-xs"
                  key={testCase.id}
                >
                  <p className="font-medium text-foreground">
                    {testCase.label}
                  </p>
                  <p className="mt-1 truncate font-mono text-muted-foreground">
                    {compactValue(testCase.input)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RunEvidencePanel({ result }: { result: CodeRunResult | null }) {
  if (!result) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        No run evidence yet.
      </div>
    );
  }

  const errorDetail = getCodeRunErrorDetail(result);

  return (
    <div className="grid gap-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium",
            statusTone(result.status),
          )}
        >
          {runStatusLabel(result.status)}
        </span>
        <span className="text-xs text-muted-foreground">
          {result.passedCount}/{result.passedCount + result.failedCount} passed
        </span>
      </div>
      {errorDetail ? (
        <div className="rounded-md border border-border bg-muted/20 p-2 text-xs">
          <p className="font-medium">{errorDetail.title}</p>
          <p className="mt-1 text-muted-foreground">{errorDetail.summary}</p>
          {errorDetail.nextStep ? (
            <p className="mt-1 text-muted-foreground">
              Next: {errorDetail.nextStep}
            </p>
          ) : null}
        </div>
      ) : null}
      {result.firstFailedCase ? (
        <div className="grid gap-1 rounded-md bg-muted/30 p-2 text-xs">
          <span className="font-medium">{result.firstFailedCase.label}</span>
          <span>Input: {compactValue(result.firstFailedCase.input)}</span>
          <span>Expected: {compactValue(result.firstFailedCase.expected)}</span>
          <span>
            Actual:{" "}
            {compactValue(
              result.firstFailedCase.actual ?? result.firstFailedCase.error,
            )}
          </span>
        </div>
      ) : null}
      {result.stderr ? (
        <pre className="max-h-24 overflow-auto rounded-md bg-muted/40 p-2 text-xs">
          {result.stderr}
        </pre>
      ) : null}
    </div>
  );
}

function ReportPanel({ report }: { report: MockInterviewCompleteResponse }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Interview Report</h2>
          <p className="text-sm text-muted-foreground">
            Signal: {report.report.overallSignal.replace(/_/g, " ")}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Saved
        </span>
      </div>
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {report.reportMarkdown}
        </ReactMarkdown>
      </div>
    </section>
  );
}
