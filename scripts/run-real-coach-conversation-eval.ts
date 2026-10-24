import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import nextEnv from "@next/env";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

type Scenario = {
  title: string;
  problemSlug: string;
  language: "Python" | "C++";
  userState: string;
  reviewQuestion: string;
  code: string;
  tests: Array<{
    id: string;
    label: string;
    input: unknown;
    expected: unknown;
    source?: string;
  }>;
  followUps: string[];
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

const scenarios: Scenario[] = [
  {
    title: "Search Insert Position - binary search discards mid",
    problemSlug: "search-insert-position",
    language: "Python",
    userState: "My idea feels right but my code has bugs.",
    reviewQuestion:
      "我用二分写了 Search Insert Position，但插入到中间的时候结果不对。请帮我 Review My Code。",
    code: [
      "class Solution:",
      "    def searchInsert(self, nums, target):",
      "        left = 0",
      "        right = len(nums) - 1",
      "",
      "        while left < right:",
      "            mid = (left + right) // 2",
      "",
      "            if nums[mid] < target:",
      "                left = mid + 1",
      "            else:",
      "                right = mid - 1",
      "",
      "        return left",
    ].join("\n"),
    tests: [
      {
        id: "sip-mid",
        label: "insert in middle",
        input: { nums: [1, 3, 5, 6], target: 2 },
        expected: 1,
        source: "eval",
      },
      {
        id: "sip-end",
        label: "insert at end",
        input: { nums: [1, 3, 5, 6], target: 7 },
        expected: 4,
        source: "eval",
      },
    ],
    followUps: [
      "为什么这里不能 right = mid - 1？不都是往左边收缩吗？",
      "我好像懂一点了。给我一点提示，不要直接给完整代码，我想自己改。",
      "我还是很慌，二分每次都写错。我是不是不适合刷算法啊……",
    ],
  },
  {
    title: "Longest Substring - sliding window left moves backward",
    problemSlug: "longest-substring-without-repeating-characters",
    language: "Python",
    userState: "My idea feels right but my code has bugs.",
    reviewQuestion:
      "我用 dict 记录字符位置写滑动窗口，但 abba 这个 case 感觉怪怪的。请帮我 Review My Code。",
    code: [
      "class Solution:",
      "    def lengthOfLongestSubstring(self, s):",
      "        last_seen = {}",
      "        left = 0",
      "        best = 0",
      "",
      "        for right, ch in enumerate(s):",
      "            if ch in last_seen:",
      "                left = last_seen[ch] + 1",
      "",
      "            last_seen[ch] = right",
      "            best = max(best, right - left + 1)",
      "",
      "        return best",
    ].join("\n"),
    tests: [
      {
        id: "lsw-abba",
        label: "left should not move backward",
        input: { s: "abba" },
        expected: 2,
        source: "eval",
      },
      {
        id: "lsw-standard",
        label: "standard repeat",
        input: { s: "abcabcbb" },
        expected: 3,
        source: "eval",
      },
    ],
    followUps: [
      "为什么 left 还要 max？我已经把它移到重复字符后面了。",
      "那你别给答案，给我一个改动方向就好。",
      "这个错误我之前是不是也容易犯？你根据记忆说，不要瞎猜。",
    ],
  },
  {
    title: "Two Sum - dict lookup runtime error",
    problemSlug: "two-sum",
    language: "Python",
    userState: "My idea feels right but my code has bugs.",
    reviewQuestion:
      "我想用 dict 做 Two Sum，但代码一跑就报错。请帮我 Review My Code。",
    code: [
      "class Solution:",
      "    def twoSum(self, nums, target):",
      "        seen = {}",
      "",
      "        for i, num in enumerate(nums):",
      "            need = target - num",
      "            if seen[need] is not None:",
      "                return [seen[need], i]",
      "",
      "            seen[num] = i",
      "",
      "        return []",
    ].join("\n"),
    tests: [
      {
        id: "two-sum-sample",
        label: "sample pair",
        input: { nums: [2, 7, 11, 15], target: 9 },
        expected: [0, 1],
        source: "eval",
      },
    ],
    followUps: [
      "为什么这里会 KeyError？我以为没有就返回 None。",
      "那我用 Python dict 应该怎么写才不容易出错？不要直接给完整答案。",
      "如果我过了这个，推荐两道 HashMap 巩固题，别太多。",
    ],
  },
];

async function main() {
  nextEnv.loadEnvConfig(process.cwd());

  const tempDir = mkTempDir();
  const databasePath = join(tempDir, "coach-real-eval.db");

  process.env.DATABASE_URL = databasePath;
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "evaluation";
  process.env.CODE_RUNNER_PROVIDER = "lc";
  process.env.CHAT_MAX_TOOL_ITERATIONS = process.env.CHAT_MAX_TOOL_ITERATIONS ?? "3";

  applyMigrations(databasePath);

  const { default: prisma } = await import("../src/server/db/prisma");
  const { seedDatabase } = await import("../prisma/seed");
  const { createLcRunnerProvider } = await import(
    "../src/server/tools/code-runner/lc-runner"
  );
  const { getCoachProvider } = await import(
    "../src/server/agents/coach-agent/coach-provider"
  );
  const {
    buildCoachProblemContext,
    buildCoachUserContext,
    getLocalUserAndProfile,
    getNextChatSequence,
    parseJson,
  } = await import("../src/server/agents/coach-agent/review-pipeline");
  const { buildCoachMemoryContext } = await import("../src/server/memory");
  const { chatReply } = await import("../src/server/agents/coach-agent/chat-reply");
  const { appendL1TraceEvents } = await import(
    "../src/server/memory/l1-trace/append-trace"
  );
  const {
    arbitrateFactCandidates,
    mapMemoryUpdateCandidateToFactCandidates,
  } = await import(
    "../src/server/memory/store/fact-store"
  );

  await seedDatabase(prisma);

  const runner = createLcRunnerProvider();
  const provider = getCoachProvider();
  const markdown: string[] = [
    "# Real Coach Conversation Evaluation",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Temp DB: ${databasePath}`,
    "- LLM: real configured Review/Chat provider",
    "- Runner: LeetCode interpret_solution via `executionKind: chat_run` (no submitSolution)",
    "- Note: user inputs and Coach responses are recorded verbatim below.",
    "",
  ];

  try {
    for (const [index, scenario] of scenarios.entries()) {
      markdown.push(`## Scenario ${index + 1}: ${scenario.title}`, "");

      const { user, profile } = await getLocalUserAndProfile();
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { slug: scenario.problemSlug },
      });
      const tags = parseJson<string[]>(problem.tags, []);
      const userContext = buildCoachUserContext(profile);
      const problemContext = buildCoachProblemContext(problem, tags);

      const codeDraft = await prisma.codeDraft.upsert({
        where: {
          userId_problemId_language: {
            userId: user.id,
            problemId: problem.id,
            language: scenario.language,
          },
        },
        update: {
          content: scenario.code,
          selectedTestCaseIds: JSON.stringify(scenario.tests.map((test) => test.id)),
        },
        create: {
          userId: user.id,
          problemId: problem.id,
          language: scenario.language,
          content: scenario.code,
          selectedTestCaseIds: JSON.stringify(scenario.tests.map((test) => test.id)),
        },
      });
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

      const runStartedAt = Date.now();
      const runResult = await runner.run({
        problem: {
          slug: problem.slug,
          title: problem.title,
          leetcodeNumber: problem.leetcodeNumber,
          methodName: problem.methodName,
          tags,
          inputContract: parseJson(problem.inputContractJson, undefined),
          outputContract: parseJson(problem.outputContractJson, undefined),
          isDemoSupported: problem.isDemoSupported,
          localRunStatus: problem.localRunStatus,
          localRunStatusMessage: problem.localRunStatusMessage,
          comparisonStrategy: problem.comparisonStrategy,
          comparisonConfig: parseJson(problem.comparisonConfigJson, {}),
          contractKind: problem.contractKind,
        },
        language: scenario.language,
        code: scenario.code,
        testCases: scenario.tests,
        executionKind: "chat_run",
      });
      const runDurationMs = Date.now() - runStartedAt;

      const memoryContext = await buildCoachMemoryContext(prisma, {
        userId: user.id,
        problemId: problem.id,
        problemTags: tags,
        queryText: `${problem.title} ${tags.join(" ")} ${scenario.reviewQuestion}`,
        entry: { kind: "review" },
        profile,
      });

      const reviewStartedAt = Date.now();
      const coachResult = await provider.review({
        problem: problemContext,
        user: userContext,
        memory: memoryContext.brief,
        language: scenario.language,
        code: scenario.code,
        runResult,
        userState: scenario.userState,
        userQuestion: scenario.reviewQuestion,
        responseLanguage: "zh",
      });
      const reviewDurationMs = Date.now() - reviewStartedAt;

      const persisted = await prisma.$transaction(async (tx) => {
        const reviewAttempt = await tx.reviewAttempt.create({
          data: {
            userId: user.id,
            problemId: problem.id,
            chatSessionId: chatSession.id,
            codeDraftId: codeDraft.id,
            language: scenario.language,
            userState: scenario.userState,
            userQuestion: scenario.reviewQuestion,
            codeSnapshot: scenario.code,
            selectedTestCaseIds: JSON.stringify(scenario.tests.map((test) => test.id)),
            selectedTestsJson: JSON.stringify(scenario.tests),
            coachReplyMarkdown: coachResult.coachReply,
          },
        });

        const runEvidence = await tx.runEvidence.create({
          data: {
            reviewAttemptId: reviewAttempt.id,
            chatSessionId: chatSession.id,
            source: "review",
            status: runResult.status,
            passedCount: runResult.passedCount,
            failedCount: runResult.failedCount,
            durationMs: runResult.durationMs,
            stdout: runResult.stdout,
            stderr: runResult.stderr,
            actualOutput: runResult.actualOutput,
            expectedOutput: runResult.expectedOutput,
            firstFailedCaseJson: runResult.firstFailedCase
              ? JSON.stringify(runResult.firstFailedCase)
              : null,
            rawResultJson: JSON.stringify(runResult),
          },
        });

        const diagnosisResult = await tx.diagnosisResult.create({
          data: {
            reviewAttemptId: reviewAttempt.id,
            diagnosisJson: JSON.stringify(coachResult.diagnosis),
            memoryUpdateCandidateJson: JSON.stringify(
              coachResult.diagnosis.memoryUpdateCandidate,
            ),
            mistakeTags: JSON.stringify(coachResult.diagnosis.mistakeTags),
            skillTags: JSON.stringify(coachResult.diagnosis.skillTags),
            userIssueSummary: coachResult.diagnosis.userIssueSummary,
            coachSummary: coachResult.diagnosis.coachSummary,
          },
        });

        const problemHistory = await tx.problemHistory.create({
          data: {
            userId: user.id,
            problemId: problem.id,
            reviewAttemptId: reviewAttempt.id,
            chatSessionId: chatSession.id,
            language: scenario.language,
            userState: scenario.userState,
            problemTags: JSON.stringify(tags),
            runStatus: runResult.status,
            failedCaseSummary: summarizeFailedCase(runResult),
            userIssueSummary: coachResult.diagnosis.userIssueSummary,
            coachSummary: coachResult.diagnosis.coachSummary,
            memoryUpdateSummary:
              coachResult.diagnosis.memoryUpdateCandidate.summary ??
              coachResult.diagnosis.memoryUpdateCandidate.facts
                .map((fact) => fact.tag)
                .join(", "),
            nextRecommendation:
              runResult.status === "passed_visible_tests"
                ? "Consider one more visible edge case or opt into an optimization discussion."
                : "Apply the coach's next step, then run Review My Code again.",
          },
        });

        const sequence = await getNextChatSequence(chatSession.id, tx);
        const assistantMessage = await tx.chatMessage.create({
          data: {
            sessionId: chatSession.id,
            reviewAttemptId: reviewAttempt.id,
            role: "assistant",
            contentMarkdown: coachResult.coachReply,
            sequence,
            metadataJson: JSON.stringify({
              type: "review_reply",
              runStatus: runResult.status,
              problemHistoryId: problemHistory.id,
            }),
          },
        });

        const traceEvents = await appendL1TraceEvents(tx, [
          {
            userId: user.id,
            problemId: problem.id,
            chatSessionId: chatSession.id,
            reviewAttemptId: reviewAttempt.id,
            eventType: "review_attempt",
            source: "manual_real_eval",
            content: scenario.reviewQuestion,
            eventJson: {
              reviewAttemptId: reviewAttempt.id,
              language: scenario.language,
              userState: scenario.userState,
              codeSnapshotLength: scenario.code.length,
              selectedTests: scenario.tests,
            },
          },
          {
            userId: user.id,
            problemId: problem.id,
            chatSessionId: chatSession.id,
            reviewAttemptId: reviewAttempt.id,
            eventType: "run_evidence",
            source: "manual_real_eval",
            content: `${runResult.status}: ${runResult.passedCount} passed, ${runResult.failedCount} failed`,
            eventJson: {
              runEvidenceId: runEvidence.id,
              status: runResult.status,
              firstFailedCase: runResult.firstFailedCase,
              actualOutput: runResult.actualOutput,
              expectedOutput: runResult.expectedOutput,
            },
          },
          {
            userId: user.id,
            problemId: problem.id,
            chatSessionId: chatSession.id,
            reviewAttemptId: reviewAttempt.id,
            eventType: "diagnosis",
            source: "manual_real_eval",
            content: coachResult.diagnosis.userIssueSummary,
            eventJson: {
              diagnosisResultId: diagnosisResult.id,
              diagnosis: coachResult.diagnosis,
            },
          },
          {
            userId: user.id,
            problemId: problem.id,
            chatSessionId: chatSession.id,
            reviewAttemptId: reviewAttempt.id,
            eventType: "coach_reply",
            source: "manual_real_eval",
            content: coachResult.coachReply,
            eventJson: {
              chatMessageId: assistantMessage.id,
              problemHistoryId: problemHistory.id,
              runStatus: runResult.status,
            },
          },
        ]);

        await arbitrateFactCandidates(tx, {
          userId: user.id,
          problemId: problem.id,
          reviewAttemptId: reviewAttempt.id,
          source: "review_diagnosis",
          candidates: mapMemoryUpdateCandidateToFactCandidates({
            candidate: coachResult.diagnosis.memoryUpdateCandidate,
            evidenceTraceIds: traceEvents
              .filter(
                (event) =>
                  event.eventType === "run_evidence" ||
                  event.eventType === "diagnosis",
              )
              .map((event) => event.id),
          }),
        });

        return {
          reviewAttempt,
          chatSession,
        };
      });

      markdown.push(
        "### Review Turn",
        "",
        "**user_input**",
        "",
        "```text",
        scenario.reviewQuestion,
        "```",
        "",
        "**code**",
        "",
        "```python",
        scenario.code,
        "```",
        "",
        "**run_evidence**",
        "",
        "```json",
        JSON.stringify(
          {
            status: runResult.status,
            passedCount: runResult.passedCount,
            failedCount: runResult.failedCount,
            firstFailedCase: runResult.firstFailedCase,
            actualOutput: runResult.actualOutput,
            expectedOutput: runResult.expectedOutput,
            stderr: runResult.stderr.slice(0, 1000),
            runDurationMs,
          },
          null,
          2,
        ),
        "```",
        "",
        `**Coach Review response** (${reviewDurationMs}ms)`,
        "",
        coachResult.coachReply,
        "",
      );

      for (const [turnIndex, followUp] of scenario.followUps.entries()) {
        const startedAt = Date.now();
        try {
          const reply = await chatReply({
            chatSessionId: persisted.chatSession.id,
            message: followUp,
            responseLanguage: "zh",
          });
          const elapsedMs = Date.now() - startedAt;
          const userMessage = await prisma.chatMessage.findUnique({
            where: { id: reply.userMessageId },
          });
          const metadata = parseJson<{ intent?: string; intentConfidence?: number }>(
            userMessage?.metadataJson,
            {},
          );

          markdown.push(
            `### Follow-up ${turnIndex + 1}`,
            "",
            "**user_input**",
            "",
            "```text",
            followUp,
            "```",
            "",
            "**detected_policy**",
            "",
            "```json",
            JSON.stringify(
              {
                intent: metadata.intent,
                intentConfidence: metadata.intentConfidence,
                toolTrace: reply.toolTrace.map((tool) => ({
                  name: tool.name,
                  toolCallId: tool.toolCallId,
                })),
                toolIterations: reply.toolIterations,
                toolBudgetReached: reply.toolBudgetReached,
                elapsedMs,
              },
              null,
              2,
            ),
            "```",
            "",
            "**Coach Chat response**",
            "",
            reply.coachReply,
            "",
          );
        } catch (error) {
          markdown.push(
            `### Follow-up ${turnIndex + 1}`,
            "",
            "**user_input**",
            "",
            "```text",
            followUp,
            "```",
            "",
            "**Coach Chat error**",
            "",
            "```text",
            error instanceof Error ? error.stack ?? error.message : String(error),
            "```",
            "",
          );
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const logsDir = join(process.cwd(), "logs");
  mkdirSync(logsDir, { recursive: true });
  const outputPath = join(
    logsDir,
    `coach-real-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );
  writeFileSync(outputPath, markdown.join("\n"), "utf8");

  console.log(outputPath);
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
  const base = join(tmpdir(), `patterncoach-real-eval-${Date.now()}-`);
  mkdirSync(base, { recursive: true });
  return base;
}

function summarizeFailedCase(runResult: {
  firstFailedCase?: {
    label: string;
    expected: unknown;
    actual?: unknown;
    error?: string;
  };
  expectedOutput?: string;
  actualOutput?: string;
}) {
  if (!runResult.firstFailedCase) {
    return undefined;
  }

  const failed = runResult.firstFailedCase;
  const expected = runResult.expectedOutput ?? stringifyUnknown(failed.expected);
  const actual =
    runResult.actualOutput ?? failed.error ?? stringifyUnknown(failed.actual);

  return `${failed.label}: expected ${expected}, actual ${actual}`;
}

function stringifyUnknown(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
