import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hot150BySlug, type Hot150Problem } from "@/data/hot150";
import { resolveLocalUserHandle } from "@/features/onboarding/profile-defaults";
import { loadLocalEnv } from "@/lib/env";
import {
  resolveMemoryWritePolicy,
  type MemoryOrigin,
} from "@/server/memory/memory-origin";
import {
  hasLeetCodeSession,
  LeetCodeApiClient,
  type LcRecentSubmission,
} from "@/server/tools/leetcode-api/lc-api-client";

export type ImportLeetCodeHistoryArgs = {
  username: string;
  prismaClient?: PrismaClient;
  client?: Pick<LeetCodeApiClient, "getRecentSubmissions">;
  userHandle?: string;
  dryRun?: boolean;
  memoryOrigin?: MemoryOrigin;
};

export type ImportLeetCodeHistoryResult = {
  scanned: number;
  acceptedHot150: number;
  imported: number;
  skipped: number;
};

const json = (value: unknown) => JSON.stringify(value);
let defaultPrisma: PrismaClient | undefined;

export async function importLeetCodeHistory(
  args: ImportLeetCodeHistoryArgs,
): Promise<ImportLeetCodeHistoryResult> {
  const username = args.username;
  const client = args.client ?? new LeetCodeApiClient();
  const recent = await client.getRecentSubmissions(username, 100);
  const acceptedBySlug = uniqueAcceptedHot150(recent);
  if (args.dryRun ?? true) {
    return {
      scanned: recent.length,
      acceptedHot150: acceptedBySlug.length,
      imported: 0,
      skipped: recent.length - acceptedBySlug.length,
    };
  }

  const memoryOrigin = args.memoryOrigin ?? resolveMemoryWritePolicy().origin;
  if (memoryOrigin !== "learner") {
    throw new Error(
      `LeetCode history apply requires PATTERNCOACH_MEMORY_ORIGIN=learner; got ${memoryOrigin}.`,
    );
  }
  defaultPrisma ??= args.prismaClient
    ? undefined
    : (await import("@/server/db/prisma")).default;
  const prismaClient = args.prismaClient ?? defaultPrisma!;
  const userHandle = args.userHandle ?? resolveLocalUserHandle();
  const user = await prismaClient.user.upsert({
    where: { handle: userHandle },
    update: {},
    create: { handle: userHandle },
  });
  let imported = 0;

  for (const submission of acceptedBySlug) {
    const catalogProblem = hot150BySlug.get(submission.titleSlug);

    if (!catalogProblem) {
      continue;
    }

    const problem = await ensureProblem(prismaClient, catalogProblem);
    const evidenceId = leetCodeImportEvidenceId({
      userId: user.id,
      submission,
    });
    await prismaClient.l1MemoryEvent.upsert({
      where: { id: evidenceId },
      update: {},
      create: {
        id: evidenceId,
        userId: user.id,
        problemId: problem.id,
        eventType: "leetcode_history_import",
        source: "leetcode_history_import",
        memoryOrigin,
        content: `LeetCode reports Accepted for ${catalogProblem.title}.`,
        eventJson: json({
          submissionId: submission.id ?? null,
          titleSlug: submission.titleSlug,
          statusDisplay: submission.statusDisplay,
          timestamp: submission.timestamp,
          lang: submission.lang,
        }),
        occurredAt: new Date(Number(submission.timestamp) * 1000),
      },
    });
    const validationJson = solvedFactValidation({
      problemId: problem.id,
      problemSlug: catalogProblem.slug,
      problemTitle: catalogProblem.title,
      evidenceId,
      submission,
    });

    await prismaClient.l2MemoryFact.upsert({
      where: {
        userId_factType_tag_memoryOrigin: {
          userId: user.id,
          factType: "solved",
          tag: catalogProblem.slug,
          memoryOrigin,
        },
      },
      update: {
        problemId: problem.id,
        label: `Solved ${catalogProblem.title}`,
        value: json({
          importedFrom: "leetcode_recent_submissions",
          leetcodeUsername: username,
          latestStatusDisplay: submission.statusDisplay,
          latestTimestamp: submission.timestamp,
        }),
        confidence: 0.8,
        lastEvidenceSummary: "imported from LeetCode history",
        lastSeenAt: new Date(Number(submission.timestamp) * 1000),
        memoryOrigin,
        evidenceTraceIds: json([evidenceId]),
        validationJson,
      },
      create: {
        userId: user.id,
        problemId: problem.id,
        factType: "solved",
        tag: catalogProblem.slug,
        label: `Solved ${catalogProblem.title}`,
        value: json({
          importedFrom: "leetcode_recent_submissions",
          leetcodeUsername: username,
          latestStatusDisplay: submission.statusDisplay,
          latestTimestamp: submission.timestamp,
        }),
        confidence: 0.8,
        evidenceCount: 1,
        memoryOrigin,
        evidenceTraceIds: json([evidenceId]),
        validationJson,
        lastEvidenceSummary: "imported from LeetCode history",
        lastSeenAt: new Date(Number(submission.timestamp) * 1000),
      },
    });
    imported += 1;
  }

  return {
    scanned: recent.length,
    acceptedHot150: acceptedBySlug.length,
    imported,
    skipped: recent.length - acceptedBySlug.length,
  };
}

