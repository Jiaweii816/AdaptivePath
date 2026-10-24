import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import { finalizeForegroundWorkspaceTrace } from "@/server/observability/workspace-trace-finalize";
import type {
  ChatReplyDeps,
  ChatReplyResult,
} from "./chat-reply-contracts";
import {
  bootstrapChatTurn,
  traceChatTurnInput,
} from "./chat-turn-bootstrap";
import {
  finalizeChatTurnContext,
  loadChatTurnContext,
} from "./chat-turn-context";
import {
  deleteOrphanedChatMessageBestEffort,
  persistChatAssistantMessage,
  persistChatUserMessage,
} from "./chat-message-persistence";
import {
  guardChatToolLoopResult,
  runChatToolLoop,
} from "./chat-tool-loop";
import { enqueueOperationalAggregation } from "@/server/jobs/enqueue-operational-aggregation";

export async function executeChatReply(
  rawInput: unknown,
  deps: ChatReplyDeps = {},
): Promise<ChatReplyResult> {
  const turn = await bootstrapChatTurn(rawInput, deps);
  let traceOutcome: "succeeded" | "failed" | "degraded" = "failed";
  let persistedUserMessageId: string | null = null;
  let persistedAssistantMessageId: string | null = null;
  try {
    await traceChatTurnInput(turn);
    const context = await loadChatTurnContext(turn);
    const userMessage = await persistChatUserMessage(
      turn,
      context,
      (id) => { persistedUserMessageId = id; },
    );
    const finalContext = await finalizeChatTurnContext(turn, context);
    const loop = await runChatToolLoop({
      turn,
      context,
      finalContext,
      userMessage,
    });
    const guarded = await guardChatToolLoopResult({
      turn,
      context,
      finalContext,
      loop,
    });
    const assistantMessage = await persistChatAssistantMessage({
      turn,
      context,
      finalContext,
      loop,
      guarded,
      userSequence: userMessage.sequence,
      onCreated: (id) => { persistedAssistantMessageId = id; },
    });
    if (!turn.backgroundJobsDisabled && turn.workspaceTraceTurn.enabled && loop.toolTrace.some((entry) =>
      entry.disposition === "executed" &&
      (entry.name === "run_current_code" || entry.name === "verify_proposed_repair"),
    )) {
      await enqueueOperationalAggregation({
        prisma: turn.db,
        originatingTraceRunId: turn.workspaceTraceTurn.traceRunId,
        memoryOrigin: turn.workspaceTraceTurn.memoryOrigin ?? "legacy_unknown",
      }).catch((error) => console.error("Unable to enqueue operational aggregation.", { error }));
    }
    traceOutcome = loop.protocolViolation ? "degraded" : "succeeded";
    return buildResult(turn, userMessage.id, assistantMessage.id, loop, guarded);
  } catch (error) {
    await handleChatTurnFailure(turn, {
      error,
      persistedUserMessageId,
      persistedAssistantMessageId,
    });
    throw error;
  } finally {
    await finalizeForegroundWorkspaceTrace(
      turn.db,
      turn.workspaceTraceTurn,
      turn.traceContext,
      { status: traceOutcome },
    );
  }
}

function buildResult(
  turn: Awaited<ReturnType<typeof bootstrapChatTurn>>,
  userMessageId: string,
  assistantMessageId: string,
  loop: Awaited<ReturnType<typeof runChatToolLoop>>,
  guarded: Awaited<ReturnType<typeof guardChatToolLoopResult>>,
): ChatReplyResult {
  return {
    ok: true,
    chatSessionId: turn.chatSession.id,
    userMessageId,
    assistantMessageId,
    coachReply: guarded.coachReply,
    toolTrace: loop.toolTrace,
    toolIterations: loop.toolIterations,
    toolBudgetReached: loop.toolBudgetReached,
    toolRuntime: loop.toolRuntime.snapshot(),
    requiredActions: loop.requiredActionLedger.actions,
    actionOutcomes: loop.actionOutcomes,
    toolStopReason: loop.toolStopReason,
    productInvariantGuard: guarded.productInvariantGuardMetadata,
    trace: turn.workspaceTraceInfo,
  };
}

async function handleChatTurnFailure(
  turn: Awaited<ReturnType<typeof bootstrapChatTurn>>,
  args: {
    error: unknown;
    persistedUserMessageId: string | null;
    persistedAssistantMessageId: string | null;
  },
) {
  await deleteOrphanedChatMessageBestEffort(turn.db, turn.traceContext, {
    role: "assistant",
    chatMessageId: args.persistedAssistantMessageId,
  });
  await deleteOrphanedChatMessageBestEffort(turn.db, turn.traceContext, {
    role: "user",
    chatMessageId: args.persistedUserMessageId,
  });
  await appendTraceEventBestEffort(turn.traceContext, {
    stage: "chat_turn",
    kind: "error",
    title: "Chat turn failed",
    status: "failed",
    details: {
      output: errorOutput(args.error),
      metadata: {
        source: "chat_reply",
        chatSessionId: turn.chatSession.id,
        rolledBackUserMessageId: args.persistedUserMessageId,
        rolledBackAssistantMessageId: args.persistedAssistantMessageId,
      },
    },
  });
}

function errorOutput(error: unknown) {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
  };
}
