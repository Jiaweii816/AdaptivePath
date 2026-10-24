import { loadLocalEnv } from "@/lib/env";
import { createLcRunnerProvider } from "@/server/tools/code-runner/lc-runner";
import { hasLeetCodeSession } from "@/server/tools/leetcode-api/lc-api-client";
import type { CodeRunnerInput } from "@/server/tools/code-runner/code-runner.types";

loadLocalEnv();

const baseInput: Omit<CodeRunnerInput, "code"> = {
  problem: {
    slug: "two-sum",
    title: "Two Sum",
    leetcodeNumber: 1,
    methodName: "twoSum",
    tags: ["array", "hashmap"],
  },
  language: "Python",
  testCases: [],
  executionKind: "review",
};

async function main() {
  if (process.env.RUN_LC_API_TESTS !== "1") {
    console.log("Skipping LeetCode runner smoke. Set RUN_LC_API_TESTS=1 to run.");
    return;
  }

  if (!hasLeetCodeSession()) {
    throw new Error("LEETCODE_SESSION is required for LeetCode runner smoke.");
  }

  const runner = createLcRunnerProvider();
  const correct = await runner.run({
    ...baseInput,
    code: [
      "from typing import List",
      "",
      "class Solution:",
      "    def twoSum(self, nums: List[int], target: int) -> List[int]:",
      "        seen = {}",
      "        for i, value in enumerate(nums):",
      "            need = target - value",
      "            if need in seen:",
      "                return [seen[need], i]",
      "            seen[value] = i",
      "        return []",
    ].join("\n"),
  });
  const wrong = await runner.run({
    ...baseInput,
    code: [
      "from typing import List",
      "",
      "class Solution:",
      "    def twoSum(self, nums: List[int], target: int) -> List[int]:",
      "        return [0, 0]",
    ].join("\n"),
  });

  console.log(`correct: ${correct.status}`);
  console.log(`wrong: ${wrong.status}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