function leetCodeImportEvidenceId(args: {
  userId: string;
  submission: LcRecentSubmission;
}) {
  const digest = createHash("sha256")
    .update(
      [
        args.userId,
        args.submission.id ?? "no-id",
        args.submission.titleSlug,
        args.submission.timestamp,
        args.submission.statusDisplay,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
  return `lc-history-${digest}`;
}

function solvedFactValidation(args: {
  problemId: string;
  problemSlug: string;
  problemTitle: string;
  evidenceId: string;
  submission: LcRecentSubmission;
}) {
  return json({
    integrity: {
      version: 1,
      origin: "learner",
      subject: "learner_behavior",
      mechanism: `accepted_problem:${args.problemSlug}`,
      humanLabel: `Solved ${args.problemTitle} on LeetCode`,
      portability: "portable",
      promotionStatus: "trusted",
      evidenceClusters: [
        {
          key: `leetcode:${args.submission.id ?? `${args.problemSlug}:${args.submission.timestamp}`}`,
          problemId: args.problemId,
          revisionKey:
            args.submission.id ??
            `${args.problemSlug}:${args.submission.timestamp}:${args.submission.lang}`,
          transition: "reinforce",
          evidenceTraceIds: [args.evidenceId],
        },
      ],
    },
    externalVerification: {
      provider: "leetcode",
      statusDisplay: args.submission.statusDisplay,
      timestamp: args.submission.timestamp,
    },
  });
}

function uniqueAcceptedHot150(submissions: LcRecentSubmission[]) {
  const bySlug = new Map<string, LcRecentSubmission>();

  for (const submission of submissions) {
    if (
      submission.statusDisplay === "Accepted" &&
      hot150BySlug.has(submission.titleSlug) &&
      !bySlug.has(submission.titleSlug)
    ) {
      bySlug.set(submission.titleSlug, submission);
    }
  }

  return [...bySlug.values()];
}

async function ensureProblem(
  prismaClient: PrismaClient,
  catalogProblem: Hot150Problem,
) {
  return prismaClient.problem.upsert({
    where: { slug: catalogProblem.slug },
    update: {
      leetcodeNumber: catalogProblem.leetcodeNumber,
      title: catalogProblem.title,
      difficulty: catalogProblem.difficulty,
      tags: json(catalogProblem.tags),
    },
    create: {
      leetcodeNumber: catalogProblem.leetcodeNumber,
      slug: catalogProblem.slug,
      title: catalogProblem.title,
      difficulty: catalogProblem.difficulty,
      statementMarkdown: "",
      examplesJson: "[]",
      constraintsJson: "[]",
      tags: json(catalogProblem.tags),
      starterCodePython: "",
      starterCodeCpp: "",
      methodName: "",
      inputContractJson: "{}",
      outputContractJson: "{}",
      isDemoSupported: false,
    },
  });
}

async function main() {
  loadLocalEnv();

  const username = process.argv[2];
  const apply = process.argv.slice(3).includes("--apply");

  if (!username) {
    throw new Error(
      "Usage: tsx scripts/import-lc-history.ts <leetcode-username> [--apply]",
    );
  }

  if (!hasLeetCodeSession()) {
    throw new Error("LEETCODE_SESSION is required to import LeetCode history.");
  }

  const result = await importLeetCodeHistory({ username, dryRun: !apply });
  if (!apply) {
    console.log("Dry run only; pass --apply with explicit learner origin to write.");
  }
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await defaultPrisma?.$disconnect();
    });
}
