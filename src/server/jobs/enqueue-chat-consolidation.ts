import type { PrismaClient } from "@prisma/client";
import {
  runChatConsolidation,
  type RunChatConsolidationArgs,
} from "@/server/memory/consolidation/consolidate-chat";
import type { TraceContext } from "@/server/llm/trace-context";
import {
  dispatchRecordedBackgroundJob,
  scheduleLegacyBackgroundWork,
  type BackgroundJobDispatchOptions,
  type BackgroundJobOrigin,
} from "./background-job-dispatch";

export type EnqueueChatConsolidationArgs = RunChatConsolidationArgs &
  Partial<BackgroundJobOrigin>;

type ClaimedChatConsolidationArgs = EnqueueChatConsolidationArgs & {
  traceContext: TraceContext;
  originatingTraceRunId: string;
};

export type EnqueueChatConsolidationOptions = BackgroundJobDispatchOptions & {
  run?: (
    prisma: PrismaClient,
    args: ClaimedChatConsolidationArgs,
  ) => Promise<unknown>;
};

export async function enqueueChatConsolidation(
  prisma: PrismaClient,
  args: EnqueueChatConsolidationArgs,
  options: EnqueueChatConsolidationOptions = {},
) {
  const run = options.run ?? runChatConsolidation;
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error("Chat consolidation failed.", {
        error,
        chatSessionId: args.chatSessionId,
      });
    });
  if (!args.originatingTraceRunId) {
    return scheduleLegacyBackgroundWork({
      schedule: options.schedule,
      run: () => run(prisma, args as ClaimedChatConsolidationArgs),
      onError,
    });
  }
  return dispatchRecordedBackgroundJob({
    prisma,
    kind: "chat_consolidation",
    task: "memory.consolidate_chat",
    origin: {
      originatingTraceRunId: args.originatingTraceRunId,
      parentTraceRunId: args.parentTraceRunId,
    },
    options: {
      schedule: options.schedule,
      processInstanceId: options.processInstanceId,
      traceRunId: options.traceRunId,
      onError,
    },
    run: ({ traceContext, originatingTraceRunId, parentTraceRunId }) =>
      run(prisma, {
        ...args,
        traceContext,
        originatingTraceRunId,
        parentTraceRunId,
      }),
  });
}
