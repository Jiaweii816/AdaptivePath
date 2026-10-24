import { describe, expect, it, vi } from "vitest";
import {
  LcAuthError,
  LcExternalServiceError,
  LeetCodeApiClient,
} from "@/server/tools/leetcode-api/lc-api-client";

describe("LeetCodeApiClient", () => {
  it("throws LcAuthError when auth is missing", async () => {
    const client = new LeetCodeApiClient({
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      loadEnv: false,
    });

    await expect(client.getProblem("two-sum")).rejects.toBeInstanceOf(
      LcAuthError,
    );
  });

  it("throws LcAuthError on 401/403 responses", async () => {
    const client = new LeetCodeApiClient({
      env: {
        LEETCODE_SESSION: "session",
        LEETCODE_CSRF_TOKEN: "csrf",
      } as unknown as NodeJS.ProcessEnv,
      fetchImpl: vi
        .fn()
        .mockResolvedValue(new Response("forbidden", { status: 403 })) as
        unknown as typeof fetch,
      loadEnv: false,
    });

    await expect(client.getProblem("two-sum")).rejects.toBeInstanceOf(
      LcAuthError,
    );
  });

  it("classifies HTML 403 responses as external service failures", async () => {
    const client = new LeetCodeApiClient({
      env: {
        LEETCODE_SESSION: "session",
        LEETCODE_CSRF_TOKEN: "csrf",
      } as unknown as NodeJS.ProcessEnv,
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          new Response("<html><title>Just a moment...</title></html>", {
            headers: { "content-type": "text/html; charset=UTF-8" },
            status: 403,
          }),
        ) as unknown as typeof fetch,
      loadEnv: false,
    });

    await expect(client.getProblem("two-sum")).rejects.toBeInstanceOf(
      LcExternalServiceError,
    );
  });

  const runReal = process.env.RUN_LC_API_TESTS === "1" ? it : it.skip;

  runReal("fetches Two Sum problem details from LeetCode", async () => {
    const client = new LeetCodeApiClient();
    const problem = await client.getProblem("two-sum");

    expect(problem.title).toBe("Two Sum");
    expect(problem.exampleTestcases.length).toBeGreaterThan(0);
  });
});
