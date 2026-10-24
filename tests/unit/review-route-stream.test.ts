import { beforeEach, describe, expect, it, vi } from "vitest";

const reviewPipeline = vi.hoisted(() => vi.fn());

vi.mock("@/server/agents/coach-agent/review-pipeline", () => ({
  reviewPipeline,
  ReviewPipelineError: class ReviewPipelineError extends Error {
    status = 400;
  },
}));

import { POST } from "@/../app/api/coach/review/route";

const evidence = {
  source: "review",
  language: "Python",
  selectedTestCaseIds: ["case-1"],
  runnerProvider: "LeetCode",
  evidenceSource: "Official Judge Evidence",
  runResult: {
    status: "passed_visible_tests",
    passedCount: 96,
    failedCount: 0,
    stdout: "",
    stderr: "Accepted",
    testResults: [],
  },
};

const result = { ok: true, evidence, coachReply: "Short review." };

beforeEach(() => {
  reviewPipeline.mockReset();
  reviewPipeline.mockImplementation(async (_body, deps) => {
    await deps?.onProgress?.({ type: "evidence", evidence });
    return result;
  });
});

describe("POST /api/coach/review streaming", () => {
  it("flushes evidence before the completed Review payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/coach/review", {
        method: "POST",
        headers: {
          Accept: "application/x-ndjson",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ problemId: "problem-1" }),
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(events.map((event) => event.type)).toEqual(["evidence", "complete"]);
    expect(events[0].evidence.runResult.stderr).toBe("Accepted");
  });

  it("keeps JSON responses for callers that do not request streaming", async () => {
    const response = await POST(
      new Request("http://localhost/api/coach/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemId: "problem-1" }),
      }),
    );

    await expect(response.json()).resolves.toEqual(result);
  });
});
