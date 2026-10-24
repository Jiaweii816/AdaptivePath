import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCampaignTodayView = vi.fn();
const loadCampaignRoadmapView = vi.fn();
const startOrResumeCampaignWorkbenchEntry = vi.fn();
const createInitialCampaignFromOnboarding = vi.fn();
const decideCampaignPatch = vi.fn();
const maybeEnqueueStrategistWakeForLearner = vi.fn();
const loadCampaignProactiveDashboard = vi.fn();
const advanceCampaignDayForLearner = vi.fn();

vi.mock("@/server/campaign/services", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/campaign/services")>();
  return {
    ...original,
    loadCampaignTodayView,
    loadCampaignRoadmapView,
    startOrResumeCampaignWorkbenchEntry,
    createInitialCampaignFromOnboarding,
    decideCampaignPatch,
    maybeEnqueueStrategistWakeForLearner,
    loadCampaignProactiveDashboard,
    advanceCampaignDayForLearner,
  };
});
vi.mock("@/server/campaign/services/campaign-experience-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/campaign/services/campaign-experience-service")>();
  return { ...original, startOrResumeCampaignWorkbenchEntry };
});
vi.mock("@/server/campaign/services/campaign-patch-review-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/campaign/services/campaign-patch-review-service")>();
  return { ...original, decideCampaignPatch };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/observability/local-trace-user", () => ({
  resolveLocalTraceUserId: vi.fn().mockResolvedValue("server-user"),
}));

