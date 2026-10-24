import { describe, expect, it } from "vitest";
import { resolveCodeRunnerProviderKind } from "@/server/tools/code-runner/run-code-with-tests";

describe("code runner provider selection", () => {
  it.each([
    [{ CODE_RUNNER_PROVIDER: "mock" }, "mock"],
    [{ CODE_RUNNER_PROVIDER: "piston" }, "piston"],
    [{ CODE_RUNNER_PROVIDER: "lc" }, "lc"],
    [{ LEETCODE_SESSION: "session" }, "lc"],
    [{}, "local_hot150"],
  ] as const)("selects %s -> %s", (env, expected) => {
    expect(
      resolveCodeRunnerProviderKind(env as unknown as NodeJS.ProcessEnv),
    ).toBe(expected);
  });

  it.each([
    ["visible_run", "local_hot150"],
    ["chat_run", "local_hot150"],
    ["review", "lc"],
  ] as const)(
    "selects %s with LEETCODE_SESSION as %s when provider is not explicit",
    (executionKind, expected) => {
      expect(
        resolveCodeRunnerProviderKind(
          { LEETCODE_SESSION: "session" } as unknown as NodeJS.ProcessEnv,
          { executionKind },
        ),
      ).toBe(expected);
    },
  );

  it("keeps demo visible and chat runs on the demo Piston fallback", () => {
    const problem = {
      slug: "two-sum",
      title: "Two Sum",
      methodName: "twoSum",
      isDemoSupported: true,
    };

    expect(
      resolveCodeRunnerProviderKind(
        { LEETCODE_SESSION: "session" } as unknown as NodeJS.ProcessEnv,
        { executionKind: "visible_run", problem },
      ),
    ).toBe("piston_fallback");
    expect(
      resolveCodeRunnerProviderKind(
        { LEETCODE_SESSION: "session" } as unknown as NodeJS.ProcessEnv,
        { executionKind: "chat_run", problem },
      ),
    ).toBe("piston_fallback");
  });

  it("keeps Review remote-first even without a session so auth failure becomes static Review", () => {
    expect(
      resolveCodeRunnerProviderKind({} as NodeJS.ProcessEnv, {
        executionKind: "review",
        problem: {
          slug: "maximum-sum-circular-subarray",
          isDemoSupported: false,
          localRunStatus: "runnable",
        },
      }),
    ).toBe("lc");
  });

  it("keeps legacy demo Review remote-first instead of switching to local fallback", () => {
    expect(
      resolveCodeRunnerProviderKind({} as NodeJS.ProcessEnv, {
        executionKind: "review",
        problem: {
          slug: "two-sum",
          isDemoSupported: true,
          localRunStatus: "runnable",
        },
      }),
    ).toBe("lc");
  });

  it("keeps explicit lc override for visible and chat runs", () => {
    const env = {
      CODE_RUNNER_PROVIDER: "lc",
      LEETCODE_SESSION: "session",
    } as unknown as NodeJS.ProcessEnv;

    expect(
      resolveCodeRunnerProviderKind(env, { executionKind: "visible_run" }),
    ).toBe("lc");
    expect(resolveCodeRunnerProviderKind(env, { executionKind: "chat_run" })).toBe(
      "lc",
    );
  });
});
