import type { CodeRunnerInput } from "../src/server/tools/code-runner/code-runner.types";
import { createPistonRunnerProvider } from "../src/server/tools/code-runner/piston-runner";
import { localHot150Bank } from "../src/data/hot150/local-bank.generated";
import type { LocalHot150Problem } from "../src/data/hot150/local-run-types";

const baseProblem = {
  slug: "search-insert-position",
  title: "Search Insert Position",
  leetcodeNumber: 35,
  methodName: "searchInsert",
  tags: ["array", "binary-search"],
  outputContract: { type: "int" },
};

const tests = [
  {
    id: "sample-middle",
    label: "insert in middle",
    input: { nums: [1, 3, 5, 6], target: 2 },
    expected: 1,
    source: "sample",
  },
];

const passingPython = [
  "from typing import List",
  "class Solution:",
  "    def searchInsert(self, nums: List[int], target: int) -> int:",
  "        for index, value in enumerate(nums):",
  "            if value >= target:",
  "                return index",
  "        return len(nums)",
].join("\n");

const failingPython = [
  "from typing import List",
  "class Solution:",
  "    def searchInsert(self, nums: List[int], target: int) -> int:",
  "        return len(nums)",
].join("\n");

const runtimePython = [
  "from typing import List",
  "class Solution:",
  "    def searchInsert(self, nums: List[int], target: int) -> int:",
  "        return 1 // 0",
].join("\n");

const timeoutPython = [
  "from typing import List",
  "class Solution:",
  "    def searchInsert(self, nums: List[int], target: int) -> int:",
  "        while True:",
  "            pass",
].join("\n");

const passingCpp = [
  "#include <vector>",
  "using namespace std;",
  "class Solution {",
  "public:",
  "    int searchInsert(vector<int>& nums, int target) {",
  "        for (int i = 0; i < static_cast<int>(nums.size()); ++i) {",
  "            if (nums[i] >= target) return i;",
  "        }",
  "        return static_cast<int>(nums.size());",
  "    }",
  "};",
].join("\n");

const compileErrorCpp = [
  "#include <vector>",
  "using namespace std;",
  "class Solution {",
  "public:",
  "    int searchInsert(vector<int>& nums, int target) {",
  "        return target",
  "    }",
  "};",
].join("\n");

async function main() {
  const runner = createPistonRunnerProvider();
  const scenarios: Array<{
    name: string;
    input: CodeRunnerInput;
    expectedStatus: string;
  }> = [
    {
      name: "python passing",
      input: request("Python", passingPython),
      expectedStatus: "passed_visible_tests",
    },
    {
      name: "python failed",
      input: request("Python", failingPython),
      expectedStatus: "failed",
    },
    {
      name: "python syntax error",
      input: request(
        "Python",
        "class Solution:\n    def searchInsert(self, nums, target):\n        if target > 0\n            return 1",
      ),
      expectedStatus: "syntax_error",
    },
    {
      name: "python runtime error",
      input: request("Python", runtimePython),
      expectedStatus: "runtime_error",
    },
    {
      name: "python timeout",
      input: request("Python", timeoutPython, { runTimeoutMs: 500 }),
      expectedStatus: "timeout",
    },
    {
      name: "c++ passing",
      input: request("C++", passingCpp),
      expectedStatus: "passed_visible_tests",
    },
    {
      name: "c++ compile error",
      input: request("C++", compileErrorCpp),
      expectedStatus: "compile_error",
    },
    {
      name: "empty code",
      input: request("Python", "   "),
      expectedStatus: "empty_code",
    },
    {
      name: "no tests",
      input: { ...request("Python", passingPython), testCases: [] },
      expectedStatus: "no_tests",
    },
    {
      name: "unsupported language",
      input: {
        ...request("Python", passingPython),
        language: "JavaScript" as never,
      },
      expectedStatus: "unsupported_language",
    },
  ];

  for (const scenario of scenarios) {
    const result = await runner.run(scenario.input);
    console.log(`${scenario.name}: ${result.status}`);

    if (result.status !== scenario.expectedStatus) {
      console.error(result);
      throw new Error(
        `${scenario.name} expected ${scenario.expectedStatus}, got ${result.status}`,
      );
    }
  }

  await runLocalHot150Scenarios();
}

