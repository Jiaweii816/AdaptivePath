import { pathToFileURL } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { hot150Problems, getHot150Problem } from "../src/data/hot150";
import { localHot150Bank } from "../src/data/hot150/local-bank.generated";
import {
  assertSafeDatabaseForProcess,
  DEFAULT_DATABASE_URL,
} from "../src/server/db/sqlite-path";
import { resolveLocalUserHandle } from "../src/features/onboarding/profile-defaults";

const json = (value: unknown) => JSON.stringify(value);

export const irisProfile = {
  handle: "Iris904",
  displayName: "Iris904",
  interviewGoal: "full_time",
  preferredLanguages: ["Python", "C++"],
  strongPatterns: [
    "HashMap",
    "Dict",
    "Array traversal",
    "Brute force to optimization",
  ],
  weakPatterns: [
    "Binary Search",
    "Binary Search boundaries",
    "Sliding Window shrink condition",
    "DP state design",
  ],
  explanationStyle: [
    "Chinese explanation during testing",
    "Short, step-by-step answer",
    "Concrete example first",
  ],
  outputPreferences: [
    "Pseudocode before full code",
    "Python preferred",
    "C++ supported",
    "Explain with examples",
  ],
} as const;

export type LocalSeedProfile = Readonly<{
  handle: string;
  displayName: string;
  interviewGoal: string;
  preferredLanguages: readonly string[];
  strongPatterns: readonly string[];
  weakPatterns: readonly string[];
  explanationStyle: readonly string[];
  outputPreferences: readonly string[];
}>;

export type SeedDatabaseOptions = Readonly<{
  profile?: LocalSeedProfile;
  updateExistingProfile?: boolean;
}>;

type DemoProblemSeed = {
  leetcodeNumber: number;
  slug: string;
  title: string;
  difficulty: string;
  statementMarkdown: string;
  examples: Array<{
    input: Record<string, unknown>;
    output: unknown;
    explanation?: string;
  }>;
  constraints: string[];
  tags: string[];
  starterCodePython: string;
  starterCodeCpp: string;
  methodName: string;
  inputContract: {
    methodName: string;
    parameters: Array<{ name: string; type: string }>;
  };
  outputContract: {
    type: string;
    orderMatters?: boolean;
  };
  tests: Array<{
    label: string;
    input: Record<string, unknown>;
    expected: unknown;
    sortOrder: number;
  }>;
};

