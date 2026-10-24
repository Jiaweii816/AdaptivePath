import type { PrismaClient } from "@prisma/client";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import type { TraceContext } from "@/server/llm/trace-context";
import type { SafeProtocolLeakSummary } from "@/server/llm/tool-protocol-leak";
import { buildWorkspaceMetadata } from "./current-workspace-context";
import { getNextChatSequence } from "./review-pipeline";
import type { BootstrappedChatTurn } from "./chat-turn-bootstrap";
import type { LoadedChatTurnContext, FinalChatTurnContext } from "./chat-turn-context";
import type { ChatLoopResult, GuardedChatReply } from "./chat-tool-loop";
import { buildReplyEvidenceBoundaryMetadata } from "./chat-tool-observation";
import { collectPlannedStrategyTags } from "./chat-consolidation";

export async function persistChatUserMessage(
  turn: BootstrappedChatTurn,
  context: LoadedChatTurnContext,
  onCreated?: (id: string) => void,
) {
  const startedAt = Date.now();
  const sequence = await getNextChatSequence(turn.chatSession.id, turn.db);
  turn.traceContext.messageSequence = sequence;
  const message = await turn.db.chatMessage.create({
    data: {
      sessionId: turn.chatSession.id,
      role: "user",
      contentMarkdown: turn.input.message,
      sequence,
      memoryOrigin: turn.traceContext.memoryOrigin,
      metadataJson: JSON.stringify({
        type: "chat_user_message",
        intent: context.preliminaryInteractionState.policy.intent,
        intentConfidence: context.preliminaryInteractionState.policy.confidence,
        codeDisclosure: context.preliminaryInteractionState.turnPlan.codeDisclosure,
        workspace: context.initialWorkspaceMetadata,
      }),
    },
  });
  onCreated?.(message.id);
  const semanticTrace = await appendUserSemanticTrace(turn, context, message);
  await appendTraceEventBestEffort(turn.traceContext, {
    stage: "persistence",
    kind: "persistence",
    title: "Persist user chat message",
    status: "succeeded",
    durationMs: Date.now() - startedAt,
    details: {
      output: {
        chatMessageId: message.id,
        semanticTraceEventId: semanticTrace.id,
        sequence: message.sequence,
      },
      metadata: {
        source: "chat_reply",
        chatSessionId: turn.chatSession.id,
        recordKinds: ["ChatMessage", "L1MemoryEvent"],
      },
    },
  });
  return message;
}

async function appendUserSemanticTrace(
  turn: BootstrappedChatTurn,
  context: LoadedChatTurnContext,
  message: Awaited<ReturnType<PrismaClient["chatMessage"]["create"]>>,
) {
  return appendL1TraceEvent(turn.db, {
    userId: turn.user.id,
    problemId: turn.problem.id,
    chatSessionId: turn.chatSession.id,
    eventType: "chat_user_message",
    source: "chat_reply",
    content: turn.input.message,
    occurredAt: message.createdAt,
    eventJson: {
      traceRunId: turn.traceContext.traceRunId,
      chatMessageId: message.id,
      sequence: message.sequence,
      responseLanguage: context.responseLanguage,
      intent: context.preliminaryInteractionState.policy.intent,
      codeDisclosure: context.preliminaryInteractionState.turnPlan.codeDisclosure,
      policy: {
        primaryGoal: context.preliminaryInteractionState.policy.primaryGoal,
        nextStepStyle: context.preliminaryInteractionState.policy.nextStepStyle,
      },
      workspace: context.initialWorkspaceMetadata,
    },
  });
}

export async function persistChatAssistantMessage(args: {
  turn: BootstrappedChatTurn;
  context: LoadedChatTurnContext;
  finalContext: FinalChatTurnContext;
  loop: ChatLoopResult;
  guarded: GuardedChatReply;
  userSequence: number;
  onCreated?: (id: string) => void;
}) {
  const startedAt = Date.now();
  const projection = assistantProjection(args);
  const message = await args.turn.db.chatMessage.create({
    data: {
      sessionId: args.turn.chatSession.id,
      role: "assistant",
      contentMarkdown: args.guarded.coachReply,
      sequence: args.userSequence + 1,
      memoryOrigin: args.turn.traceContext.memoryOrigin,
      metadataJson: JSON.stringify({ type: "chat_reply", ...projection }),
    },
  });
  args.onCreated?.(message.id);
  const semanticTrace = await appendAssistantSemanticTrace(args, message, projection);
  await appendProtocolTrace(args, message);
  const strategyTags = await appendStrategyTraces(args, message);
  await appendAssistantPersistenceTrace(args, message, semanticTrace.id, strategyTags.length, startedAt);
  return message;
}

function assistantProjection(args: Parameters<typeof persistChatAssistantMessage>[0]) {
  const runtimeSnapshot = args.loop.toolRuntime.snapshot();
  return {
    intent: args.finalContext.interactionState.policy.intent,
    codeDisclosure: args.finalContext.interactionState.turnPlan.codeDisclosure,
    deepReasoning: args.loop.deepReasoning,
    selfCorrectionMarkerDetected: args.loop.selfCorrectionMarkerDetected,
    toolCallCount: args.loop.toolTrace.length,
    toolIterations: args.loop.toolIterations,
    toolBudgetReached: args.loop.toolBudgetReached,
    toolRuntime: runtimeSnapshot,
    toolStopReason: args.loop.toolStopReason,
    requiredActions: args.loop.requiredActionProjection,
    actionOutcomes: args.loop.actionOutcomes,
    pendingModelPersists: args.context.pendingPersists,
    evidenceBoundary: buildReplyEvidenceBoundaryMetadata(args.loop.effectiveWorkspaceContext),
    productInvariantGuard: args.guarded.productInvariantGuardMetadata,
    workspace: buildWorkspaceMetadata(args.loop.effectiveWorkspaceContext),
  };
}