function request(
  language: "Python" | "C++",
  code: string,
  limits?: CodeRunnerInput["limits"],
): CodeRunnerInput {
  return {
    problem: baseProblem,
    language,
    code,
    testCases: tests,
    limits,
  };
}

async function runLocalHot150Scenarios() {
  const runner = createPistonRunnerProvider({ providerUsed: "local_hot150" });
  const scenarios: Array<{
    name: string;
    input: CodeRunnerInput;
    expectedStatus: string;
  }> = [
    {
      name: "hot150 3sum multiset_deep accepts reordered triplets",
      input: hot150Request(
        15,
        [
          "class Solution:",
          "    def threeSum(self, nums):",
          "        return [[-1, 0, 1], [2, -1, -1]]",
        ].join("\n"),
        {
          id: "three-sum-order-variant",
          label: "order variant",
          input: { nums: [-1, 0, 1, 2, -1, -4] },
          expected: [
            [-1, -1, 2],
            [-1, 0, 1],
          ],
        },
      ),
      expectedStatus: "passed_visible_tests",
    },
    {
      name: "hot150 permutations multiset_top rejects collapsed inner permutations",
      input: hot150Request(
        46,
        [
          "class Solution:",
          "    def permute(self, nums):",
          "        return [[1, 2, 3] for _ in range(6)]",
        ].join("\n"),
        {
          id: "permutations-collapsed",
          label: "collapsed permutations",
          input: { nums: [1, 2, 3] },
          expected: [
            [1, 2, 3],
            [1, 3, 2],
            [2, 1, 3],
            [2, 3, 1],
            [3, 1, 2],
            [3, 2, 1],
          ],
        },
      ),
      expectedStatus: "failed",
    },
    {
      name: "hot150 course schedule ii accepts any valid topological order",
      input: hot150Request(
        210,
        [
          "class Solution:",
          "    def findOrder(self, numCourses, prerequisites):",
          "        return [1, 0, 2]",
        ].join("\n"),
        {
          id: "topological-order-variant",
          label: "topological order variant",
          input: { numCourses: 3, prerequisites: [[2, 0], [2, 1]] },
          expected: [0, 1, 2],
        },
      ),
      expectedStatus: "passed_visible_tests",
    },
  ];

  for (const scenario of scenarios) {
    const result = await runner.run(scenario.input);
    console.log(`${scenario.name}: ${result.status}`);

    if (result.status !== scenario.expectedStatus) {
      console.error(result);
      throw new Error(
        `${scenario.name} expected ${scenario.expectedStatus}, got ${result.status}`,
      );
    }
  }
}

function hot150Request(
  leetcodeNumber: number,
  code: string,
  testCase: CodeRunnerInput["testCases"][number],
): CodeRunnerInput {
  const problem = localHot150Bank.problems.find(
    (candidate) => candidate.leetcodeNumber === leetcodeNumber,
  );

  if (!problem) {
    throw new Error(`Missing generated Hot-150 problem ${leetcodeNumber}.`);
  }

  return {
    problem: toRunnerProblem(problem),
    language: "Python",
    code,
    testCases: [testCase],
    executionKind: "visible_run",
  };
}

function toRunnerProblem(problem: LocalHot150Problem): CodeRunnerInput["problem"] {
  return {
    slug: problem.slug,
    title: problem.title,
    leetcodeNumber: problem.leetcodeNumber,
    methodName: problem.methodName,
    tags: problem.tags,
    inputContract: problem.executionContract,
    isDemoSupported: false,
    localRunStatus: problem.localRunStatus,
    localRunStatusMessage: problem.localRunStatusMessage ?? null,
    comparisonStrategy: problem.comparisonStrategy,
    comparisonConfig: problem.comparisonConfig,
    contractKind: problem.executionContract.contractKind,
  };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
