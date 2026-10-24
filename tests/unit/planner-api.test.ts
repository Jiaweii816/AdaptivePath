import { beforeEach, describe, expect, it, vi } from "vitest";

const createOrUpdatePlannerGoal = vi.fn();
const recordPlannerOutcome = vi.fn();
const applyPlannerProposal = vi.fn();
const advancePlannerDoseBatch = vi.fn();
const startPlannerPlanItem = vi.fn();
const skipPlannerDoseItem = vi.fn();

class MockPlannerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

vi.mock("@/server/planner/planner-service", () => ({
  PlannerError: MockPlannerError,
  advancePlannerDoseBatch,
  applyPlannerProposal,
  createOrUpdatePlannerGoal,
  recordPlannerOutcome,
  skipPlannerDoseItem,
  startPlannerPlanItem,
}));
vi.mock("@/server/observability/local-trace-user", () => ({
  resolveLocalTraceUserId: vi.fn().mockResolvedValue("planner-api-user"),
}));

describe("planner API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a readiness goal", async () => {
    createOrUpdatePlannerGoal.mockResolvedValue({ id: "goal-1" });
    const { POST } = await import("../../app/api/planner/goal/route");
    const response = await POST(
      new Request("http://localhost/api/planner/goal", {
        method: "POST",
        body: JSON.stringify({
          targetLabel: "泛 FAANG",
          interviewDate: "2026-07-17",
          weeklyHours: 8,
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      goalId: "goal-1",
    });
  });

  it("returns 400 for malformed goal JSON", async () => {
    const { POST } = await import("../../app/api/planner/goal/route");
    const response = await POST(
      new Request("http://localhost/api/planner/goal", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Malformed JSON request body.",
    });
  });

  it("records a planner outcome", async () => {
    recordPlannerOutcome.mockResolvedValue({
      alreadyRecorded: false,
      outcome: { id: "outcome-1" },
      proposalCreated: true,
    });
    const { POST } = await import("../../app/api/planner/outcome/route");
    const response = await POST(
      new Request("http://localhost/api/planner/outcome", {
        method: "POST",
        body: JSON.stringify({
          problemHistoryId: "history-1",
          reviewAttemptId: "review-1",
          selfRating: "struggled",
        }),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      outcomeId: "outcome-1",
      proposalCreated: true,
      redirectTo: "/campaign/today",
    });
  });

  it("starts a planner item", async () => {
    startPlannerPlanItem.mockResolvedValue({
      planItemId: "plan-item-1",
      problemId: "problem-1",
      slug: "two-sum",
      startedAt: new Date("2026-06-17T12:00:00Z"),
      lastOpenedAt: new Date("2026-06-17T12:00:00Z"),
    });
    const { POST } = await import("../../app/api/planner/start/route");
    const response = await POST(
      new Request("http://localhost/api/planner/start", {
        method: "POST",
        body: JSON.stringify({ planItemId: "plan-item-1" }),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      planItemId: "plan-item-1",
      problemId: "problem-1",
      slug: "two-sum",
    });
    expect(startPlannerPlanItem).toHaveBeenCalledWith({
      planItemId: "plan-item-1",
    });
  });

  it("skips a planner item", async () => {
    skipPlannerDoseItem.mockResolvedValue({
      hasGoal: true,
      dose: [],
    });
    const { POST } = await import("../../app/api/planner/skip/route");
    const response = await POST(
      new Request("http://localhost/api/planner/skip", {
        method: "POST",
        body: JSON.stringify({ planItemId: "plan-item-1" }),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        hasGoal: true,
      },
    });
    expect(skipPlannerDoseItem).toHaveBeenCalledWith({
      planItemId: "plan-item-1",
    });
  });

  it("returns 400 for malformed skip JSON", async () => {
    const { POST } = await import("../../app/api/planner/skip/route");
    const response = await POST(
      new Request("http://localhost/api/planner/skip", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Malformed JSON request body.",
    });
  });

  it("applies a proposal decision", async () => {
    applyPlannerProposal.mockResolvedValue({
      id: "proposal-1",
      status: "accepted",
    });
    const { POST } = await import(
      "../../app/api/planner/proposals/[proposalId]/route"
    );
    const response = await POST(
      new Request("http://localhost/api/planner/proposals/proposal-1", {
        method: "POST",
        body: JSON.stringify({ decision: "accept" }),
      }),
      { params: Promise.resolve({ proposalId: "proposal-1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      proposalId: "proposal-1",
      status: "accepted",
    });
    expect(applyPlannerProposal).toHaveBeenCalledWith(
      "proposal-1",
      "accept",
      expect.objectContaining({ userId: "planner-api-user" }),
    );
  });

  it("continues to the next Today dose batch", async () => {
    advancePlannerDoseBatch.mockResolvedValue({
      advancedCount: 5,
      fromDate: "2026-06-18",
      toDate: "2026-06-17",
    });
    const { POST } = await import("../../app/api/planner/advance-dose/route");
    const response = await POST();

    await expect(response.json()).resolves.toEqual({
      ok: true,
      advancedCount: 5,
      fromDate: "2026-06-18",
      toDate: "2026-06-17",
    });
    expect(advancePlannerDoseBatch).toHaveBeenCalledTimes(1);
  });

  it("keeps the old advance-day API route compatible", async () => {
    advancePlannerDoseBatch.mockResolvedValue({
      advancedCount: 5,
      fromDate: "2026-06-18",
      toDate: "2026-06-17",
    });
    const { POST } = await import("../../app/api/planner/advance-day/route");
    const response = await POST();

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      advancedCount: 5,
    });
    expect(advancePlannerDoseBatch).toHaveBeenCalledTimes(1);
  });
});