export const demoProblems: DemoProblemSeed[] = [
  {
    leetcodeNumber: 1,
    slug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    statementMarkdown: [
      "Given an integer array `nums` and an integer `target`, return the indices of two different elements whose values add up to `target`.",
      "",
      "For the local MVP demo data, each visible test has exactly one valid pair. You may return the two indices in any order, but you cannot reuse the same index twice.",
      "",
      "This app only runs the visible sample/custom tests stored locally. It is not a LeetCode submission and does not use hidden tests.",
    ].join("\n"),
    examples: [
      {
        input: { nums: [2, 7, 11, 15], target: 9 },
        output: [0, 1],
        explanation: "nums[0] + nums[1] = 2 + 7 = 9.",
      },
      {
        input: { nums: [3, 2, 4], target: 6 },
        output: [1, 2],
        explanation: "nums[1] + nums[2] = 2 + 4 = 6.",
      },
    ],
    constraints: [
      "2 <= nums.length <= 10^4",
      "-10^9 <= nums[i] <= 10^9",
      "-10^9 <= target <= 10^9",
      "Each seeded visible test has one valid answer.",
    ],
    tags: ["array", "hash-table", "hashmap", "interview-150", "demo"],
    starterCodePython: [
      "from typing import List",
      "",
      "class Solution:",
      "    def twoSum(self, nums: List[int], target: int) -> List[int]:",
      "        return []",
      "",
    ].join("\n"),
    starterCodeCpp: [
      "#include <vector>",
      "using namespace std;",
      "",
      "class Solution {",
      "public:",
      "    vector<int> twoSum(vector<int>& nums, int target) {",
      "        return {};",
      "    }",
      "};",
      "",
    ].join("\n"),
    methodName: "twoSum",
    inputContract: {
      methodName: "twoSum",
      parameters: [
        { name: "nums", type: "int[]" },
        { name: "target", type: "int" },
      ],
    },
    outputContract: {
      type: "int[]",
      orderMatters: false,
    },
    tests: [
      {
        label: "sample 1",
        input: { nums: [2, 7, 11, 15], target: 9 },
        expected: [0, 1],
        sortOrder: 0,
      },
      {
        label: "middle pair",
        input: { nums: [3, 2, 4], target: 6 },
        expected: [1, 2],
        sortOrder: 1,
      },
      {
        label: "duplicate values",
        input: { nums: [3, 3], target: 6 },
        expected: [0, 1],
        sortOrder: 2,
      },
    ],
  },
  {
    leetcodeNumber: 35,
    slug: "search-insert-position",
    title: "Search Insert Position",
    difficulty: "Easy",
    statementMarkdown: [
      "Given a sorted array of distinct integers `nums` and an integer `target`, return the index where `target` is found.",
      "",
      "If `target` is not in the array, return the index where it should be inserted so the array remains sorted.",
      "",
      "The important boundary idea is to find the first position whose value is greater than or equal to `target`. This includes inserting before the first value and after the last value.",
      "",
      "This app only runs the visible sample/custom tests stored locally. It is not a LeetCode submission and does not use hidden tests.",
    ].join("\n"),
    examples: [
      {
        input: { nums: [1, 3, 5, 6], target: 5 },
        output: 2,
      },
      {
        input: { nums: [1, 3, 5, 6], target: 2 },
        output: 1,
        explanation: "2 should be inserted between 1 and 3.",
      },
      {
        input: { nums: [1, 3, 5, 6], target: 7 },
        output: 4,
      },
    ],
    constraints: [
      "1 <= nums.length <= 10^4",
      "-10^4 <= nums[i] <= 10^4",
      "nums is sorted in strictly increasing order.",
      "-10^4 <= target <= 10^4",
    ],
    tags: ["array", "binary-search", "interview-150", "demo"],
    starterCodePython: [
      "from typing import List",
      "",
      "class Solution:",
      "    def searchInsert(self, nums: List[int], target: int) -> int:",
      "        return 0",
      "",
    ].join("\n"),
    starterCodeCpp: [
      "#include <vector>",
      "using namespace std;",
      "",
      "class Solution {",
      "public:",
      "    int searchInsert(vector<int>& nums, int target) {",
      "        return 0;",
      "    }",
      "};",
      "",
    ].join("\n"),
    methodName: "searchInsert",
    inputContract: {
      methodName: "searchInsert",
      parameters: [
        { name: "nums", type: "int[]" },
        { name: "target", type: "int" },
      ],
    },
    outputContract: {
      type: "int",
    },
    tests: [
      {
        label: "target exists",
        input: { nums: [1, 3, 5, 6], target: 5 },
        expected: 2,
        sortOrder: 0,
      },
      {
        label: "insert in middle",
        input: { nums: [1, 3, 5, 6], target: 2 },
        expected: 1,
        sortOrder: 1,
      },
      {
        label: "insert after end",
        input: { nums: [1, 3, 5, 6], target: 7 },
        expected: 4,
        sortOrder: 2,
      },
      {
        label: "insert before start",
        input: { nums: [1, 3, 5, 6], target: 0 },
        expected: 0,
        sortOrder: 3,
      },
    ],
  },
  {
    leetcodeNumber: 3,
    slug: "longest-substring-without-repeating-characters",
    title: "Longest Substring Without Repeating Characters",
    difficulty: "Medium",
    statementMarkdown: [
      "Given a string `s`, return the length of the longest contiguous substring that contains no repeated characters.",
      "",
      "The answer is a length, not the substring itself. A useful way to think about the MVP demo is to remember the last index where each character appeared and keep a left boundary for the current window.",
      "",
      "Be careful not to move the left boundary backward when a repeated character was seen before the current window.",
      "",
      "This app only runs the visible sample/custom tests stored locally. It is not a LeetCode submission and does not use hidden tests.",
    ].join("\n"),
    examples: [
      {
        input: { s: "abcabcbb" },
        output: 3,
        explanation: "The substring abc has length 3.",
      },
      {
        input: { s: "bbbbb" },
        output: 1,
      },
      {
        input: { s: "pwwkew" },
        output: 3,
        explanation: "wke has length 3.",
      },
    ],
    constraints: [
      "0 <= s.length <= 5 * 10^4",
      "s may contain letters, digits, symbols, and spaces.",
      "The answer counts contiguous characters only.",
    ],
    tags: [
      "hash-table",
      "string",
      "sliding-window",
      "interview-150",
      "demo",
    ],
    starterCodePython: [
      "class Solution:",
      "    def lengthOfLongestSubstring(self, s: str) -> int:",
      "        return 0",
      "",
    ].join("\n"),
    starterCodeCpp: [
      "#include <string>",
      "using namespace std;",
      "",
      "class Solution {",
      "public:",
      "    int lengthOfLongestSubstring(string s) {",
      "        return 0;",
      "    }",
      "};",
      "",
    ].join("\n"),
    methodName: "lengthOfLongestSubstring",
    inputContract: {
      methodName: "lengthOfLongestSubstring",
      parameters: [{ name: "s", type: "string" }],
    },
    outputContract: {
      type: "int",
    },
    tests: [
      {
        label: "repeating cycle",
        input: { s: "abcabcbb" },
        expected: 3,
        sortOrder: 0,
      },
      {
        label: "single repeated char",
        input: { s: "bbbbb" },
        expected: 1,
        sortOrder: 1,
      },
      {
        label: "window shifts forward",
        input: { s: "pwwkew" },
        expected: 3,
        sortOrder: 2,
      },
      {
        label: "left boundary must not roll back",
        input: { s: "abba" },
        expected: 2,
        sortOrder: 3,
      },
    ],
  },
];

