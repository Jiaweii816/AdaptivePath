import { describe, expect, it, vi } from "vitest";
import {
  createPistonRunnerProvider,
  readPistonOutputMaxSize,
} from "@/server/tools/code-runner/piston-runner";
import { PISTON_RESULT_MARKER } from "@/server/tools/code-runner/normalize-run-result";
import type { PistonClient } from "@/server/tools/code-runner/piston-client";

const localProblem = {
  slug: "minimum-size-subarray-sum",
  title: "Minimum Size Subarray Sum",
  leetcodeNumber: 209,
  methodName: "minSubArrayLen",
  tags: ["sliding-window"],
  inputContract: {
    name: "minSubArrayLen",
    params: [
      { name: "target", type: "integer" },
      { name: "nums", type: "integer[]" },
    ],
    returnType: "integer",
    contractKind: "pure_function",
  },
  isDemoSupported: false,
  localRunStatus: "runnable",
  localRunStatusMessage: null,
  comparisonStrategy: "exact",
  comparisonConfig: {},
  contractKind: "pure_function",
};

describe("Piston runner local Hot-150 path", () => {
  it("defaults the Piston stdout window to 16 MiB and allows env override", () => {
    expect(readPistonOutputMaxSize({})).toBe(16 * 1024 * 1024);
    expect(
      readPistonOutputMaxSize({
        PISTON_OUTPUT_MAX_SIZE: "33554432",
      }),
    ).toBe(32 * 1024 * 1024);
    expect(
      readPistonOutputMaxSize({
        PISTON_OUTPUT_MAX_SIZE: "not-a-number",
      }),
    ).toBe(16 * 1024 * 1024);
  });

  it("runs a non-demo Python problem through the metadata wrapper", async () => {
    const execute = vi.fn().mockImplementation(async (request) => ({
      language: "python",
      version: "3",
      run: {
        stdout:
          PISTON_RESULT_MARKER +
          JSON.stringify({
            status: "completed",
            testResults: [
              {
                id: "case-1",
                label: "local sample",
                input: { target: 7, nums: [2, 3, 1, 2, 4, 3] },
                expected: 2,
                actual: 2,
                passed: true,
              },
            ],
          }),
        stderr: "",
        code: 0,
      },
      request,
    }));
    const runner = createPistonRunnerProvider({
      client: { execute } as unknown as PistonClient,
      providerUsed: "local_hot150",
    });

    const result = await runner.run({
      problem: localProblem,
      language: "Python",
      code: "class Solution:\n    def minSubArrayLen(self, target, nums):\n        return 2",
      testCases: [
        {
          id: "case-1",
          label: "local sample",
          input: { target: 7, nums: [2, 3, 1, 2, 4, 3] },
          expected: 2,
        },
      ],
      executionKind: "visible_run",
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].files[0]?.content).toContain(
      "__pc_contract",
    );
    expect(execute.mock.calls[0]?.[0].output_max_size).toBe(
      16 * 1024 * 1024,
    );
    expect(result.status).toBe("passed_visible_tests");
    expect(result.rawResult).toMatchObject({ providerUsed: "local_hot150" });
  });

  it("keeps local Hot-150 Python stdout attached to each testcase", async () => {
    const perCaseResults = [
      {
        id: "case-1",
        label: "home",
        input: { path: "/home/" },
        expected: "/home",
        actual: null,
        passed: false,
        stdout: "['', 'home', '']",
        stderr: "",
        stdoutCaptured: true,
        stderrCaptured: true,
      },
      {
        id: "case-2",
        label: "foo",
        input: { path: "/home//foo/" },
        expected: "/home/foo",
        actual: null,
        passed: false,
        stdout: "['', 'home', '', 'foo', '']",
        stderr: "",
        stdoutCaptured: true,
        stderrCaptured: true,
      },
    ];
    let caseIndex = 0;
    const execute = vi.fn().mockImplementation(async (request) => {
      expect(request.files[0]?.content).toContain("redirect_stdout");
      const testResult = perCaseResults[caseIndex++];

      return {
        language: "python",
        version: "3",
        run: {
          stdout:
            PISTON_RESULT_MARKER +
            JSON.stringify({
              status: "completed",
              testResults: [testResult],
            }),
          stderr: "",
          code: 0,
        },
      };
    });
    const runner = createPistonRunnerProvider({
      client: { execute } as unknown as PistonClient,
      providerUsed: "local_hot150",
    });

    const result = await runner.run({
      problem: {
        ...localProblem,
        slug: "simplify-path",
        title: "Simplify Path",
        leetcodeNumber: 71,
        methodName: "simplifyPath",
        inputContract: {
          name: "simplifyPath",
          params: [{ name: "path", type: "string" }],
          returnType: "string",
          contractKind: "pure_function",
        },
      },
      language: "Python",
      code: [
        "class Solution:",
        "    def simplifyPath(self, path: str) -> str:",
        "        print(path.split('/'))",
        "        return None",
      ].join("\n"),
      testCases: [
        {
          id: "case-1",
          label: "home",
          input: { path: "/home/" },
          expected: "/home",
        },
        {
          id: "case-2",
          label: "foo",
          input: { path: "/home//foo/" },
          expected: "/home/foo",
        },
      ],
      executionKind: "visible_run",
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.testResults).toHaveLength(2);
    expect(result.testResults[0]).toMatchObject({
      id: "case-1",
      stdout: "['', 'home', '']",
      stdoutCaptured: true,
    });
    expect(result.testResults[1]).toMatchObject({
      id: "case-2",
      stdout: "['', 'home', '', 'foo', '']",
      stdoutCaptured: true,
    });
  });

  it("isolates local Hot-150 cases so a later sandbox crash keeps earlier passes", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        language: "python",
        version: "3",
        run: {
          stdout:
            PISTON_RESULT_MARKER +
            JSON.stringify({
              status: "completed",
              testResults: [
                {
                  id: "case-1",
                  label: "sample 1",
                  input: { s: "ADOBECODEBANC", t: "ABC" },
                  expected: "BANC",
                  actual: "BANC",
                  passed: true,
                },
              ],
            }),
          stderr: "",
          code: 0,
        },
      })
      .mockResolvedValueOnce({
        language: "python",
        version: "3",
        run: {
          stdout:
            PISTON_RESULT_MARKER +
            JSON.stringify({
              status: "completed",
              testResults: [
                {
                  id: "case-2",
                  label: "sample 2",
                  input: { s: "a", t: "a" },
                  expected: "a",
                  actual: "a",
                  passed: true,
                },
              ],
            }),
          stderr: "",
          code: 0,
        },
      })
      .mockResolvedValueOnce({
        language: "python",
        version: "3",
        run: {
          stdout: "",
          stderr: "Sandbox keeper received fatal signal 6",
          code: 1,
          signal: "SIGABRT",
          status: "RE",
        },
      });
    const runner = createPistonRunnerProvider({
      client: { execute } as unknown as PistonClient,
      providerUsed: "local_hot150",
    });

    const result = await runner.run({
      problem: {
        ...localProblem,
        slug: "minimum-window-substring",
        title: "Minimum Window Substring",
        leetcodeNumber: 76,
        methodName: "minWindow",
        inputContract: {
          name: "minWindow",
          params: [
            { name: "s", type: "string" },
            { name: "t", type: "string" },
          ],
          returnType: "string",
          contractKind: "pure_function",
        },
      },
      language: "Python",
      code: [
        "class Solution:",
        "    def minWindow(self, s: str, t: str) -> str:",
        "        return s",
      ].join("\n"),
      testCases: [
        {
          id: "case-1",
          label: "sample 1",
          input: { s: "ADOBECODEBANC", t: "ABC" },
          expected: "BANC",
        },
        {
          id: "case-2",
          label: "sample 2",
          input: { s: "a", t: "a" },
          expected: "a",
        },
        {
          id: "case-3",
          label: "sample 3",
          input: { s: "a", t: "aa" },
          expected: "",
        },
      ],
      executionKind: "visible_run",
    });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("runner_error");
    expect(result.failureProvenance).toBe("sandbox_service");
    expect(result.passedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.firstFailedCase).toMatchObject({
      id: "case-3",
      label: "sample 3",
      error: "Sandbox keeper received fatal signal 6",
    });
    expect(result.testResults).toMatchObject([
      { id: "case-1", status: "passed", passed: true },
      { id: "case-2", status: "passed", passed: true },
      { id: "case-3", status: "internal_error", passed: false },
    ]);
    expect(result.rawResult).toMatchObject({
      providerUsed: "local_hot150",
      result: { strategy: "isolated_piston_cases" },
    });
  });

  it("returns an explicit unsupported-language result for non-demo C++", async () => {
    const execute = vi.fn();
    const runner = createPistonRunnerProvider({
      client: { execute } as unknown as PistonClient,
      providerUsed: "local_hot150",
    });

    const result = await runner.run({
      problem: localProblem,
      language: "C++",
      code: "class Solution {};",
      testCases: [
        { id: "case-1", label: "local sample", input: {}, expected: 0 },
      ],
      executionKind: "visible_run",
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.status).toBe("unsupported_language");
    expect(result.stderr).toContain("C++ local Run is not supported yet");
  });

  it("does not call Piston for non-runnable local problems", async () => {
    const execute = vi.fn();
    const runner = createPistonRunnerProvider({
      client: { execute } as unknown as PistonClient,
      providerUsed: "local_hot150",
    });

    const result = await runner.run({
      problem: {
        ...localProblem,
        localRunStatus: "harness_review",
        localRunStatusMessage: "Harness review required.",
      },
      language: "Python",
      code: "class Solution: pass",
      testCases: [
        { id: "case-1", label: "local sample", input: {}, expected: 0 },
      ],
      executionKind: "visible_run",
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.status).toBe("runner_error");
    expect(result.stderr).toContain("Harness review required");
  });

  it("does not use the local Hot-150 wrapper through the demo fallback provider", async () => {
    const execute = vi.fn();
    const runner = createPistonRunnerProvider({
      client: { execute } as unknown as PistonClient,
      providerUsed: "piston_fallback",
    });

    const result = await runner.run({
      problem: localProblem,
      language: "Python",
      code: "class Solution:\n    def minSubArrayLen(self, target, nums):\n        return 2",
      testCases: [
        {
          id: "case-1",
          label: "local sample",
          input: { target: 7, nums: [2, 3, 1, 2, 4, 3] },
          expected: 2,
        },
      ],
      executionKind: "review",
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.status).toBe("runner_error");
    expect(result.stderr).toContain("requires the remote LeetCode judge");
    expect(result.rawResult).toMatchObject({ providerUsed: "piston_fallback" });
  });
});
