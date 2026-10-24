import { hot150ReferenceMarkdown } from "./fixtures/hot150-reference-solutions";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { coachSelfCheckSchema } from "../src/types/coach";
import { loadLocalEnv } from "../src/lib/env";
import { DEFAULT_DATABASE_URL } from "../src/server/db/sqlite-path";
import { createReviewClient } from "../src/server/llm/client";
import { getReviewModel } from "../src/server/llm/models";
import {
  isCleanSelfCheck,
  sanitizeSelfCheck,
  type SelfCheck,
} from "../src/server/agents/coach-agent/self-check-guard";
import { isGenuineDiagnosisForSelfCheck } from "../src/server/agents/coach-agent/self-check-eligibility";

const MAX_RETRIES = 2;

type ReferenceSource = {
  leetcodeNumber: number;
  title: string;
  idea: string;
  code: string;
};

type RepairStats = {
  scanned: number;
  generated: number;
  alreadyClean: number;
  skippedIneligible: number;
  skippedMissingSource: number;
  rejectedDirty: number;
};

async function main() {
  loadLocalEnv();

  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const references = await loadReferenceSources();
    const rows = await prisma.diagnosisResult.findMany({
      include: {
        reviewAttempt: {
          include: {
            problem: true,
            runEvidences: {
              where: { source: "review" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    const stats: RepairStats = {
      scanned: rows.length,
      generated: 0,
      alreadyClean: 0,
      skippedIneligible: 0,
      skippedMissingSource: 0,
      rejectedDirty: 0,
    };
    const candidates = rows.filter((row) => {
      if (
        isCleanSelfCheck(
          row.selfCheckQuestion && row.selfCheckAnswer
            ? { question: row.selfCheckQuestion, answer: row.selfCheckAnswer }
            : null,
        )
      ) {
        stats.alreadyClean += 1;
        return false;
      }

      const runStatus =
        row.reviewAttempt.runEvidences[0]?.status ??
        runStatusFromDiagnosisJson(row.diagnosisJson);
      const eligible = isGenuineDiagnosisForSelfCheck({
        mistakeTags: parseJsonStringArray(row.mistakeTags),
        userIssueSummary: row.userIssueSummary,
        coachSummary: row.coachSummary,
        runStatus,
      });
      if (!eligible) {
        stats.skippedIneligible += 1;
        return false;
      }

      const leetcodeNumber = row.reviewAttempt.problem.leetcodeNumber;
      if (!leetcodeNumber || !references.has(leetcodeNumber)) {
        stats.skippedMissingSource += 1;
        return false;
      }

      return true;
    });

    console.log(
      `Repairing ${candidates.length} missing self-checks with ${getReviewModel()}.`,
    );

    const client = candidates.length > 0 ? createReviewClient() : null;
    for (const row of candidates) {
      const leetcodeNumber = row.reviewAttempt.problem.leetcodeNumber;
      const source = leetcodeNumber ? references.get(leetcodeNumber) : undefined;
      if (!client || !leetcodeNumber || !source) {
        continue;
      }

      const selfCheck = await generateCleanSelfCheck({
        client,
        model: getReviewModel(),
        problem: {
          title: row.reviewAttempt.problem.title,
          slug: row.reviewAttempt.problem.slug,
          leetcodeNumber,
          tags: parseJsonStringArray(row.reviewAttempt.problem.tags),
        },
        diagnosis: {
          mistakeTags: parseJsonStringArray(row.mistakeTags),
          userIssueSummary: row.userIssueSummary,
          coachSummary: row.coachSummary,
        },
        source,
      });

      if (!selfCheck) {
        stats.rejectedDirty += 1;
        console.warn(
          `Skipped ${leetcodeNumber}. ${row.reviewAttempt.problem.title}: generated self-check was not clean.`,
        );
        continue;
      }

      await prisma.diagnosisResult.update({
        where: { id: row.id },
        data: {
          selfCheckQuestion: selfCheck.question,
          selfCheckAnswer: selfCheck.answer,
          diagnosisJson: withSelfCheck(row.diagnosisJson, selfCheck),
        },
      });
      stats.generated += 1;
      console.log(
        `Generated ${leetcodeNumber}. ${row.reviewAttempt.problem.title}`,
      );
    }

    console.log(
      [
        `Scanned ${stats.scanned} diagnosis rows.`,
        `Generated ${stats.generated}.`,
        `Already clean ${stats.alreadyClean}.`,
        `Skipped ineligible ${stats.skippedIneligible}.`,
        `Missing source ${stats.skippedMissingSource}.`,
        `Rejected dirty ${stats.rejectedDirty}.`,
      ].join(" "),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function generateCleanSelfCheck(args: {
  client: OpenAI;
  model: string;
  problem: {
    title: string;
    slug: string;
    leetcodeNumber: number;
    tags: string[];
  };
  diagnosis: {
    mistakeTags: string[];
    userIssueSummary: string | null;
    coachSummary: string | null;
  };
  source: ReferenceSource;
}) {
  let rejectionNote = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const content = await requestSelfCheckJson({ ...args, rejectionNote });
    const parsed = parseSelfCheckJson(content);
    const clean = sanitizeSelfCheck(parsed);
    if (clean) {
      return clean;
    }

    rejectionNote =
      "Previous output was rejected by the guard. Rewrite without runner output, system text, internal tags, or learner-specific bug details.";
  }

  return null;
}

async function requestSelfCheckJson(args: {
  client: OpenAI;
  model: string;
  problem: {
    title: string;
    slug: string;
    leetcodeNumber: number;
    tags: string[];
  };
  diagnosis: {
    mistakeTags: string[];
    userIssueSummary: string | null;
    coachSummary: string | null;
  };
  source: ReferenceSource;
  rejectionNote: string;
}) {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You author PatternCoach AI flashcards. Return one compact JSON object only. No markdown outside JSON.",
    },
    {
      role: "user",
      content: [
        "Write a problem-method self-check flashcard in Chinese.",
        "The card is for a learner who has no time to redo the problem.",
        "Question: ask this problem's key decision, invariant, or standard pattern. It must be answerable without seeing the learner's code.",
        "Answer: give a transferable method plus one minimal correct Python snippet in a fenced code block. Do not paste a full official solution.",
        "Never mention the learner's submission, bug, runner output, expected/actual values, runtime errors, system pipeline text, structured JSON, or internal snake_case tags.",
        args.rejectionNote,
        "",
        `Problem: ${args.problem.leetcodeNumber}. ${args.problem.title} (${args.problem.slug})`,
        `Tags: ${args.problem.tags.join(", ")}`,
        "",
        "Standard solution idea:",
        args.source.idea,
        "",
        "Reference Python solution for grounding. Extract only the minimal pattern snippet you need:",
        "```python",
        args.source.code,
        "```",
        "",
        "Real diagnosis context proves this was a genuine review, but do not quote it:",
        `mistakeTags: ${args.diagnosis.mistakeTags.join(", ")}`,
        `userIssueSummary: ${args.diagnosis.userIssueSummary ?? ""}`,
        `coachSummary: ${args.diagnosis.coachSummary ?? ""}`,
        "",
        'Return exactly: {"question":"...","answer":"..."}',
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const completion = await args.client.chat.completions.create({
    model: args.model,
    temperature: 0.2,
    messages,
  });
  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("Self-check repair LLM returned empty content.");
  }
  return content;
}

async function loadReferenceSources() {
  const markdown = hot150ReferenceMarkdown();
  return parseReferenceSources(markdown);
}

function parseReferenceSources(markdown: string) {
  const headingPattern = /^###\s+(\d+)\.\s+(.+?)\s*$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  const sources = new Map<number, ReferenceSource>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const start = match.index ?? 0;
    const end = next?.index ?? markdown.length;
    const section = markdown.slice(start, end);
    const leetcodeNumber = Number(match[1]);
    const title = (match[2] ?? "").trim();
    const idea = section.match(/思路：(.+?)\s*(?:\n|$)/)?.[1]?.trim() ?? "";
    const code = section.match(/```python\s*\n([\s\S]*?)```/)?.[1]?.trim() ?? "";

    if (leetcodeNumber && idea && code) {
      sources.set(leetcodeNumber, { leetcodeNumber, title, idea, code });
    }
  }

  return sources;
}

function parseSelfCheckJson(content: string): SelfCheck | null {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const candidate =
    parseJsonObject(stripped) ??
    parseJsonObject(stripped.slice(stripped.indexOf("{"), stripped.lastIndexOf("}") + 1));
  const parsed = coachSelfCheckSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function parseJsonObject(text: string) {
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseJsonStringArray(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function runStatusFromDiagnosisJson(value: string) {
  try {
    const parsed = JSON.parse(value) as { runStatus?: unknown };
    return typeof parsed.runStatus === "string" ? parsed.runStatus : null;
  } catch {
    return null;
  }
}

function withSelfCheck(value: string, selfCheck: SelfCheck) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return value;
    }
    return JSON.stringify({ ...parsed, selfCheck });
  } catch {
    return value;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
