import type { PrismaClient } from "@prisma/client";

type L1TracePrisma = Pick<PrismaClient, "l1MemoryEvent">;

export async function getRecentL1Trace(
  prisma: L1TracePrisma,
  args: {
    userId: string;
    problemId?: string;
    chatSessionId?: string;
    reviewAttemptId?: string;
    limit?: number;
  },
) {
  const events = await prisma.l1MemoryEvent.findMany({
    where: {
      userId: args.userId,
      problemId: args.problemId,
      chatSessionId: args.chatSessionId,
      reviewAttemptId: args.reviewAttemptId,
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: args.limit ?? 50,
  });

  return events.reverse();
}
