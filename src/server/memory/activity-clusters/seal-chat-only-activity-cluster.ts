import { parseMemoryOrigin } from "@/server/memory/memory-origin";
import type { ActivitySourceRef } from "./activity-cluster.types";
import type { ActivityClusterDb } from "./activity-source";
import { sealActivityCluster } from "./seal-activity-cluster";

export type ChatOnlyBoundaryReason =
  | "problem_changed"
  | "workbench_navigation"
  | "explicit_exit"
  | "chat_clear"
  | "stale_idle";

export type SealChatOnlyActivityClusterArgs = {
  chatSessionId: string;
  startMessageSequence: number;
  endMessageSequence: number;
  boundaryReason: ChatOnlyBoundaryReason;
  /** Practice runs and other immutable sources selected by workspace lineage. */
  additionalSourceItems?: ActivitySourceRef[];
  /** Caller may provide a workspace-scoped key; the sequence range is safe by default. */
  sourceKey?: string;
};

export async function sealChatOnlyActivityCluster(
  prisma: ActivityClusterDb,
  args: SealChatOnlyActivityClusterArgs,
) {
  if (
    !Number.isInteger(args.startMessageSequence) ||
    !Number.isInteger(args.endMessageSequence) ||
    args.startMessageSequence < 1 ||
    args.startMessageSequence > args.endMessageSequence
  ) {
    throw new Error("activity_message_range_invalid");
  }
  const session = await prisma.chatSession.findUnique({
    where: { id: args.chatSessionId },
  });
  if (!session) throw new Error(`chat_session_not_found:${args.chatSessionId}`);
  const messages = await prisma.chatMessage.findMany({
    where: {
      sessionId: session.id,
      memoryOrigin: session.memoryOrigin,
      sequence: {
        gte: args.startMessageSequence,
        lte: args.endMessageSequence,
      },
    },
    orderBy: { sequence: "asc" },
  });
  if (
    messages.length === 0 ||
    !messages.some((message) => message.role === "user")
  ) {
    throw new Error("chat_only_activity_requires_user_message");
  }
  if (messages.some((message) => message.reviewAttemptId !== null)) {
    throw new Error("chat_only_activity_contains_review_rooted_message");
  }
  if (
    messages[0]!.sequence !== args.startMessageSequence ||
    messages.at(-1)!.sequence !== args.endMessageSequence
  ) {
    throw new Error("chat_only_activity_message_range_has_gap_at_boundary");
  }

  return sealActivityCluster(prisma, {
    userId: session.userId,
    problemId: session.problemId,
    chatSessionId: session.id,
    rootReviewAttemptId: null,
    kind: "chat_only",
    sourceKey:
      args.sourceKey ??
      `chat:${session.id}:${args.startMessageSequence}-${args.endMessageSequence}`,
    memoryOrigin: parseMemoryOrigin(session.memoryOrigin),
    sourceItems: [
      ...messages.map(
        (message): ActivitySourceRef => ({
          sourceType: "chat_message",
          sourceId: message.id,
          evidenceRole:
            message.role === "user" ? "learner_action" : "coach_response",
        }),
      ),
      ...(args.additionalSourceItems ?? []),
    ],
    boundaryReason: args.boundaryReason,
  });
}
