import { describe, expect, it } from "vitest";
import {
  isGenuineDiagnosisForSelfCheck,
  nonNoiseSelfCheckTags,
} from "@/server/agents/coach-agent/self-check-eligibility";

describe("self-check eligibility", () => {
  it("accepts a genuine method-level diagnosis even when the user summary names an error", () => {
    expect(
      isGenuineDiagnosisForSelfCheck({
        runStatus: "runtime_error",
        mistakeTags: ["graph_bfs_transition"],
        userIssueSummary:
          "遇到蛇/梯子时错误地覆盖了 nextpos 变量，导致 KeyError: 0",
        coachSummary: "BFS 框架完整，但蛇/梯子跳转顺序需要修正。",
      }),
    ).toBe(true);
  });

  it("rejects evidence-only fallback diagnoses", () => {
    expect(
      isGenuineDiagnosisForSelfCheck({
        runStatus: "wrong_answer",
        mistakeTags: ["intervals"],
        userIssueSummary:
          "Wrong Answer: expected [[1,2],[3,10]], actual [[1,2],[3,10],[3,10]].",
        coachSummary:
          "Evidence-only review generated because the coach model did not return usable structured JSON.",
      }),
    ).toBe(false);
  });

  it("rejects passed runs and noise-only tags", () => {
    expect(
      isGenuineDiagnosisForSelfCheck({
        runStatus: "passed_visible_tests",
        mistakeTags: ["sliding_window"],
        userIssueSummary: "当前可见测试通过。",
        coachSummary: "无需自查卡。",
      }),
    ).toBe(false);

    expect(nonNoiseSelfCheckTags(["run_status_failed", "hardcoded_return"])).toEqual(
      [],
    );
  });
});
