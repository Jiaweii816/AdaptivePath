import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import nextEnv from "@next/env";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  if (!process.env.LLM_CHAT_API_KEY?.trim()) {
    throw new Error(
      "LLM_CHAT_API_KEY is required for the real compound smoke.",
    );
  }
  if (process.env.COACH_PROVIDER === "mock") {
    throw new Error("COACH_PROVIDER=mock must be unset for the real smoke.");
  }
  if (process.env.CHAT_TOOLS_DISABLED) {
    throw new Error("CHAT_TOOLS_DISABLED must be unset for the real smoke.");
  }

  const tempDir = join(
    tmpdir(),
    `patterncoach-compound-write-smoke-${Date.now()}`,
  );
  mkdirSync(tempDir, { recursive: true });
  const databasePath = join(tempDir, "smoke.db");
  process.env.DATABASE_URL = `file:${databasePath}`;
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "test";
  process.env.PATTERNCOACH_SMOKE_RUN = "1";
  process.env.CHAT_MAX_TOOL_ITERATIONS = "4";
  process.env.CHAT_REQUESTED_ACTION_RESOLVER_MODE = "active";
  applyMigrations(databasePath);

  const { default: prisma } = await import("../src/server/db/prisma");
  const { seedDatabase } = await import("../prisma/seed");
  const { chatReply } =
    await import("../src/server/agents/coach-agent/chat-reply");
  await seedDatabase(prisma);

  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: "PatternCoachTest" },
    });
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: "evaluate-reverse-polish-notation" },
    });
    const chatSession = await prisma.chatSession.upsert({
      where: {
        userId_problemId_memoryOrigin: {
          userId: user.id,
          problemId: problem.id,
          memoryOrigin: "test",
        },
      },
      update: { isActive: true, primaryLanguage: "zh" },
      create: {
        userId: user.id,
        problemId: problem.id,
        title: problem.title,
        isActive: true,
        memoryOrigin: "test",
        primaryLanguage: "zh",
      },
    });
    const [mistakeCountBefore, knowledgeCountBefore] = await Promise.all([
      prisma.mistakeBookEntry.count({
        where: { userId: user.id, problemId: problem.id },
      }),
      prisma.knowledgeNote.count({ where: { userId: user.id } }),
    ]);
    const startedAt = Date.now();
    const reply = await chatReply(
      {
        browserInstanceId: `real-compound-smoke-${Date.now()}`,
        clientOccurredAt: new Date().toISOString(),
        chatSessionId: chatSession.id,
        message:
          "请你帮我把这个‘向零截断’放进 mistakebook 做成笔记。也把 Python 里 int(num2 / num1) 这个向零截断语法记录进 knowledge book。",
        language: "Python",
        responseLanguage: "zh",
      },
      {
        backgroundJobsPolicy: "disabled",
        traceStoreCutoverEnabled: true,
      },
    );
    const elapsedMs = Date.now() - startedAt;
    const [mistakeCount, knowledgeCount, protocolReplacementCount, traceRun] =
      await Promise.all([
        prisma.mistakeBookEntry.count({
          where: { userId: user.id, problemId: problem.id },
        }),
        prisma.knowledgeNote.count({ where: { userId: user.id } }),
        prisma.l1MemoryEvent.count({
          where: {
            chatSessionId: chatSession.id,
            eventType: "reply_protocol_replaced",
          },
        }),
        reply.trace?.traceRunId
          ? prisma.agentTraceRun.findUnique({
              where: { id: reply.trace.traceRunId },
              include: {
                traceEvents: {
                  where: { kind: "llm" },
                  orderBy: { stepIndex: "asc" },
                  select: { model: true, responseModel: true },
                },
              },
            })
          : null,
      ]);

    const completedTools = reply.actionOutcomes
      .filter((outcome) => outcome.status === "completed")
      .map((outcome) => outcome.toolName);
    const report = {
      tempDatabasePath: databasePath,
      providerReachable: true,
      elapsedMs,
      llm: {
        callCount: traceRun?.llmCallCount ?? null,
        inputTokens: traceRun?.providerInputTokens ?? null,
        outputTokens: traceRun?.providerOutputTokens ?? null,
        totalTokens: traceRun?.providerTotalTokens ?? null,
        durationMs: traceRun?.durationMs ?? null,
        models: traceRun?.traceEvents ?? [],
        aliasMismatch:
          traceRun?.traceEvents.some(
            (event) =>
              event.model &&
              event.responseModel &&
              event.model !== event.responseModel,
          ) ?? false,
      },
      toolIterations: reply.toolIterations,
      toolStopReason: reply.toolStopReason,
      toolTrace: reply.toolTrace.map((entry) => ({
        name: entry.name,
        disposition: entry.disposition,
      })),
      actionOutcomes: reply.actionOutcomes,
      records: {
        mistakeCountBefore,
        mistakeCount,
        knowledgeCountBefore,
        knowledgeCount,
      },
      protocolReplacementCount,
      replyContainsProtocol: /DSML|<\|tool_calls|<tool_calls/i.test(
        reply.coachReply,
      ),
    };
    console.log(JSON.stringify(report, null, 2));

    const failures = [
      mistakeCount - mistakeCountBefore !== 1 && "mistake_record_count",
      knowledgeCount - knowledgeCountBefore !== 1 && "knowledge_record_count",
      !completedTools.includes("save_mistake_book_entry") &&
        "mistake_outcome_not_completed",
      !completedTools.includes("save_knowledge_note") &&
        "knowledge_outcome_not_completed",
      (traceRun?.llmCallCount ?? Number.POSITIVE_INFINITY) > 4 &&
        "llm_call_hard_limit",
      report.replyContainsProtocol && "protocol_in_visible_reply",
      protocolReplacementCount > 0 && "protocol_replacement_triggered",
    ].filter(Boolean);
    if (failures.length > 0) {
      throw new Error(`Real compound smoke failed: ${failures.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function applyMigrations(databasePath: string) {
  const db = new Database(databasePath);
  try {
    const migrationsDir = join(process.cwd(), "prisma/migrations");
    const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migrationName of migrationNames) {
      const migrationPath = join(migrationsDir, migrationName, "migration.sql");
      if (existsSync(migrationPath)) {
        db.exec(readFileSync(migrationPath, "utf8"));
      }
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
