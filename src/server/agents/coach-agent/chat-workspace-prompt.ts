import { toCoachRunEvidenceView } from "./authoritative-run-context";
import type {
  ChatTurnContextNeeds,
  CoachChatInput,
  CurrentWorkspaceContext,
} from "./coach-agent.types";
import { CHAT_CURRENT_CODE_PROMPT_LIMIT } from "./current-workspace-context";
import type { TurnUnderstanding } from "./turn-understanding/turn-understanding.types";

export function formatProblemContext(
  input: CoachChatInput,
  understanding?: TurnUnderstanding,
) {
  const hasLookup = input.turnUnderstandingV2
    ? input.turnUnderstandingV2.requests.some(
        (request) => request.kind === "respond" && request.target === "api",
      )
    : understanding?.operations.some(({ family }) => family === "lookup_api") ??
      false;
  const lines: string[] = [];
  const language = input.workspaceContext?.language;
  if (hasLookup && language) lines.push(`[API CONTEXT] language=${language}`);
  const workspaceProblem = input.workspaceContext?.problem;
  const problem = workspaceProblem ?? input.problem;
  const statement =
    workspaceProblem?.statementMarkdown?.trim() ??
    input.problem.statementMarkdown?.trim() ??
    "";
  const examples =
    workspaceProblem?.examples?.slice(0, 2) ??
    input.problem.examples?.slice(0, 2) ??
    [];
  const constraints =
    workspaceProblem?.constraints ?? input.problem.constraints ?? [];
  lines.push(
    "[ACTIVE PROBLEM CARD — highest-authority problem truth]",
    `${problem.leetcodeNumber ?? "?"}. ${problem.title} (${problem.slug})`,
    `method=${problem.methodName}; tags=${problem.tags.join(", ") || "none"}; current_code_present=${Boolean(input.workspaceContext?.currentCode.trim())}`,
    "Statement:",
    truncateProblemStatement(statement),
    "Examples (first 2):",
    examples.length > 0 ? JSON.stringify(examples) : "none available",
    "Constraints:",
    constraints.length > 0 ? JSON.stringify(constraints) : "none available",
  );
  return lines.length > 0 ? ["", ...lines] : [];
}

export function formatConditionalWorkspaceContext(
  input: CoachChatInput,
  contextNeeds: ChatTurnContextNeeds,
) {
  const workspace = input.workspaceContext;
  if (!workspace) {
    return [
      "[CURRENT CODE — authoritative editor truth]",
      "Workspace unavailable for this turn.",
      "[LATEST ALIGNED RUN — authoritative observed behavior]",
      "none",
    ];
  }

  const lines = [
    "[CURRENT CODE — authoritative editor truth]",
    JSON.stringify({
      language: workspace.language ?? null,
      codeState: workspace.codeState,
      currentCodeSummary: workspace.currentCodeSummary,
      currentCodeAuthoritativeRunStatus:
        workspace.currentCodeAuthoritativeRunStatus,
    }),
  ];

  if (shouldIncludeFullCurrentCode(input, contextNeeds)) {
    lines.push(
      `Current editor code (truncated=${workspace.currentCodeTruncated}):`,
      "```",
      workspace.currentCode.slice(0, CHAT_CURRENT_CODE_PROMPT_LIMIT),
      "```",
    );
  } else {
    lines.push(
      "Current editor code summary (full text omitted because the response target is non-current):",
      workspace.currentCodeSummary,
    );
  }

  if (contextNeeds.selectedTests) {
    lines.push(
      `[SELECTED TESTS] ${JSON.stringify(
        workspace.selectedTests.map((test) => ({
          id: test.id,
          label: test.label,
          source: test.source,
          input: test.input,
          expected: test.expected,
        })),
      )}`,
    );
  }

  lines.push(...formatAlignedRunLines(workspace));

  if (contextNeeds.reviewContext && workspace.latestReviewContext) {
    lines.push(
      `[LATEST ALIGNED REVIEW] ${JSON.stringify(workspace.latestReviewContext)}`,
    );
  }

  return lines;
}

/** Three-valued evidence projection is exported to lock its prompt contract. */
export function formatAlignedRunLines(workspace: CurrentWorkspaceContext) {
  const alignment = workspace.latestRunAlignment;
  const alignedRun =
    (alignment === "exact" || alignment === "code_aligned_suite_drifted") &&
    workspace.latestAuthoritativeRunEvidence
      ? toCoachRunEvidenceView(workspace.latestAuthoritativeRunEvidence)
      : null;
  const lines = [
    "[LATEST ALIGNED RUN — authoritative observed behavior]",
    alignedRun ? JSON.stringify(alignedRun) : "none",
  ];
  if (alignment === "code_aligned_suite_drifted") {
    lines.push(
      "[SUITE DRIFT NOTICE] This run used a different selected test suite. It says nothing about selected tests it did not cover; re-run before making claims about them.",
    );
  }
  if (alignment === "stale") {
    lines.push(
      "[INVALIDATED EVIDENCE NOTICE] An earlier run exists, but the code changed since it ran. Its conclusions are void; re-run before asserting current behavior.",
    );
  }
  lines.push(...resumedWorkingRunLines(workspace));
  lines.push(
    "[CURRENT-TURN OBSERVATIONS — scoped and advisory]",
    "New observations are delivered once through appended tool messages.",
  );
  return lines;
}

function resumedWorkingRunLines(workspace: CurrentWorkspaceContext) {
  const evidence = workspace.resumedWorkingRunEvidence;
  const alignment = workspace.resumedWorkingRunAlignment;
  if (!evidence || (alignment !== "exact" && alignment !== "code_aligned_suite_drifted")) {
    return [];
  }
  return [
    `[RESUMED WORKING RUN — advisory, alignment=${alignment}]`,
    JSON.stringify(toCoachRunEvidenceView(evidence)),
    "This earlier tool run is for the same code. Reuse it instead of re-running, but never present it as a pass/fail verdict.",
  ];
}

const PROBLEM_STATEMENT_PROMPT_LIMIT = 1_500;

function truncateProblemStatement(statement: string) {
  if (!statement) return "unavailable";
  if (statement.length <= PROBLEM_STATEMENT_PROMPT_LIMIT) return statement;
  return `${statement.slice(0, PROBLEM_STATEMENT_PROMPT_LIMIT)}\n[Statement truncated for prompt budget.]`;
}

function shouldIncludeFullCurrentCode(
  input: CoachChatInput,
  contextNeeds: ChatTurnContextNeeds,
) {
  const requests = input.turnUnderstandingV2?.requests;
  if (!requests?.length)
    return contextNeeds.currentCode || contextNeeds.workspace;

  const respondRequests = requests.filter(
    (request) => request.kind === "respond",
  );
  if (respondRequests.length === 0) return false;
  return respondRequests.some((request) => isCurrentTarget(request));
}

function isCurrentTarget(request: unknown) {
  if (!request || typeof request !== "object") return true;
  const candidate = request as {
    target?: unknown;
    subject?: unknown;
  };
  if (candidate.target !== undefined) return candidate.target === "current";

  const subject = candidate.subject;
  if (typeof subject === "string") {
    return ![
      "concept",
      "api_object",
      "learner_profile",
      "practice_problem",
    ].includes(subject);
  }
  if (subject && typeof subject === "object") {
    const kind = (subject as { kind?: unknown }).kind;
    return ![
      "concept",
      "api_object",
      "learner_profile",
      "practice_problem",
      "learner_history",
      "learner_note",
    ].includes(String(kind));
  }
  return true;
}