async function appendAssistantSemanticTrace(
  args: Parameters<typeof persistChatAssistantMessage>[0],
  message: Awaited<ReturnType<PrismaClient["chatMessage"]["create"]>>,
  projection: ReturnType<typeof assistantProjection>,
) {
  return appendL1TraceEvent(args.turn.db, {
    userId: args.turn.user.id,
    problemId: args.turn.problem.id,
    chatSessionId: args.turn.chatSession.id,
    eventType: "chat_reply",
    source: "chat_reply",
    content: args.guarded.coachReply,
    occurredAt: message.createdAt,
    eventJson: {
      traceRunId: args.turn.traceContext.traceRunId,
      chatMessageId: message.id,
      sequence: message.sequence,
      responseLanguage: args.context.responseLanguage,
      ...projection,
      timings: {
        totalMs: Date.now() - args.turn.pathStartedAt,
        llmMsTotal: args.turn.traceContext.llmMsTotal,
        toolMsTotal: args.turn.traceContext.toolMsTotal,
      },
    },
  });
}

async function appendProtocolTrace(
  args: Parameters<typeof persistChatAssistantMessage>[0],
  message: { id: string; sequence: number; createdAt: Date },
) {
  const violation = args.loop.protocolViolation;
  if (!violation) return;
  await appendL1TraceEvent(args.turn.db, {
    userId: args.turn.user.id,
    problemId: args.turn.problem.id,
    chatSessionId: args.turn.chatSession.id,
    eventType: "reply_protocol_replaced",
    source: "chat_reply",
    content: "Unsafe provider tool protocol content was replaced before display.",
    occurredAt: message.createdAt,
    eventJson: {
      assistantMessageId: message.id,
      assistantSequence: message.sequence,
      ...protocolFields(violation),
    },
  });
}

function protocolFields(violation: SafeProtocolLeakSummary) {
  return {
    sentinelIds: violation.sentinelIds,
    contentLength: violation.contentLength,
    contentSha256: violation.contentSha256,
    finishReason: violation.finishReason,
  };
}

async function appendStrategyTraces(
  args: Parameters<typeof persistChatAssistantMessage>[0],
  message: { id: string; sequence: number; createdAt: Date },
) {
  const tags = collectPlannedStrategyTags({
    teachingStrategies: [],
    sessionPlan: args.context.sessionPlan,
  });
  for (const strategyTag of tags) {
    await appendL1TraceEvent(args.turn.db, {
      userId: args.turn.user.id,
      problemId: args.turn.problem.id,
      chatSessionId: args.turn.chatSession.id,
      eventType: "strategy_planned",
      source: "chat_reply",
      content: `planned strategy ${strategyTag}`,
      occurredAt: message.createdAt,
      eventJson: {
        strategyTag,
        assistantMessageId: message.id,
        assistantSequence: message.sequence,
      },
    });
  }
  return tags;
}

async function appendAssistantPersistenceTrace(
  args: Parameters<typeof persistChatAssistantMessage>[0],
  message: { id: string; sequence: number },
  semanticTraceEventId: string,
  plannedStrategyCount: number,
  startedAt: number,
) {
  await appendTraceEventBestEffort(args.turn.traceContext, {
    stage: "persistence",
    kind: "persistence",
    title: "Persist visible Coach reply",
    status: "succeeded",
    durationMs: Date.now() - startedAt,
    details: {
      output: {
        assistantMessageId: message.id,
        semanticTraceEventId,
        sequence: message.sequence,
        plannedStrategyCount,
      },
      metadata: {
        source: "chat_reply",
        chatSessionId: args.turn.chatSession.id,
        recordKinds: ["ChatMessage", "L1MemoryEvent"],
        visibleReplyPersisted: true,
      },
    },
  });
}

export async function deleteOrphanedChatMessageBestEffort(
  db: PrismaClient,
  traceContext: TraceContext,
  args: { role: "user" | "assistant"; chatMessageId: string | null },
) {
  const chatMessageId = args.chatMessageId;
  if (!chatMessageId) return;
  try {
    await db.chatMessage.delete({ where: { id: chatMessageId } });
  } catch (error) {
    console.error(
      `Failed to delete orphaned ${args.role} ChatMessage ${chatMessageId} after a failed chat turn; it may remain visible to future prompts.`,
      error,
    );
    await traceCompensatingDeleteFailure(
      traceContext,
      { role: args.role, chatMessageId },
      error,
    );
  }
}

async function traceCompensatingDeleteFailure(
  traceContext: TraceContext,
  args: { role: "user" | "assistant"; chatMessageId: string },
  error: unknown,
) {
  await appendTraceEventBestEffort(traceContext, {
    stage: "chat_turn",
    kind: "error",
    title: `Compensating delete failed for ${args.role} chat message`,
    status: "failed",
    details: {
      output: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      },
      metadata: {
        source: "chat_reply",
        role: args.role,
        chatMessageId: args.chatMessageId,
      },
    },
  });
}
