import { loadLocalEnv } from "@/lib/env";
import {
  hasLeetCodeSession,
  LeetCodeApiClient,
} from "@/server/tools/leetcode-api/lc-api-client";

loadLocalEnv();

async function main() {
  if (process.env.RUN_LC_API_TESTS !== "1") {
    console.log("Skipping LeetCode API smoke. Set RUN_LC_API_TESTS=1 to run.");
    return;
  }

  if (!hasLeetCodeSession()) {
    throw new Error("LEETCODE_SESSION is required for LeetCode API smoke.");
  }

  const client = new LeetCodeApiClient();
  const problem = await client.getProblem("two-sum");
  const firstExample = problem.exampleTestcases.split("\n").slice(0, 2).join("\n");

  console.log(`${problem.questionFrontendId}. ${problem.title}`);
  console.log(firstExample);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
