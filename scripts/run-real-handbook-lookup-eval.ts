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

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;
type PrismaHandle = Awaited<typeof import("../src/server/db/prisma")>["default"];
type ChatReply = typeof import("../src/server/agents/coach-agent/chat-reply")["chatReply"];

type Scenario = {
  key: string;
  title: string;
  message: string;
  language: "Python" | "C++";
  setup?: (context: { prisma: PrismaHandle; userId: string }) => Promise<void>;
  expected: {
    lookupStatus: "covered" | "partial" | "none";
    lookupCount?: number;
    missingAspects?: string[];
    requireLookupTool?: boolean;
    requireSaveTool?: boolean;
    forbidSavedNote?: boolean;
    requireHandbookMention?: boolean;
    forbidSaveInvite?: boolean;
  };
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

const BASIC_DEQUE_NOTE = {
  conceptKey: "python_deque",
  title: "Python deque queue basics",
  snippet:
    "from collections import deque\nq = deque()\nq.append(x)\nleft = q.popleft()",
  whenToUse: "BFS queue or O(1) front-pop traversal.",
  category: "python_api",
};

const scenarios: Scenario[] = [
  {
    key: "covered",
    title: "Existing deque card fully covers narrow popleft query",
    message: "Python 怎么从队列中弹出左边元素？",
    language: "Python",
    setup: seedBasicDequeNote,
    expected: {
      lookupStatus: "covered",
      lookupCount: 4,
      requireLookupTool: true,
      requireHandbookMention: true,
      forbidSaveInvite: true,
    },
  },
  {
    key: "partial",
    title: "Existing basic deque card is partial for broad all-usage query",
    message: "你能告诉我 Python 里面队列的所有用法吗？",
    language: "Python",
    setup: seedBasicDequeNote,
    expected: {
      lookupStatus: "partial",
      lookupCount: 4,
      missingAspects: ["appendleft", "pop", "rotate", "maxlen"],
      requireLookupTool: true,
      requireHandbookMention: true,
      forbidSaveInvite: true,
    },
  },
  {
    key: "none",
    title: "Unrelated API query does not auto-save a handbook note",
    message: "Python lru_cache 怎么用？",
    language: "Python",
    expected: {
      lookupStatus: "none",
      requireLookupTool: true,
      forbidSavedNote: true,
    },
  },
  {
    key: "explicit-update",
    title: "Explicit request can extend an existing partial deque card",
    message: "请把 Python deque 的 push_front / appendleft 用法扩展到知识手册这张卡里",
    language: "Python",
    setup: seedBasicDequeNote,
    expected: {
      lookupStatus: "partial",
      lookupCount: 4,
      missingAspects: ["appendleft"],
      requireLookupTool: true,
      requireSaveTool: true,
      requireHandbookMention: true,
      forbidSaveInvite: true,
    },
  },
];

async function main() {
  nextEnv.loadEnvConfig(process.cwd());

  if (!process.env.LLM_CHAT_API_KEY?.trim()) {
    console.log(
      "Skipping real handbook lookup eval: LLM_CHAT_API_KEY is not configured.",
    );
    return;
  }

  if (process.env.COACH_PROVIDER === "mock") {
    console.log(
      "Skipping real handbook lookup eval: COACH_PROVIDER=mock disables the real Chat LLM.",
    );
    return;
  }

  if (process.env.CHAT_TOOLS_DISABLED) {
    throw new Error(
      "CHAT_TOOLS_DISABLED is set. Unset it before running the real handbook lookup eval.",
    );
  }

  const tempDir = mkTempDir();
  const databasePath = join(tempDir, "coach-handbook-real-eval.db");

  process.env.DATABASE_URL = `file:${databasePath}`;
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "evaluation";
  process.env.CODE_RUNNER_PROVIDER = process.env.CODE_RUNNER_PROVIDER ?? "mock";
  process.env.CHAT_MAX_TOOL_ITERATIONS = process.env.CHAT_MAX_TOOL_ITERATIONS ?? "3";

  applyMigrations(databasePath);

  const { default: prisma } = await import("../src/server/db/prisma");
  const { seedDatabase } = await import("../prisma/seed");
  const { chatReply } = await import("../src/server/agents/coach-agent/chat-reply");

  await seedDatabase(prisma);

  const markdown: string[] = [
    "# Real Knowledge Handbook Lookup Evaluation",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Temp DB: ${databasePath}`,
    "- LLM: real configured Chat provider (`COACH_PROVIDER` is not `mock`)",
    "- Path: real `chatReply()` tool loop, no mocked tool-call plan",
    "- Scenarios: covered, partial, none, explicit update",
    "",
  ];
  const allChecks: Array<{ scenario: string; name: string; pass: boolean; detail: string }> = [];

  try {
    for (const scenario of scenarios) {
      const observation = await runScenario({ prisma, chatReply, scenario });
      allChecks.push(
        ...observation.checks.map((check) => ({
          scenario: scenario.key,
          ...check,
        })),
      );

      markdown.push(
        `## ${scenario.title}`,
        "",
        "**user_input**",
        "",
        "```text",
        scenario.message,
        "```",
        "",
        "**observed**",
        "",
        "```json",
        JSON.stringify(observation.observed, null, 2),
        "```",
        "",
        "**checks**",
        "",
        "```json",
        JSON.stringify(observation.checks, null, 2),
        "```",
        "",
        "**coach_reply**",
        "",
        observation.coachReply,
        "",
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  const failed = allChecks.filter((check) => !check.pass);
  markdown.push(
    "## Summary",
    "",
    failed.length === 0
      ? "All critical checks passed."
      : `${failed.length} critical check(s) failed.`,
    "",
    "```json",
    JSON.stringify(allChecks, null, 2),
    "```",
    "",
  );

  const logsDir = join(process.cwd(), "logs");
  mkdirSync(logsDir, { recursive: true });
  const outputPath = join(
    logsDir,
    `coach-handbook-real-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );

  writeFileSync(outputPath, markdown.join("\n"), "utf8");
  console.log(outputPath);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

async function runScenario(args: {
  prisma: PrismaHandle;
  chatReply: ChatReply;
  scenario: Scenario;
}) {
  const user = await args.prisma.user.findUniqueOrThrow({
    where: { handle: "PatternCoachEvaluation" },
  });
  const problem = await args.prisma.problem.findUniqueOrThrow({
    where: { slug: "longest-substring-without-repeating-characters" },
  });

  await resetScenarioState(args.prisma, user.id, problem.id);
  await args.scenario.setup?.({ prisma: args.prisma, userId: user.id });

  const chatSession = await args.prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      title: problem.title,
      primaryLanguage: "zh",
      isActive: true,
      memoryOrigin: "evaluation",
    },
  });
  const beforeNotes = await args.prisma.knowledgeNote.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const reply = await args.chatReply(
    {
      chatSessionId: chatSession.id,
      message: args.scenario.message,
      language: args.scenario.language,
      responseLanguage: "zh",
    },
    { backgroundJobsPolicy: "disabled" },
  );
  const afterNotes = await args.prisma.knowledgeNote.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const lookupEvent = await readLookupEvent(args.prisma, reply.userMessageId);
  const toolLookup = readToolHandbookLookup(reply.toolTrace);
  const observed = {
    lookupEvent,
    toolHandbookLookup: toolLookup,
    toolTrace: simplifyToolTrace(reply.toolTrace),
    beforeNotes: beforeNotes.map(simplifyNote),
    afterNotes: afterNotes.map(simplifyNote),
    replyContainsSaveInvite: containsSaveInvite(reply.coachReply),
    replyMentionsHandbook: /知识手册|Knowledge Handbook|handbook/i.test(
      reply.coachReply,
    ),
  };
  const checks = evaluateChecks(args.scenario, observed);

  return {
    observed,
    checks,
    coachReply: reply.coachReply,
  };
}

async function seedBasicDequeNote(context: { prisma: PrismaHandle; userId: string }) {
  await context.prisma.knowledgeNote.create({
    data: {
      userId: context.userId,
      ...BASIC_DEQUE_NOTE,
      lookupCount: 3,
    },
  });
}

async function resetScenarioState(
  prisma: PrismaHandle,
  userId: string,
  problemId: string,
) {
  await prisma.l1MemoryEvent.deleteMany({ where: { userId } });
  await prisma.chatSession.deleteMany({ where: { userId, problemId } });
  await prisma.knowledgeNote.deleteMany({ where: { userId } });
}

async function readLookupEvent(prisma: PrismaHandle, userMessageId: string) {
  const events = await prisma.l1MemoryEvent.findMany({
    where: { eventType: "knowledge_lookup" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  for (const event of events) {
    try {
      const parsed = JSON.parse(event.eventJson) as Record<string, unknown>;
      if (parsed.userMessageId === userMessageId) {
        return parsed;
      }
    } catch {
      // Ignore malformed historical rows in smoke output.
    }
  }

  return undefined;
}

function readToolHandbookLookup(toolTrace: Array<{ name: string; result: unknown }>) {
  const lookupTool = toolTrace.find((tool) => tool.name === "lookup_api_reference");
  const result = lookupTool?.result;
  if (!result || typeof result !== "object") {
    return undefined;
  }

  return (result as { handbookLookup?: unknown }).handbookLookup;
}

function simplifyToolTrace(toolTrace: Array<{ name: string; result: unknown }>) {
  return toolTrace.map((tool) => ({
    name: tool.name,
    result: simplifyToolResult(tool.result),
  }));
}

function simplifyToolResult(result: unknown) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const value = result as Record<string, unknown>;
  return {
    saved: value.saved,
    alreadyExisted: value.alreadyExisted,
    lookupCount: value.lookupCount,
    found: value.found,
    topic: value.topic,
    entryTopic:
      value.entry && typeof value.entry === "object"
        ? (value.entry as { topic?: unknown }).topic
        : undefined,
    handbookLookup: value.handbookLookup,
    message: value.message,
  };
}

function simplifyNote(note: {
  id: string;
  conceptKey: string;
  title: string;
  snippet: string;
  lookupCount: number;
  userEdited: boolean;
}) {
  return {
    id: note.id,
    conceptKey: note.conceptKey,
    title: note.title,
    lookupCount: note.lookupCount,
    userEdited: note.userEdited,
    snippet: note.snippet,
  };
}

function evaluateChecks(
  scenario: Scenario,
  observed: {
    lookupEvent?: Record<string, unknown>;
    toolHandbookLookup?: unknown;
    toolTrace: Array<{ name: string; result: unknown }>;
    afterNotes: Array<{ lookupCount: number; snippet: string }>;
    replyContainsSaveInvite: boolean;
    replyMentionsHandbook: boolean;
  },
) {
  const lookupStatus =
    typeof observed.lookupEvent?.status === "string"
      ? observed.lookupEvent.status
      : readLookupStatus(observed.toolHandbookLookup);
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [
    {
      name: "lookup_status",
      pass: lookupStatus === scenario.expected.lookupStatus,
      detail: `expected ${scenario.expected.lookupStatus}, observed ${lookupStatus ?? "none"}`,
    },
  ];

  if (scenario.expected.lookupCount !== undefined) {
    checks.push({
      name: "lookup_count",
      pass: observed.afterNotes[0]?.lookupCount === scenario.expected.lookupCount,
      detail: `expected ${scenario.expected.lookupCount}, observed ${observed.afterNotes[0]?.lookupCount ?? "none"}`,
    });
  }

  if (scenario.expected.missingAspects) {
    const missing = readMissingAspects(observed.lookupEvent, observed.toolHandbookLookup);
    checks.push({
      name: "missing_aspects",
      pass: scenario.expected.missingAspects.every((aspect) => missing.includes(aspect)),
      detail: `expected ${scenario.expected.missingAspects.join(", ")}, observed ${missing.join(", ")}`,
    });
  }

  if (scenario.expected.requireLookupTool) {
    checks.push({
      name: "lookup_tool_called",
      pass: observed.toolTrace.some((tool) => tool.name === "lookup_api_reference"),
      detail: observed.toolTrace.map((tool) => tool.name).join(", ") || "no tools",
    });
  }

  if (scenario.expected.requireSaveTool) {
    checks.push({
      name: "save_tool_called_and_succeeded",
      pass: observed.toolTrace.some((tool) => {
        const result = tool.result as { saved?: unknown };
        return tool.name === "save_knowledge_note" && result.saved === true;
      }),
      detail: observed.toolTrace.map((tool) => tool.name).join(", ") || "no tools",
    });
  }

  if (scenario.expected.forbidSavedNote) {
    checks.push({
      name: "no_auto_saved_note",
      pass: observed.afterNotes.length === 0,
      detail: `notes after turn: ${observed.afterNotes.length}`,
    });
  }

  if (scenario.expected.requireHandbookMention) {
    checks.push({
      name: "reply_mentions_handbook",
      pass: observed.replyMentionsHandbook,
      detail: observed.replyMentionsHandbook ? "mentioned" : "missing",
    });
  }

  if (scenario.expected.forbidSaveInvite) {
    checks.push({
      name: "reply_has_no_save_invite",
      pass: !observed.replyContainsSaveInvite,
      detail: observed.replyContainsSaveInvite ? "save invite present" : "clean",
    });
  }

  return checks;
}

function readLookupStatus(lookup: unknown) {
  if (!lookup || typeof lookup !== "object") {
    return undefined;
  }

  const status = (lookup as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

function readMissingAspects(
  lookupEvent: Record<string, unknown> | undefined,
  toolLookup: unknown,
) {
  const eventMissing = lookupEvent?.missingAspects;
  if (Array.isArray(eventMissing)) {
    return eventMissing.filter((entry): entry is string => typeof entry === "string");
  }

  if (!toolLookup || typeof toolLookup !== "object") {
    return [];
  }

  const matchedNotes = (toolLookup as { matchedNotes?: unknown }).matchedNotes;
  if (!Array.isArray(matchedNotes)) {
    return [];
  }

  const missing = (matchedNotes[0] as { missingAspects?: unknown } | undefined)
    ?.missingAspects;
  return Array.isArray(missing)
    ? missing.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function containsSaveInvite(markdown: string) {
  return [
    /要不要.*(知识手册|handbook)/i,
    /需要我.*(存|保存|save).*(知识手册|handbook)/i,
    /(存|保存).*(到|进).*(知识手册|handbook)/i,
    /save.*(knowledge\s*)?handbook/i,
  ].some((pattern) => pattern.test(markdown));
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
  const base = join(tmpdir(), `patterncoach-handbook-real-eval-${Date.now()}-`);
  mkdirSync(base, { recursive: true });
  return base;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
