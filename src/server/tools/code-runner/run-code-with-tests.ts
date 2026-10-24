import type { CodeRunResult } from "@/types/code-runner";
import { hasLeetCodeSession } from "@/server/tools/leetcode-api/lc-api-client";
import type { CodeRunnerInput, CodeRunnerProvider } from "./code-runner.types";
import { createLcRunnerProvider } from "./lc-runner";
import { createMockCodeRunnerProvider } from "./mock-runner";
import { createPistonRunnerProvider } from "./piston-runner";

let didWarnPistonFallback = false;

export type CodeRunnerProviderKind =
  | "mock"
  | "piston"
  | "lc"
  | "piston_fallback"
  | "local_hot150";

type ProviderSelectionInput = {
  executionKind?: CodeRunnerInput["executionKind"];
  problem?: Partial<CodeRunnerInput["problem"]>;
};

export function resolveCodeRunnerProviderKind(
  env: NodeJS.ProcessEnv = process.env,
  input?: ProviderSelectionInput,
): CodeRunnerProviderKind {
  if (env.CODE_RUNNER_PROVIDER === "mock") {
    return "mock";
  }

  if (env.CODE_RUNNER_PROVIDER === "piston") {
    return "piston";
  }

  if (env.CODE_RUNNER_PROVIDER === "lc") {
    return "lc";
  }

  if (
    input?.executionKind === "visible_run" ||
    input?.executionKind === "chat_run"
  ) {
    if (input.problem?.isDemoSupported) {
      return "piston_fallback";
    }

    return "local_hot150";
  }

  if (input?.executionKind === "review") {
    return "lc";
  }

  if (hasLeetCodeSession(env)) {
    return "lc";
  }

  return input?.problem?.isDemoSupported
    ? "piston_fallback"
    : "local_hot150";
}

export function getCodeRunnerProvider(
  input?: ProviderSelectionInput,
): CodeRunnerProvider {
  const providerKind = resolveCodeRunnerProviderKind(process.env, input);

  switch (providerKind) {
    case "mock":
      return createMockCodeRunnerProvider();
    case "piston":
      return createPistonRunnerProvider({ providerUsed: "piston" });
    case "lc":
      return createLcRunnerProvider();
    case "piston_fallback":
      if (!didWarnPistonFallback) {
        console.warn(
          "Using local Piston fallback for the three demo problems. Remote judge execution is disabled unless CODE_RUNNER_PROVIDER=lc.",
        );
        didWarnPistonFallback = true;
      }

      return createPistonRunnerProvider({ providerUsed: "piston_fallback" });
    case "local_hot150":
      return createPistonRunnerProvider({ providerUsed: "local_hot150" });
  }
}

export async function runCodeWithTests(
  input: CodeRunnerInput,
  provider = getCodeRunnerProvider(input),
): Promise<CodeRunResult> {
  return provider.run(input);
}
