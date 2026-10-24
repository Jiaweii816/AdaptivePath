import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { hot150Problems } from "../src/data/hot150";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

type RecommendationScenario = {
  title: string;
  problemSlug: string;
  setup?: (context: ScenarioSetupContext) => Promise<void>;
  turns: string[];
};

type ScenarioSetupContext = {
  prisma: Awaited<typeof import("../src/server/db/prisma")>["default"];
  userId: string;
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

const scenarios: RecommendationScenario[] = [
  {
    title: "Explicit same-type HashMap practice stays inside Hot-150",
    problemSlug: "two-sum",
    setup: async ({ prisma, userId }) => {
      await markHot150Completed(prisma, userId, [1]);
    },
    turns: [
      "如果我过了这个，推荐两道 HashMap 巩固题，别太多。",
      "这两道里先做哪一道更适合我？",
    ],
  },
  {
    title: "Explicit same-type practice falls outside Hot-150 only after HashMap is exhausted",
    problemSlug: "two-sum",
    setup: async ({ prisma, userId }) => {
      await markHot150SectionCompleted(prisma, userId, "Hashmap");
    },
    turns: ["HashMap 我还想再练两道同类型题，不要换类型。"],
  },
  {
    title: "General next-problem request moves to next Hot-150 type after HashMap is done",
    problemSlug: "two-sum",
    setup: async ({ prisma, userId }) => {
      await markHot150SectionCompleted(prisma, userId, "Hashmap");
    },
    turns: ["推荐下一个题目，我想继续按 Hot150 往前刷。"],
  },
];

async function main() {
  nextEnv.loadEnvConfig(process.cwd());

  if (process.env.CHAT_TOOLS_DISABLED) {
    throw new Error(
      "CHAT_TOOLS_DISABLED is set. Unset it before running the real recommendation policy eval.",
    );
  }

  if (process.env.COACH_PROVIDER === "mock") {
    throw new Error(
      "COACH_PROVIDER=mock is set. Unset it before running the real recommendation policy eval.",
    );
  }

  const tempDir = mkTempDir();
  const databasePath = join(tempDir, "coach-recommendation-real-eval.db");

  process.env.DATABASE_URL = databasePath;
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "evaluation";
  process.env.CHAT_MAX_TOOL_ITERATIONS = process.env.CHAT_MAX_TOOL_ITERATIONS ?? "3";

  applyMigrations(databasePath);

  const { default: prisma } = await import("../src/server/db/prisma");
  const { seedDatabase } = await import("../prisma/seed");
  const { chatReply } = await import("../src/server/agents/coach-agent/chat-reply");
  const { parseJson } = await import(
    "../src/server/agents/coach-agent/review-pipeline"
  );

  await seedDatabase(prisma);

  const markdown: string[] = [
    "# Real Recommendation Policy Evaluation",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Temp DB: ${databasePath}`,
    "- LLM: real configured Chat provider (`COACH_PROVIDER` is not `mock`)",
    "- Chat tools: enabled (`CHAT_TOOLS_DISABLED` is not set)",
    "- Path: real `chatReply()` tool loop, no forced tool result injection",
    "",
  ];

  try {
    for (const [index, scenario] of scenarios.entries()) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { handle: "PatternCoachEvaluation" },
      });
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: scenario.problemSlug },
      });

      await resetScenarioState(prisma, user.id, problem.id);
      await scenario.setup?.({ prisma, userId: user.id });

      const chatSession = await prisma.chatSession.upsert({
        where: {
          userId_problemId_memoryOrigin: {
            userId: user.id,
            problemId: problem.id,
            memoryOrigin: "evaluation",
          },
        },
        update: {
          title: problem.title,
          primaryLanguage: "zh",
          isActive: true,
          memoryOrigin: "evaluation",
        },
        create: {
          userId: user.id,
          problemId: problem.id,
          title: problem.title,
          primaryLanguage: "zh",
          isActive: true,
        },
      });

      markdown.push(`## Scenario ${index + 1}: ${scenario.title}`, "");

      for (const [turnIndex, userInput] of scenario.turns.entries()) {
        const startedAt = Date.now();
        const reply = await chatReply({
          chatSessionId: chatSession.id,
          message: userInput,
          responseLanguage: "zh",
        });
        const elapsedMs = Date.now() - startedAt;
        const userMessage = await prisma.chatMessage.findUnique({
          where: { id: reply.userMessageId },
        });
        const metadata = parseJson<{
          intent?: string;
          intentConfidence?: number;
        }>(userMessage?.metadataJson, {});

        markdown.push(
          `### Turn ${turnIndex + 1}`,
          "",
          "**user_input**",
          "",
          "```text",
          userInput,
          "```",
          "",
          "**detected_policy_and_tools**",
          "",
          "```json",
          JSON.stringify(
            {
              intent: metadata.intent,
              intentConfidence: metadata.intentConfidence,
              toolIterations: reply.toolIterations,
              toolBudgetReached: reply.toolBudgetReached,
              elapsedMs,
              toolTrace: reply.toolTrace.map((tool) => ({
                name: tool.name,
                result: tool.result,
              })),
            },
            null,
            2,
          ),
          "```",
          "",
          "**Coach response**",
          "",
          reply.coachReply,
          "",
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const logsDir = join(process.cwd(), "logs");
  mkdirSync(logsDir, { recursive: true });
  const outputPath = join(
    logsDir,
    `coach-recommendation-real-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );

  writeFileSync(outputPath, markdown.join("\n"), "utf8");
  console.log(outputPath);
}

async function resetScenarioState(
  prisma: ScenarioSetupContext["prisma"],
  userId: string,
  activeProblemId: string,
) {
  await prisma.chatSession.deleteMany({
    where: {
      userId,
      problemId: activeProblemId,
    },
  });
  await prisma.problemHistory.deleteMany({
    where: { userId },
  });
}

async function markHot150SectionCompleted(
  prisma: ScenarioSetupContext["prisma"],
  userId: string,
  section: string,
) {
  const leetcodeNumbers = hot150Problems
    .filter((problem) => problem.section === section)
    .map((problem) => problem.leetcodeNumber);

  await markHot150Completed(prisma, userId, leetcodeNumbers);
}

async function markHot150Completed(
  prisma: ScenarioSetupContext["prisma"],
  userId: string,
  leetcodeNumbers: number[],
) {
  const problems = await prisma.problem.findMany({
    where: {
      leetcodeNumber: { in: leetcodeNumbers },
    },
    orderBy: { leetcodeNumber: "asc" },
  });

  for (const problem of problems) {
    const codeDraft = await prisma.codeDraft.upsert({
      where: {
        userId_problemId_language: {
          userId,
          problemId: problem.id,
          language: "Python",
        },
      },
      update: {},
      create: {
        userId,
        problemId: problem.id,
        language: "Python",
        content: "",
      },
    });
    const chatSession = await prisma.chatSession.upsert({
      where: {
        userId_problemId_memoryOrigin: {
          userId,
          problemId: problem.id,
          memoryOrigin: "evaluation",
        },
      },
      update: {
        title: problem.title,
        primaryLanguage: "zh",
        isActive: false,
        memoryOrigin: "evaluation",
      },
      create: {
        userId,
        problemId: problem.id,
        title: problem.title,
        primaryLanguage: "zh",
        isActive: false,
      },
    });
    const reviewAttempt = await prisma.reviewAttempt.create({
      data: {
        userId,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        codeDraftId: codeDraft.id,
        language: "Python",
        codeSnapshot: "",
        selectedTestCaseIds: "[]",
        selectedTestsJson: "[]",
        coachReplyMarkdown: "Marked complete for real recommendation eval.",
      },
    });

    await prisma.problemHistory.create({
      data: {
        userId,
        problemId: problem.id,
        reviewAttemptId: reviewAttempt.id,
        chatSessionId: chatSession.id,
        language: "Python",
        problemTags: problem.tags,
        runStatus: "passed_visible_tests",
        userIssueSummary: "Completed before recommendation request.",
        coachSummary: "Completed before recommendation request.",
      },
    });
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

function mkTempDir() {
  const base = join(tmpdir(), `patterncoach-recommendation-real-eval-${Date.now()}-`);
  mkdirSync(base, { recursive: true });
  return base;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
