import { describe, expect, it } from "vitest";
import {
  applyPhaseGuard,
  elapsedInterviewMinutes,
  legalNextPhases,
  shouldForceWrapUp,
} from "@/server/mock-interview/interview-phase-policy";

describe("mock interview phase policy", () => {
  it("allows staying in phase or advancing exactly one phase", () => {
    expect(legalNextPhases("intro")).toEqual(["intro", "technical_screen"]);
    expect(
      applyPhaseGuard({
        currentPhase: "intro",
        proposedPhase: "technical_screen",
      }),
    ).toBe("technical_screen");
    expect(
      applyPhaseGuard({ currentPhase: "coding", proposedPhase: "stay" }),
    ).toBe("coding");
  });

  it("prevents backtracking and illegal skips", () => {
    expect(
      applyPhaseGuard({
        currentPhase: "coding",
        proposedPhase: "technical_screen",
      }),
    ).toBe("coding");
    expect(
      applyPhaseGuard({ currentPhase: "intro", proposedPhase: "coding" }),
    ).toBe("intro");
    expect(
      applyPhaseGuard({ currentPhase: "technical_screen", proposedPhase: "wrap_up" }),
    ).toBe("technical_screen");
  });

  it("forces wrap-up when time or question budget is exhausted", () => {
    const startedAt = new Date("2026-06-17T10:00:00.000Z");

    expect(
      shouldForceWrapUp({
        startedAt,
        durationMinutes: 25,
        questionCount: 9,
        maxQuestions: 10,
        now: new Date("2026-06-17T10:25:00.000Z"),
      }),
    ).toBe(true);
    expect(
      shouldForceWrapUp({
        startedAt,
        durationMinutes: 25,
        questionCount: 10,
        maxQuestions: 10,
        now: new Date("2026-06-17T10:10:00.000Z"),
      }),
    ).toBe(true);
    expect(
      applyPhaseGuard({
        currentPhase: "coding",
        proposedPhase: "stay",
        forceWrapUp: true,
      }),
    ).toBe("wrap_up");
  });

  it("reports elapsed whole minutes without going negative", () => {
    const startedAt = new Date("2026-06-17T10:00:00.000Z");

    expect(
      elapsedInterviewMinutes(startedAt, new Date("2026-06-17T10:12:30.000Z")),
    ).toBe(12);
    expect(
      elapsedInterviewMinutes(startedAt, new Date("2026-06-17T09:59:59.000Z")),
    ).toBe(0);
  });
});