describe("Campaign M3B API payloads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("materializes Today through POST and does not leak unsettled mixed node data", async () => {
    loadCampaignTodayView.mockResolvedValue({
      kind: "campaign",
      phase: "consolidation_mixed",
      items: [{
        taskItemId: "item-1",
        problemSlug: "two-sum",
        problemTitle: "Two Sum",
        order: 1,
        slotRole: "mixed",
        roleLabel: "混合训练",
        exposureType: "never_seen",
        exposureLabel: "新题",
        repeatedExposure: false,
        status: "pending",
        canStart: true,
        canResume: false,
        outcome: null,
      }],
    });
    const { POST } = await import("../../../app/api/campaign/today/route");
    const response = await POST();
    const payload = await response.json();
    const serialized = JSON.stringify(payload.view.items[0]);
    expect(response.status).toBe(200);
    expect(serialized).not.toMatch(/nodeId|nodeName|mechanism|coreInvariant|dependency/);
    expect(loadCampaignTodayView).toHaveBeenCalledWith(expect.objectContaining({
      userId: "server-user",
      materialize: true,
    }));
    expect(maybeEnqueueStrategistWakeForLearner).toHaveBeenCalledWith(expect.objectContaining({
      userId: "server-user",
      providerFactory: expect.any(Function),
    }));
  });

  it("refreshes proactive dashboard modules through a read-only Campaign endpoint", async () => {
    loadCampaignProactiveDashboard.mockResolvedValue({
      replan: { status: "empty", proposals: [], overflowRepairs: [] },
      reviewFocus: { status: "empty", board: { cards: [] } },
    });
    const { GET } = await import("../../../app/api/campaign/dashboard/route");
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      dashboard: {
        replan: { status: "empty", proposals: [], overflowRepairs: [] },
        reviewFocus: { status: "empty", board: { cards: [] } },
      },
    });
    expect(loadCampaignProactiveDashboard).toHaveBeenCalledWith(expect.objectContaining({
      userId: "server-user",
    }));
  });

  it("advances Campaign Today through the dedicated next-day endpoint", async () => {
    advanceCampaignDayForLearner.mockResolvedValue({
      kind: "campaign",
      campaignDate: "2026-08-04",
      canAdvanceToNextDay: false,
      nextCampaignDate: null,
    });
    const { POST } = await import("../../../app/api/campaign/next-day/route");
    const response = await POST();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, view: { campaignDate: "2026-08-04" } });
    expect(advanceCampaignDayForLearner).toHaveBeenCalledWith(expect.objectContaining({
      userId: "server-user",
      now: expect.any(Date),
    }));
  });

  it("accepts only tab identity metadata for a server-owned TaskItem entry", async () => {
    startOrResumeCampaignWorkbenchEntry.mockResolvedValue({
      attemptId: "attempt-1",
      workspaceSessionId: "workspace-1",
      workbenchUrl: "/workbench?problem=two-sum&language=Python&campaignAttempt=attempt-1",
      status: "started",
      context: { attemptId: "attempt-1", taskItemId: "item-1" },
    });
    const { POST } = await import("../../../app/api/campaign/task-items/[taskItemId]/attempt/route");
    const response = await POST(new Request("http://localhost/api/campaign/task-items/item-1/attempt", {
      method: "POST",
      headers: { "x-patterncoach-browser-instance-id": "campaign-tab-identity" },
      body: JSON.stringify({ problemSlug: "forged", nodeId: "N20", learnerId: "other" }),
    }), { params: Promise.resolve({ taskItemId: "item-1" }) });
    expect(response.status).toBe(200);
    expect(startOrResumeCampaignWorkbenchEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "server-user",
        taskItemId: "item-1",
        browserInstanceId: "campaign-tab-identity",
      }),
    );
    expect(startOrResumeCampaignWorkbenchEntry.mock.calls[0][1]).not.toHaveProperty("problemSlug");
    expect(startOrResumeCampaignWorkbenchEntry.mock.calls[0][1]).not.toHaveProperty("nodeId");
  });

  it("creates Campaigns from server-owned learner identity and strict onboarding input", async () => {
    createInitialCampaignFromOnboarding.mockResolvedValue({
      kind: "created",
      campaign: {
        campaignId: "campaign-1",
        activeSkeletonVersion: 1,
        endDate: "2099-12-31",
        dailyQuestionBudget: 3,
        language: "Python",
        timezone: "UTC",
      },
    });
    const { POST } = await import("../../../app/api/campaign/onboarding/route");
    const body = {
      endDate: "2099-12-31",
      dailyQuestionBudget: 3,
      language: "Python",
      timezone: "UTC",
      selfReportedWeakNodes: [],
      preferredNodes: [],
      idempotencyToken: "21ed7de9-1b25-45df-8f8c-f791f77a4ec4",
    };
    const response = await POST(new Request("http://localhost/api/campaign/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    expect(createInitialCampaignFromOnboarding).toHaveBeenCalledWith(expect.objectContaining({
      userId: "server-user",
      value: body,
    }));
    expect(createInitialCampaignFromOnboarding.mock.calls[0][0]).not.toHaveProperty("learnerId");
  });

  it("approves a Patch from server identity and operation ids without trusting route-shaping fields", async () => {
    decideCampaignPatch.mockResolvedValue({
      kind: "applied",
      message: "后续学习路线已更新，今日任务保持不变。",
      newVersion: 2,
    });
    const { POST } = await import("../../../app/api/campaign/patches/[patchId]/decision/route");
    const response = await POST(new Request("http://localhost/api/campaign/patches/patch-1/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "partial_accept",
        acceptedOperationIds: ["op-001"],
        acceptDailyBudgetSuggestion: false,
      }),
    }), { params: Promise.resolve({ patchId: "patch-1" }) });
    expect(response.status).toBe(200);
    expect(decideCampaignPatch).toHaveBeenCalledWith(expect.objectContaining({
      userId: "server-user",
      patchId: "patch-1",
      decision: {
        action: "partial_accept",
        acceptedOperationIds: ["op-001"],
        acceptDailyBudgetSuggestion: false,
      },
    }));
    expect(decideCampaignPatch.mock.calls[0][0]).not.toHaveProperty("campaignId");
    expect(decideCampaignPatch.mock.calls[0][0]).not.toHaveProperty("baseVersion");
  });

  it("rejects forged Patch operations and resulting Skeleton fields before the service", async () => {
    const { POST } = await import("../../../app/api/campaign/patches/[patchId]/decision/route");
    const response = await POST(new Request("http://localhost/api/campaign/patches/patch-1/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "accept_all",
        acceptDailyBudgetSuggestion: false,
        campaignId: "forged-campaign",
        baseVersion: 99,
        operations: [{ type: "set_mastery", nodeId: "N1" }],
        resultingSkeleton: { version: 99 },
      }),
    }), { params: Promise.resolve({ patchId: "patch-1" }) });
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ ok: false, code: "validation_failed" });
    expect(decideCampaignPatch).not.toHaveBeenCalled();
  });
});
