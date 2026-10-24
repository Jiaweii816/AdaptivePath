import type { PrismaClient } from "@prisma/client";
import prisma from "@/server/db/prisma";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import { getDefaultFtsStore } from "@/server/memory/store/fts-store";
import { getDemoProblem, ReviewPipelineError } from "./review-pipeline";
import type { ChatReplyDeps, ChatRequest } from "./chat-reply-contracts";

export function resolveChatFtsStore(deps: ChatReplyDeps) {
  if (deps.ftsStore) return deps.ftsStore;
  if (deps.prisma || process.env.NODE_ENV === "test") return undefined;
  return getDefaultFtsStore();
}

export async function getOrCreateChatSession(
  args: { userId: string; input: ChatRequest },
  db: PrismaClient = prisma,
) {
  const memoryOrigin = resolveMemoryOrigin();
  if (args.input.chatSessionId) {
    const chatSession = await db.chatSession.findFirst({
      where: { id: args.input.chatSessionId, userId: args.userId, memoryOrigin },
      include: { problem: true },
    });
    if (!chatSession) {
      throw new ReviewPipelineError("Chat session was not found.", 404);
    }
    return { chatSession, problem: chatSession.problem };
  }

  const problem = await getDemoProblem(
    { problemId: args.input.problemId, problemSlug: args.input.problemSlug },
    db,
  );
  const chatSession = await db.chatSession.upsert({
    where: {
      userId_problemId_memoryOrigin: {
        userId: args.userId,
        problemId: problem.id,
        memoryOrigin,
      },
    },
    update: { title: problem.title, isActive: true },
    create: {
      userId: args.userId,
      problemId: problem.id,
      title: problem.title,
      isActive: true,
      memoryOrigin,
    },
  });
  return { chatSession, problem };
}
