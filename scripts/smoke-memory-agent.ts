import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "@/lib/env";
import { runReflection } from "@/server/agents/memory-agent/tasks/reflect";
import {
  assertSafeDatabaseForProcess,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";
import { runChatConsolidation } from "@/server/memory/consolidation/consolidate-chat";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";

type SmokeSeed = {
  userId: string;
  problemId: string;
  chatSessionId: string;
  changedFactIds: string[];
};

let prisma: PrismaClient;

async function main() {
  loadLocalEnv();
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "test";
  process.env.PATTERNCOACH_SMOKE_RUN = "1";
  assertSafeDatabaseForProcess({
    configuredDatabaseUrl: process.env.DATABASE_URL,
  });
  ({ default: prisma } = await import("@/server/db/prisma"));
  assertRealMemoryProviders();

  const startedAt = new Date();
  const dbPath = resolveSqliteFilePath(process.env.DATABASE_URL!);
  const seed = await seedSmokeConversation();
  const fts = createFtsStore(dbPath);

  console.log(`Task 1E MemoryAgent smoke`);
  console.log(`DB path: ${dbPath}`);
  console.log(`User id: ${seed.userId}`);
  console.log(`Chat session id: ${seed.chatSessionId}`);

  try {
    await runChatConsolidation(prisma, {
      chatSessionId: seed.chatSessionId,
      triggerReason: "turn_threshold",
      ftsStore: fts,
    });
    await runReflection(prisma, {
      userId: seed.userId,
      problemId: seed.problemId,
      changedFactIds: seed.changedFactIds,
    });

    const failures = await loadFailuresSince(startedAt, seed.userId);
    if (failures.length > 0) {
      console.error("MemoryAgent smoke found failure traces:");
      for (const failure of failures) {
        console.error(
          `- ${failure.eventType} ${failure.id}: ${failure.content ?? "(no content)"}`,
        );
        console.error(`  ${failure.eventJson}`);
      }
      process.exitCode = 1;
      return;
    }

    const traces = await loadFormalTraceProjection(prisma, {
      userId: seed.userId,
      sources: ["memory_agent:consolidate_chat", "memory_agent:reflect"],
      occurredAt: { gte: startedAt },
      order: "asc",
    });

    console.log("MemoryAgent smoke passed with traces:");
    for (const trace of traces) {
      console.log(`- ${trace.eventType} ${trace.source}: ${trace.content ?? trace.id}`);
    }
  } finally {
    fts.close();
    await prisma.$disconnect();
  }
}

function assertRealMemoryProviders() {
  if (process.env.CHAT_CONSOLIDATION_PROVIDER === "mock") {
    throw new Error(
      "CHAT_CONSOLIDATION_PROVIDER=mock is not allowed for Task 1E real-provider smoke.",
    );
  }

  if (process.env.REFLECTION_PROVIDER === "mock") {
    throw new Error(
      "REFLECTION_PROVIDER=mock is not allowed for Task 1E real-provider smoke.",
    );
  }
}

async function seedSmokeConversation(): Promise<SmokeSeed> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      handle: `task1e-smoke-${suffix}`,
    },
  });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      displayName: "Task 1E Smoke",
      interviewGoal: "memory-agent-provider-smoke",
      preferredLanguages: JSON.stringify(["Python"]),
      strongPatterns: JSON.stringify(["manual_trace"]),
      weakPatterns: JSON.stringify(["binary_search_boundary"]),
      explanationStyle: JSON.stringify(["concise"]),
      outputPreferences: JSON.stringify(["evidence_first"]),
    },
  });
  const problem = await prisma.problem.create({
    data: {
      slug: `task1e-smoke-binary-search-${suffix}`,
      title: "Task 1E Smoke Binary Search",
      statementMarkdown:
        "Synthetic Task 1E smoke problem for MemoryAgent provider verification.",
      methodName: "searchInsert",
      tags: JSON.stringify(["binary_search", "array"]),
      inputContractJson: JSON.stringify({ kind: "smoke" }),
      outputContractJson: JSON.stringify({ kind: "smoke" }),
      comparisonStrategy: "exact",
      comparisonConfigJson: JSON.stringify({}),
      contractKind: "pure_function",
    },
  });
  const chatSession = await prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "test",
      title: "Task 1E MemoryAgent smoke",
      primaryLanguage: "zh",
      isActive: true,
    },
  });
  const turns = [
    ["user", "请记住：二分题先让我说清楚循环不变量，再看代码。"],
    ["assistant", "记住了。之后遇到二分边界，我会先让你说不变量。"],
    ["user", "这次我把 right = mid - 1 和 return left 的关系想混了。"],
    ["assistant", "这说明边界更新和返回位置需要一起检查。"],
  ] as const;

  for (const [index, [role, content]] of turns.entries()) {
    const message = await prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role,
        contentMarkdown: content,
        sequence: index + 1,
        memoryOrigin: "test",
      },
    });
    await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: role === "user" ? "chat_user_message" : "chat_reply",
        eventJson: JSON.stringify({ chatMessageId: message.id }),
        memoryOrigin: "test",
        occurredAt: message.createdAt,
      },
    });
  }

  const diagnosisTrace = await prisma.l1MemoryEvent.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      eventType: "diagnosis",
      source: "task1e_smoke",
      content: "Synthetic reflection seed trace.",
      eventJson: JSON.stringify({
        task: "task1e_memory_agent_smoke",
      }),
      memoryOrigin: "test",
    },
  });
  const factA = await prisma.l2MemoryFact.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      factType: "weakness",
      tag: "binary_search_boundary",
      value: "The learner can mix up boundary movement and return position.",
      confidence: 0.65,
      status: "active",
      source: "task1e_smoke",
      evidenceTraceIds: JSON.stringify([diagnosisTrace.id]),
      memoryOrigin: "test",
    },
  });
  const factB = await prisma.l2MemoryFact.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      factType: "strategy",
      tag: "invariant_first",
      value: JSON.stringify({
        hypothesis: "Ask for the loop invariant before boundary edits.",
        expectedObservable: "reviewTransition",
      }),
      confidence: 0.4,
      status: "candidate",
      source: "task1e_smoke",
      evidenceTraceIds: JSON.stringify([diagnosisTrace.id]),
      validationJson: "{}",
      memoryOrigin: "test",
    },
  });

  return {
    userId: user.id,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    changedFactIds: [factA.id, factB.id],
  };
}

async function loadFailuresSince(startedAt: Date, userId: string) {
  return loadFormalTraceProjection(prisma, {
    userId,
    eventTypes: ["consolidation_failed", "memory_synthesis_failed"],
    occurredAt: { gte: startedAt },
    order: "asc",
  });
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
