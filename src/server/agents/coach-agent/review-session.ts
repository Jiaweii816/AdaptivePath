import type { PrismaClient } from "@prisma/client";
import { attachTraceRunReferences, type TraceContext } from "@/server/llm/trace-context";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import type { ReviewRequest } from "./review-pipeline-contract";

const json = (value: unknown) => JSON.stringify(value);

export async function initializeReviewSession(args: {
  db: PrismaClient;
  input: ReviewRequest;
  userId: string;
  problem: { id: string; title: string };
  selectedTestCaseIds: string[];
  responseLanguage: "zh" | "en";
  memoryOrigin: MemoryOrigin;
  traceContext?: TraceContext;
}) {
  const codeDraft = await upsertReviewDraft(args);
  const chatSession = await upsertReviewChatSession(args);
  if (args.traceContext) {
    args.traceContext.chatSessionId = chatSession.id;
    await attachTraceRunReferences(args.traceContext, {
      chatSessionId: chatSession.id,
    });
  }
  return { codeDraft, chatSession };
}

type SessionArgs = Parameters<typeof initializeReviewSession>[0];

async function upsertReviewDraft(args: SessionArgs) {
  return args.db.codeDraft.upsert({
    where: {
      userId_problemId_language: {
        userId: args.userId,
        problemId: args.problem.id,
        language: args.input.language,
      },
    },
    update: {
      content: args.input.code,
      selectedTestCaseIds: json(args.selectedTestCaseIds),
    },
    create: {
      userId: args.userId,
      problemId: args.problem.id,
      language: args.input.language,
      content: args.input.code,
      selectedTestCaseIds: json(args.selectedTestCaseIds),
    },
  });
}

async function upsertReviewChatSession(args: SessionArgs) {
  return args.db.chatSession.upsert({
    where: {
      userId_problemId_memoryOrigin: {
        userId: args.userId,
        problemId: args.problem.id,
        memoryOrigin: args.memoryOrigin,
      },
    },
    update: {
      title: args.problem.title,
      primaryLanguage: args.responseLanguage,
      isActive: true,
      memoryOrigin: args.memoryOrigin,
    },
    create: {
      userId: args.userId,
      problemId: args.problem.id,
      title: args.problem.title,
      primaryLanguage: args.responseLanguage,
      isActive: true,
      memoryOrigin: args.memoryOrigin,
    },
  });
}