export async function seedDatabase(
  prisma: PrismaClient,
  options: SeedDatabaseOptions = {},
) {
  const localUserHandle = options.profile?.handle ?? resolveLocalUserHandle();
  const profile = options.profile ?? {
    ...irisProfile,
    handle: localUserHandle,
    displayName:
      localUserHandle === irisProfile.handle
        ? irisProfile.displayName
        : localUserHandle,
  };
  const user = await prisma.user.upsert({
    where: { handle: localUserHandle },
    update: {},
    create: {
      handle: localUserHandle,
    },
  });

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: options.updateExistingProfile
      ? {
          displayName: profile.displayName,
          interviewGoal: profile.interviewGoal,
          preferredLanguages: json(profile.preferredLanguages),
          strongPatterns: json(profile.strongPatterns),
          weakPatterns: json(profile.weakPatterns),
          explanationStyle: json(profile.explanationStyle),
          outputPreferences: json(profile.outputPreferences),
        }
      : {},
    create: {
      userId: user.id,
      displayName: profile.displayName,
      interviewGoal: profile.interviewGoal,
      preferredLanguages: json(profile.preferredLanguages),
      strongPatterns: json(profile.strongPatterns),
      weakPatterns: json(profile.weakPatterns),
      explanationStyle: json(profile.explanationStyle),
      outputPreferences: json(profile.outputPreferences),
    },
  });

  const demoSlugs = new Set(demoProblems.map((problem) => problem.slug));
  const localBankBySlug = new Map(
    localHot150Bank.problems.map((problem) => [problem.slug, problem]),
  );

  for (const catalogProblem of hot150Problems) {
    if (demoSlugs.has(catalogProblem.slug)) {
      continue;
    }
    const localProblem = localBankBySlug.get(catalogProblem.slug);

    await prisma.problem.upsert({
      where: { slug: catalogProblem.slug },
      update: {
        leetcodeNumber: catalogProblem.leetcodeNumber,
        title: catalogProblem.title,
        difficulty: catalogProblem.difficulty,
        hot150Order: catalogProblem.order,
        hot150Section: catalogProblem.section,
        officialUrl: `https://leetcode.com/problems/${catalogProblem.slug}/`,
        statementMarkdown: localProblem?.statementMarkdown,
        examplesJson: localProblem ? json(localProblem.examples) : undefined,
        constraintsJson: localProblem ? json(localProblem.constraints) : undefined,
        tags: json(localProblem?.tags ?? catalogProblem.tags),
        starterCodePython: localProblem?.starterCodePython,
        starterCodeCpp: localProblem?.starterCodeCpp,
        methodName: localProblem?.methodName,
        inputContractJson: localProblem
          ? json(localProblem.executionContract)
          : undefined,
        isDemoSupported: false,
        localRunStatus: localProblem?.localRunStatus ?? "not_ready",
        localRunStatusMessage:
          localProblem?.localRunStatusMessage ??
          "Local Run is not generated yet for this Hot-150 problem.",
        localRunValidatedAt: localProblem?.localRunValidatedAt
          ? new Date(localProblem.localRunValidatedAt)
          : null,
        comparisonStrategy: localProblem?.comparisonStrategy ?? "exact",
        comparisonConfigJson: localProblem
          ? json(localProblem.comparisonConfig)
          : "{}",
        contractKind:
          localProblem?.executionContract.contractKind ?? "pure_function",
        referenceSolutionHash: localProblem?.referenceSolutionHash,
      },
      create: {
        leetcodeNumber: catalogProblem.leetcodeNumber,
        slug: catalogProblem.slug,
        title: catalogProblem.title,
        difficulty: catalogProblem.difficulty,
        hot150Order: catalogProblem.order,
        hot150Section: catalogProblem.section,
        officialUrl: `https://leetcode.com/problems/${catalogProblem.slug}/`,
        statementMarkdown: localProblem?.statementMarkdown ?? "",
        examplesJson: json(localProblem?.examples ?? []),
        constraintsJson: json(localProblem?.constraints ?? []),
        tags: json(localProblem?.tags ?? catalogProblem.tags),
        starterCodePython: localProblem?.starterCodePython ?? "",
        starterCodeCpp: localProblem?.starterCodeCpp ?? "",
        methodName: localProblem?.methodName ?? "",
        inputContractJson: localProblem
          ? json(localProblem.executionContract)
          : "{}",
        outputContractJson: "{}",
        isDemoSupported: false,
        localRunStatus: localProblem?.localRunStatus ?? "not_ready",
        localRunStatusMessage:
          localProblem?.localRunStatusMessage ??
          "Local Run is not generated yet for this Hot-150 problem.",
        localRunValidatedAt: localProblem?.localRunValidatedAt
          ? new Date(localProblem.localRunValidatedAt)
          : null,
        comparisonStrategy: localProblem?.comparisonStrategy ?? "exact",
        comparisonConfigJson: json(localProblem?.comparisonConfig ?? {}),
        contractKind:
          localProblem?.executionContract.contractKind ?? "pure_function",
        referenceSolutionHash: localProblem?.referenceSolutionHash,
      },
    });
  }

  for (const localProblem of localHot150Bank.problems) {
    if (demoSlugs.has(localProblem.slug)) {
      continue;
    }

    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: localProblem.slug },
    });

    await prisma.problemTestCase.deleteMany({
      where: {
        problemId: problem.id,
        source: {
          in: ["local_sample", "local_basic", "local_boundary", "lc_example"],
        },
        userId: null,
      },
    });

    await prisma.problemTestCase.createMany({
      data: localProblem.tests.map((test) => ({
        problemId: problem.id,
        label: test.label,
        inputJson: json(test.input),
        expectedJson: json(test.expected),
        source: test.source,
        expectedSource: test.expectedSource,
        gtProvenance: test.gtProvenance,
        validationStatus: test.validationStatus,
        metadataJson: json(test.metadata),
        isVisible: true,
        sortOrder: test.sortOrder,
      })),
    });
  }

  for (const seedProblem of demoProblems) {
    const hot150Problem = getHot150Problem(seedProblem.slug);
    const problem = await prisma.problem.upsert({
      where: { slug: seedProblem.slug },
      update: {
        leetcodeNumber: seedProblem.leetcodeNumber,
        title: seedProblem.title,
        difficulty: seedProblem.difficulty,
        hot150Order: hot150Problem?.order,
        hot150Section: hot150Problem?.section,
        officialUrl: `https://leetcode.com/problems/${seedProblem.slug}/`,
        statementMarkdown: seedProblem.statementMarkdown,
        examplesJson: json(seedProblem.examples),
        constraintsJson: json(seedProblem.constraints),
        tags: json(seedProblem.tags),
        starterCodePython: seedProblem.starterCodePython,
        starterCodeCpp: seedProblem.starterCodeCpp,
        methodName: seedProblem.methodName,
        inputContractJson: json(seedProblem.inputContract),
        outputContractJson: json(seedProblem.outputContract),
        isDemoSupported: true,
        localRunStatus: "runnable",
        localRunStatusMessage:
          "Local Python and C++ Run are available through the fixed demo adapter.",
        localRunValidatedAt: new Date("2026-06-18T00:00:00.000Z"),
        comparisonStrategy: seedProblem.outputContract.orderMatters === false
          ? "unordered"
          : "exact",
        comparisonConfigJson: "{}",
        contractKind: "pure_function",
      },
      create: {
        leetcodeNumber: seedProblem.leetcodeNumber,
        slug: seedProblem.slug,
        title: seedProblem.title,
        difficulty: seedProblem.difficulty,
        hot150Order: hot150Problem?.order,
        hot150Section: hot150Problem?.section,
        officialUrl: `https://leetcode.com/problems/${seedProblem.slug}/`,
        statementMarkdown: seedProblem.statementMarkdown,
        examplesJson: json(seedProblem.examples),
        constraintsJson: json(seedProblem.constraints),
        tags: json(seedProblem.tags),
        starterCodePython: seedProblem.starterCodePython,
        starterCodeCpp: seedProblem.starterCodeCpp,
        methodName: seedProblem.methodName,
        inputContractJson: json(seedProblem.inputContract),
        outputContractJson: json(seedProblem.outputContract),
        isDemoSupported: true,
        localRunStatus: "runnable",
        localRunStatusMessage:
          "Local Python and C++ Run are available through the fixed demo adapter.",
        localRunValidatedAt: new Date("2026-06-18T00:00:00.000Z"),
        comparisonStrategy: seedProblem.outputContract.orderMatters === false
          ? "unordered"
          : "exact",
        comparisonConfigJson: "{}",
        contractKind: "pure_function",
      },
    });

    await prisma.problemTestCase.deleteMany({
      where: {
        problemId: problem.id,
        source: "sample",
        userId: null,
      },
    });

    await prisma.problemTestCase.createMany({
      data: seedProblem.tests.map((test) => ({
        problemId: problem.id,
        label: test.label,
        inputJson: json(test.input),
        expectedJson: json(test.expected),
        source: "sample",
        expectedSource: "seed",
        gtProvenance: "seeded_demo",
        validationStatus: "validated",
        metadataJson: "{}",
        isVisible: true,
        sortOrder: test.sortOrder,
      })),
    });
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  assertSafeDatabaseForProcess({ configuredDatabaseUrl: databaseUrl });
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
