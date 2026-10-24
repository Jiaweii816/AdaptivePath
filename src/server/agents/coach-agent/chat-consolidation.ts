import type { PrismaClient } from "@prisma/client";
import { enqueueChatConsolidation } from "@/server/jobs/enqueue-chat-consolidation";
import { evaluateChatConsolidationTrigger } from "@/server/memory/consolidation/triggers";
import { readEvidenceVerdict } from "@/lib/evidence-trust";
import type { TraceContext } from "@/server/llm/trace-context";
import type { SessionPlan } from "@/server/memory/memory.types";
import type { ChatReplyResult } from "./chat-reply-contracts";

export function collectPlannedStrategyTags(args: {
  teachingStrategies: Array<{ tag: string }>;
  sessionPlan?: SessionPlan;
}): string[] {
  return [
    ...new Set([
      ...args.teachingStrategies.map((strategy) => strategy.tag),
      ...(args.sessionPlan?.strategies.map((strategy) => strategy.tag) ?? []),
    ]),
  ];
}

export async function maybeEnqueueChatConsolidation(args: {
  prisma: PrismaClient;
  disabled: boolean;
  chatSessionId: string;
  lastConsolidatedMessageId: string | null;
  clearedBeforeSequence: number;
  intent: string;
  hintLevel: number;
  toolTrace: ChatReplyResult["toolTrace"];
  /** Relationally aligned learner Practice failure diagnosed by this reply. */
  alignedPracticeFailureDiagnosed?: boolean;
  traceContext?: TraceContext;
}) {
  if (args.disabled) return;
  const lastSequence = await loadLastConsolidatedSequence(args);
  const cursorSequence = Math.max(lastSequence, args.clearedBeforeSequence);
  const unconsolidatedUserTurns = await args.prisma.chatMessage.count({
    where: {
      sessionId: args.chatSessionId,
      role: "user",
      sequence: { gt: cursorSequence },
    },
  });
  const decision = evaluateChatConsolidationTrigger({
    unconsolidatedUserTurns,
    turnsSinceLastSuccess: unconsolidatedUserTurns,
    intent: args.intent,
    hintLevel: args.hintLevel,
    runCodeFailedInSegment: hasFailedRun(args.toolTrace),
    alignedPracticeFailureDiagnosed: args.alignedPracticeFailureDiagnosed,
    isBoundary: false,
    hasExplicitMemoryInstruction: args.toolTrace.some(
      (entry) => entry.name === "note_memory",
    ),
  });
  if (!decision.shouldConsolidate) return;
  await Promise.resolve(
    enqueueChatConsolidation(args.prisma, {
      chatSessionId: args.chatSessionId,
      triggerReason: decision.reason,
      originatingTraceRunId: args.traceContext?.traceRunId,
    }),
  ).catch((error) => {
    console.error("Unable to durably enqueue Chat consolidation.", {
      error,
      traceRunId: args.traceContext?.traceRunId,
      chatSessionId: args.chatSessionId,
    });
  });
}

async function loadLastConsolidatedSequence(
  args: Parameters<typeof maybeEnqueueChatConsolidation>[0],
) {
  if (!args.lastConsolidatedMessageId) return 0;
  const message = await args.prisma.chatMessage.findUnique({
    where: { id: args.lastConsolidatedMessageId },
  });
  return message?.sequence ?? 0;
}

function hasFailedRun(toolTrace: ChatReplyResult["toolTrace"]) {
  return toolTrace.some((entry) => {
    if (entry.name !== "run_current_code") return false;
    const verdict = readToolEvidenceVerdict(entry.result);
    if (!verdict?.capabilities.canUseFailureSalience) return false;
    return readToolRunStatus(entry.result)?.startsWith("passed") === false;
  });
}

function readToolEvidenceVerdict(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  return readEvidenceVerdict(
    (result as { evidenceVerdict?: unknown }).evidenceVerdict,
  );
}

function readToolRunStatus(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const runResult = (result as { runResult?: unknown }).runResult;
  if (!runResult || typeof runResult !== "object") return undefined;
  const status = (runResult as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}
