import prisma from "@/server/db/prisma";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
} from "@/server/code/code-hash";
import {
  appendTraceEventBestEffort,
  createTraceContext,
} from "@/server/llm/trace-context";
import { ensureWorkspaceTraceTurnBestEffort } from "@/server/observability/workspace-trace-finalize";
import type { WorkspaceTraceTurnInfo } from "@/server/observability/runtime-trace-request";
import {
  getLocalUserAndProfile,
  loadSelectedVisibleTests,
  parseJson,
} from "./review-pipeline";
import {
  chatRequestSchema,
  type ChatReplyDeps,
} from "./chat-reply-contracts";
import { getOrCreateChatSession, resolveChatFtsStore } from "./chat-session";
import { attachChatTraceReferencesBestEffort } from "./chat-provider-call";

export async function bootstrapChatTurn(
  rawInput: unknown,
  deps: ChatReplyDeps,
) {
  const pathStartedAt = Date.now();
  const db = deps.prisma ?? prisma;
  const input = chatRequestSchema.parse(rawInput);
  const ftsStore = resolveChatFtsStore(deps);
  const { user, profile } = await getLocalUserAndProfile(db);
  const { problem, chatSession } = await getOrCreateChatSession(
    { userId: user.id, input },
    db,
  );
  const problemTags = parseJson<string[]>(problem.tags, []);
  const selectedTestCases = await loadSelectedVisibleTests(
    {
      problemId: problem.id,
      userId: user.id,
      selectedTestCaseIds: input.selectedTestCaseIds,
    },
    db,
  );
  const workspaceTraceTurn = await ensureTraceTurn({
    db,
    deps,
    input,
    userId: user.id,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    selectedTestCases,
  });
  const traceContext = createTraceContext({
    prisma: db,
    userId: user.id,
    path: "chat",
    task: "chat.tool_loop.turn",
    problemId: problem.id,
    chatSessionId: chatSession.id,
    ...traceContextFields(workspaceTraceTurn),
  });
  return {
    pathStartedAt,
    db,
    deps,
    backgroundJobsDisabled: deps.backgroundJobsPolicy === "disabled",
    input,
    ftsStore,
    user,
    profile,
    problem,
    chatSession,
    problemTags,
    selectedTestCases,
    workspaceTraceTurn,
    workspaceTraceInfo: workspaceTraceInfo(workspaceTraceTurn),
    traceContext,
  };
}

type BootstrapArgs = {
  db: typeof prisma;
  deps: ChatReplyDeps;
  input: ReturnType<typeof chatRequestSchema.parse>;
  userId: string;
  problemId: string;
  chatSessionId: string;
  selectedTestCases: Awaited<ReturnType<typeof loadSelectedVisibleTests>>;
};

async function ensureTraceTurn(args: BootstrapArgs) {
  if (!args.input.browserInstanceId) return { enabled: false } as const;
  return ensureWorkspaceTraceTurnBestEffort(args.db, {
    userId: args.userId,
    problemId: args.problemId,
    browserInstanceId: args.input.browserInstanceId,
    action: "chat",
    cutoverEnabled: args.deps.traceStoreCutoverEnabled,
    snapshot: buildTraceSnapshot(args),
  });
}

function buildTraceSnapshot(args: BootstrapArgs) {
  const revision = revisionHashes(args.input.language, args.input.code);
  return {
    language: args.input.language,
    code: args.input.code,
    ...revision,
    selectedTestCaseIds: args.selectedTestCases.map((testCase) => testCase.id),
    testContext: args.selectedTestCases.map((testCase) => ({
      id: testCase.id,
      label: testCase.label,
      input: testCase.input,
      expected: testCase.expected,
      source: testCase.source,
    })),
    clientOccurredAt: args.input.clientOccurredAt,
    metadata: {
      instrumentationPhase: "phase4_foreground",
      chatSessionId: args.chatSessionId,
      messageLength: args.input.message.length,
    },
  };
}

function revisionHashes(
  language: ReturnType<typeof chatRequestSchema.parse>["language"],
  code: string | undefined,
) {
  if (!language || code === undefined) {
    return { codeHash: undefined, executionFingerprint: undefined };
  }
  return {
    codeHash: hashCodeForRun({ language, code }),
    executionFingerprint: fingerprintCodeForExecution({ language, code }),
  };
}

function traceContextFields(
  turn: Awaited<ReturnType<typeof ensureTraceTurn>>,
) {
  return turn.enabled
    ? {
        traceRunId: turn.traceRunId,
        workspaceSessionId: turn.workspaceSessionId,
        turnOrdinal: turn.turnOrdinal,
        captureLevel: turn.captureLevel,
        memoryOrigin: turn.memoryOrigin,
        initialTraceOverheadMs: turn.initialTraceOverheadMs,
      }
    : {};
}

function workspaceTraceInfo(
  turn: Awaited<ReturnType<typeof ensureTraceTurn>>,
): WorkspaceTraceTurnInfo | undefined {
  return turn.enabled
    ? {
        workspaceSessionId: turn.workspaceSessionId,
        traceRunId: turn.traceRunId,
        turnOrdinal: turn.turnOrdinal,
      }
    : undefined;
}

export async function traceChatTurnInput(
  turn: Awaited<ReturnType<typeof bootstrapChatTurn>>,
) {
  if (turn.workspaceTraceTurn.enabled) {
    await attachChatTraceReferencesBestEffort(
      turn.traceContext,
      turn.chatSession.id,
    );
  }
  const revision = revisionHashes(turn.input.language, turn.input.code);
  await appendTraceEventBestEffort(turn.traceContext, {
    stage: "input_workspace_context",
    kind: "user_input",
    title: "Coach message and current workspace context",
    status: "succeeded",
    details: {
      input: {
        message: turn.input.message,
        language: turn.input.language ?? null,
        codeHash: revision.codeHash ?? null,
        executionFingerprint: revision.executionFingerprint ?? null,
        codeLength: turn.input.code?.length ?? 0,
        selectedTestCaseIds: turn.selectedTestCases.map((testCase) => testCase.id),
      },
      metadata: {
        source: "chat_reply",
        chatSessionId: turn.chatSession.id,
        problemId: turn.problem.id,
        clientOccurredAt: turn.input.clientOccurredAt ?? null,
      },
    },
  });
}

export type BootstrappedChatTurn = Awaited<ReturnType<typeof bootstrapChatTurn>>;
