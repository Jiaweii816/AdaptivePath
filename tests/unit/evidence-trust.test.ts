import { describe, expect, it } from "vitest";
import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import type { CodeRunResult } from "@/types/code-runner";

function run(status: CodeRunResult["status"], overrides: Partial<CodeRunResult> = {}) {
  return {
    status,
    passedCount: status === "passed_visible_tests" ? 1 : 0,
    failedCount: status === "passed_visible_tests" ? 0 : 1,
    stdout: "",
    stderr: "",
    testResults: [],
    ...overrides,
  } satisfies CodeRunResult;
}

describe("classifyExecutionEvidence", () => {
  it("treats user-code outcomes as verdict-bearing evidence", () => {
    for (const status of [
      "passed_visible_tests",
      "failed",
      "compile_error",
      "syntax_error",
      "runtime_error",
      "timeout",
    ] as const) {
      const verdict = classifyExecutionEvidence(
        run(status, { failureProvenance: "user_code" }),
        { consumer: "review", providerUsed: "lc_submit" },
      );

      expect(verdict.evidenceClass).toBe("verdict_bearing");
      expect(verdict.capabilities.canVerdict).toBe(true);
      expect(verdict.capabilities.canWriteEpisode).toBe(true);
      expect(verdict.capabilities.canWriteMistakeMemory).toBe(
        status !== "passed_visible_tests",
      );
      expect(verdict.capabilities.canUseFailureSalience).toBe(
        status !== "passed_visible_tests",
      );
    }
  });

  it("treats service and adapter failures as unavailable, not wrong answers", () => {
    for (const provenance of [
      "judge_service",
      "sandbox_service",
      "adapter",
      "network",
    ] as const) {
      const verdict = classifyExecutionEvidence(
        run("runner_error", { failureProvenance: provenance }),
        { consumer: "review", providerUsed: "lc_submit" },
      );

      expect(verdict.evidenceClass).toBe("evidence_unavailable");
      expect(verdict.replyMode).toBe("unavailable");
      expect(verdict.capabilities).toMatchObject({
        canVerdict: false,
        canWriteMistakeMemory: false,
        canWriteEpisode: false,
        canSignalPlanner: false,
        canUseFailureSalience: false,
      });
    }
  });

  it("treats missing runnable input as user_input evidence", () => {
    for (const status of ["empty_code", "no_tests", "unsupported_language"] as const) {
      const verdict = classifyExecutionEvidence(run(status), {
        consumer: "chat_run",
        providerUsed: "mock",
      });

      expect(verdict.evidenceClass).toBe("user_input");
      expect(verdict.replyMode).toBe("user_input_fix");
      expect(verdict.capabilities.canVerdict).toBe(false);
      expect(verdict.modelInstruction).toContain("Do not assert code correctness");
    }
  });

  it("labels aligned local Review evidence as local_only with the normal Review memory gates", () => {
    const failed = classifyExecutionEvidence(
      run("failed", { failureProvenance: "user_code" }),
      {
        consumer: "review",
        providerUsed: "remote_unavailable_local_fallback",
        localFallback: true,
        fallbackFromProvider: "lc_submit",
      },
    );
    const passed = classifyExecutionEvidence(
      run("passed_visible_tests", { failureProvenance: "user_code" }),
      {
        consumer: "review",
        providerUsed: "remote_unavailable_local_fallback",
        localFallback: true,
        fallbackFromProvider: "lc_submit",
      },
    );

    expect(failed.evidenceClass).toBe("local_only");
    expect(failed.capabilities.canVerdict).toBe(true);
    expect(failed.capabilities.canWriteMistakeMemory).toBe(true);
    expect(failed.capabilities.canWriteEpisode).toBe(true);
    expect(failed.capabilities.canSignalPlanner).toBe(false);
    expect(failed.capabilities.canUseFailureSalience).toBe(true);
    expect(passed.capabilities.canWriteMistakeMemory).toBe(false);
    expect(passed.capabilities.canWriteEpisode).toBe(true);
    expect(passed.capabilities.canSignalPlanner).toBe(true);
    expect(failed.modelInstruction).toContain("never claim official acceptance");
  });

  it.each(["local_hot150", "piston", "piston_fallback", "lc_run"])(
    "classifies %s as local visible evidence instead of official judge evidence",
    (providerUsed) => {
      const verdict = classifyExecutionEvidence(
        run("failed", { failureProvenance: "user_code" }),
        { consumer: "review", providerUsed },
      );

      expect(verdict).toMatchObject({
        evidenceClass: "local_only",
        providerUsed,
        capabilities: {
          canVerdict: true,
          canWriteMistakeMemory: true,
          canWriteEpisode: true,
          canSignalPlanner: false,
          canUseFailureSalience: true,
        },
      });
    },
  );

  it("never treats deterministic mock output as real learner evidence", () => {
    const verdict = classifyExecutionEvidence(
      run("failed", { failureProvenance: "user_code" }),
      { consumer: "review", providerUsed: "mock" },
    );

    expect(verdict.evidenceClass).toBe("evidence_unavailable");
    expect(verdict.capabilities).toMatchObject({
      canVerdict: false,
      canWriteMistakeMemory: false,
      canWriteEpisode: false,
      canSignalPlanner: false,
      canUseFailureSalience: false,
    });
  });

  it.each(["chat_run", "practice_run"] as const)(
    "keeps %s local execution outside Review L2 and Episode capabilities",
    (consumer) => {
      const verdict = classifyExecutionEvidence(
        run("failed", { failureProvenance: "user_code" }),
        { consumer, providerUsed: "local_hot150" },
      );

      expect(verdict.evidenceClass).toBe("local_only");
      expect(verdict.capabilities).toMatchObject({
        canVerdict: true,
        canWriteMistakeMemory: false,
        canWriteEpisode: false,
        canUseFailureSalience: false,
      });
    },
  );
});
