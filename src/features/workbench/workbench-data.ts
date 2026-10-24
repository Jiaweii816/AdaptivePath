import {
  irisDefaultProfile,
  irisHandle,
} from "@/features/onboarding/profile-defaults";
import type { PrismaClient } from "@prisma/client";
import prisma from "@/server/db/prisma";
import {
  getOrFetchProblem,
  type GetOrFetchProblemOptions,
} from "@/server/problems/hot150-problem-cache";
import { resolveCodeRunnerProviderKind } from "@/server/tools/code-runner/run-code-with-tests";
import { hasLeetCodeSession } from "@/server/tools/leetcode-api/lc-api-client";
import type {
  WorkbenchDraft,
  WorkbenchLanguage,
  WorkbenchProblem,
  WorkbenchProfile,
  WorkbenchTestCase,
} from "./types";

const languages: WorkbenchLanguage[] = ["Python", "C++"];

type WorkbenchDataOptions = {
  db?: PrismaClient;
  problemClient?: GetOrFetchProblemOptions["client"];
  requestedSlug?: string;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toStringArray(value: string | null | undefined) {
  return parseJson<string[]>(value, []);
}

function normalizeLanguage(language: string): WorkbenchLanguage | null {
  return languages.includes(language as WorkbenchLanguage)
    ? (language as WorkbenchLanguage)
    : null;
}

export async function getWorkbenchData(
  options: WorkbenchDataOptions = {},
): Promise<{
  profile: WorkbenchProfile;
  problems: WorkbenchProblem[];
  hasLeetCodeSession: boolean;
}> {
  const db = options.db ?? prisma;
  const providerKind = resolveCodeRunnerProviderKind();
  const hasRemoteSession = providerKind === "lc" && hasLeetCodeSession();
  const requestedSlug = options.requestedSlug?.trim();

  if (requestedSlug && (options.problemClient || hasRemoteSession)) {
    await getOrFetchProblem(requestedSlug, db, {
      client: options.problemClient,
    });
  }

  const user = await db.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });

  const profile = await db.userProfile.findUnique({
    where: { userId: user.id },
  });

  const problems = await db.problem.findMany({
    include: {
      codeDrafts: {
        where: { userId: user.id },
      },
      testCases: {
        where: {
          isVisible: true,
          OR: [{ userId: null }, { userId: user.id }],
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: { leetcodeNumber: "asc" },
  });

  return {
    profile: {
      displayName: profile?.displayName ?? irisDefaultProfile.displayName,
      preferredLanguages: profile
        ? toStringArray(profile.preferredLanguages)
        : [...irisDefaultProfile.preferredLanguages],
      strongPatterns: profile
        ? toStringArray(profile.strongPatterns)
        : [...irisDefaultProfile.strongPatterns],
      weakPatterns: profile
        ? toStringArray(profile.weakPatterns)
        : [...irisDefaultProfile.weakPatterns],
      outputPreferences: profile
        ? toStringArray(profile.outputPreferences)
        : [...irisDefaultProfile.outputPreferences],
    },
    problems: problems.map(toWorkbenchProblem),
    hasLeetCodeSession: hasRemoteSession,
  };
}

export function toWorkbenchProblem(problem: {
  id: string;
  leetcodeNumber: number | null;
  slug: string;
  title: string;
  difficulty: string | null;
  hot150Order: number | null;
  hot150Section: string | null;
  officialUrl: string | null;
  statementMarkdown: string;
  examplesJson: string;
  constraintsJson: string;
  tags: string;
  starterCodePython: string | null;
  starterCodeCpp: string | null;
  methodName: string;
  inputContractJson: string;
  outputContractJson: string;
  isDemoSupported: boolean;
  localRunStatus: string;
  localRunStatusMessage: string | null;
  comparisonStrategy: string;
  comparisonConfigJson: string;
  contractKind: string;
  codeDrafts?: Array<{
    id: string;
    language: string;
    content: string;
    selectedTestCaseIds: string;
  }>;
  testCases?: Array<{
    id: string;
    label: string;
    inputJson: string;
    expectedJson: string;
    source: string;
    expectedSource: string;
    gtProvenance: string | null;
    validationStatus: string;
    metadataJson: string;
    isVisible: boolean;
    sortOrder: number;
  }>;
}): WorkbenchProblem {
  const drafts: Partial<Record<WorkbenchLanguage, WorkbenchDraft>> = {};

  for (const draft of problem.codeDrafts ?? []) {
    const language = normalizeLanguage(draft.language);

    if (!language) {
      continue;
    }

    drafts[language] = {
      id: draft.id,
      language,
      content: draft.content,
      selectedTestCaseIds: parseJson<string[]>(draft.selectedTestCaseIds, []),
    };
  }

  return {
    id: problem.id,
    leetcodeNumber: problem.leetcodeNumber,
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    hot150Order: problem.hot150Order,
    hot150Section: problem.hot150Section,
    officialUrl: problem.officialUrl,
    statementMarkdown: problem.statementMarkdown,
    examples: parseJson<WorkbenchProblem["examples"]>(problem.examplesJson, []),
    constraints: parseJson<string[]>(problem.constraintsJson, []),
    tags: parseJson<string[]>(problem.tags, []),
    starterCode: {
      Python: problem.starterCodePython ?? "",
      "C++": problem.starterCodeCpp ?? "",
    },
    methodName: problem.methodName,
    inputContract: parseJson(problem.inputContractJson, {}),
    outputContract: parseJson(problem.outputContractJson, {}),
    isDemoSupported: problem.isDemoSupported,
    localRunStatus: problem.localRunStatus,
    localRunStatusMessage: problem.localRunStatusMessage,
    comparisonStrategy: problem.comparisonStrategy,
    comparisonConfig: parseJson<Record<string, unknown>>(
      problem.comparisonConfigJson,
      {},
    ),
    contractKind: problem.contractKind,
    testCases: (problem.testCases ?? []).map<WorkbenchTestCase>((testCase) => ({
      id: testCase.id,
      label: testCase.label,
      input: parseJson(testCase.inputJson, null),
      expected: parseJson(testCase.expectedJson, null),
      source: testCase.source,
      expectedSource: testCase.expectedSource,
      gtProvenance: testCase.gtProvenance,
      validationStatus: testCase.validationStatus,
      metadata: parseJson<Record<string, unknown>>(testCase.metadataJson, {}),
      isVisible: testCase.isVisible,
      sortOrder: testCase.sortOrder,
    })),
    drafts,
  };
}
