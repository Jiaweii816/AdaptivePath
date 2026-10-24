import { describe, expect, it } from "vitest";
import {
  difficultyBadgeClass,
  runStatusKind,
  runStatusLabel,
  skillStatusBarClass,
} from "@/lib/ui-status";

describe("ui-status", () => {
  it("maps difficulty to a badge class", () => {
    expect(difficultyBadgeClass("Easy")).toContain("emerald");
    expect(difficultyBadgeClass("Medium")).toContain("amber");
    expect(difficultyBadgeClass("Hard")).toContain("rose");
    expect(difficultyBadgeClass(null)).toContain("muted");
  });

  it("classifies run status into pass/fail/other", () => {
    expect(runStatusKind("passed")).toBe("passed");
    expect(runStatusKind("passed_visible_tests")).toBe("passed");
    expect(runStatusKind("accepted")).toBe("passed");
    expect(runStatusKind("wrong_answer")).toBe("failed");
    expect(runStatusKind("syntax_error")).toBe("failed");
    expect(runStatusKind("timeout")).toBe("failed");
    expect(runStatusKind("runner_error")).toBe("unknown");
    expect(runStatusKind("no_tests")).toBe("unknown");
    expect(runStatusKind("empty_code")).toBe("unknown");
    expect(runStatusKind("unsupported_language")).toBe("unknown");
    expect(runStatusKind("")).toBe("unknown");
  });

  it("gives a human label for run status", () => {
    expect(runStatusLabel("passed")).toBe("Passed");
    expect(runStatusLabel("wrong_answer")).toBe("Failed");
    expect(runStatusLabel("runner_error")).toBe("Unavailable");
    expect(runStatusLabel("no_tests")).toBe("Needs tests");
    expect(runStatusLabel("empty_code")).toBe("Needs code");
    expect(runStatusLabel("unsupported_language")).toBe("Unsupported");
    expect(runStatusLabel("")).toBe("Unknown");
  });

  it("colors skill bars by status", () => {
    expect(skillStatusBarClass("Strong")).toContain("emerald");
    expect(skillStatusBarClass("Learning")).toContain("sky");
    expect(skillStatusBarClass("Watch")).toContain("amber");
    expect(skillStatusBarClass("Unobserved")).toContain("muted");
  });
});
