import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadView: vi.fn(),
  loadPlanning: vi.fn(),
  proposal: vi.fn(),
  simulation: vi.fn(),
  resolveActive: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("@/server/db/prisma", () => ({ default: {} }));
vi.mock("@/server/observability/local-trace-user", () => ({ resolveLocalTraceUserId: mocks.resolveUser }));
vi.mock("@/server/campaign/services", () => ({
  loadCampaignStrategistProductView: mocks.loadView,
  loadCampaignPlanningReviewView: mocks.loadPlanning,
  requestCampaignStrategistProposal: mocks.proposal,
  requestCampaignStrategistSimulation: mocks.simulation,
  resolveActiveCampaignForLearner: mocks.resolveActive,
}));

import { GET, POST } from "../../../app/api/campaign/strategist/runs/route";

describe("Campaign Strategist product API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveUser.mockResolvedValue("user-1");
    mocks.resolveActive.mockResolvedValue({ kind: "active", campaign: { id: "campaign-1" } });
    mocks.loadPlanning.mockResolvedValue({ status: "idle", pendingPatch: null });
  });

  it("creates a simulation run without routing it through the proposal service", async () => {
    mocks.simulation.mockResolvedValue({ kind: "queued", run: { id: "simulation-run", status: "queued" } });
    const response = await POST(new Request("http://localhost/api/campaign/strategist/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignDate: "2026-08-05", requestText: "What if Graph stays mastery?", runMode: "simulation" }),
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, result: { kind: "queued", runId: "simulation-run", status: "queued", runMode: "simulation" } });
    expect(mocks.simulation).toHaveBeenCalledOnce();
    expect(mocks.proposal).not.toHaveBeenCalled();
  });

  it("allows a Chinese Today-protection constraint into a What-if simulation", async () => {
    mocks.simulation.mockResolvedValue({ kind: "queued", run: { id: "protected-simulation", status: "queued" } });
    const requestText = "模拟未来三天的学习路线，每天最多做 3 题。优先复习动态规划，不修改今天的任务，不查看日历。这次只做模拟，不生成正式提案。";
    const response = await POST(new Request("http://localhost/api/campaign/strategist/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignDate: "2026-08-05", requestText, runMode: "simulation" }),
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, result: { runId: "protected-simulation", runMode: "simulation" } });
    expect(mocks.simulation).toHaveBeenCalledWith(expect.objectContaining({ requestText }));
    expect(mocks.proposal).not.toHaveBeenCalled();
  });

  it("creates a proposal run without routing it through the simulation service", async () => {
    mocks.proposal.mockResolvedValue({ kind: "queued", run: { id: "proposal-run", status: "queued" } });
    const response = await POST(new Request("http://localhost/api/campaign/strategist/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignDate: "2026-08-05", requestText: "Prioritize Graph next week.", runMode: "proposal" }),
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, result: { kind: "queued", runId: "proposal-run", status: "queued", runMode: "proposal" } });
    expect(mocks.proposal).toHaveBeenCalledOnce();
    expect(mocks.simulation).not.toHaveBeenCalled();
  });

  it("allows the same Today-protection constraint in proposal mode", async () => {
    mocks.proposal.mockResolvedValue({ kind: "queued", run: { id: "protected-proposal", status: "queued" } });
    const requestText = "不要修改今天的任务，只调整明天以后";
    const response = await POST(new Request("http://localhost/api/campaign/strategist/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignDate: "2026-08-05", requestText, runMode: "proposal" }),
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, result: { runId: "protected-proposal", runMode: "proposal" } });
    expect(mocks.proposal).toHaveBeenCalledWith(expect.objectContaining({ requestText }));
  });

  it("rejects a Today mutation before creating any Strategist run", async () => {
    const response = await POST(new Request("http://localhost/api/campaign/strategist/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignDate: "2026-08-05", requestText: "只修改今天，替换今天第一道题", runMode: "proposal" }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, code: "unsupported_scope_today_immutable" });
    expect(mocks.simulation).not.toHaveBeenCalled();
    expect(mocks.proposal).not.toHaveBeenCalled();
  });

  it("returns only the safe Strategist product presenter for polling", async () => {
    const strategist = { status: "ready", routeRisk: { level: "clear", label: "清晰", detail: "无阻塞" }, calendarConfigured: false, latestRun: null };
    mocks.loadView.mockResolvedValue(strategist);
    const response = await GET(new Request("http://localhost/api/campaign/strategist/runs"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, strategist, planning: { status: "idle", pendingPatch: null } });
    expect(mocks.loadView).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", campaignId: "campaign-1" }));
  });

  it("polls the run requested by the WebUI instead of an unrelated latest run", async () => {
    const strategist = { status: "ready", routeRisk: { level: "checking", label: "checking", detail: "running" }, calendarConfigured: false, latestRun: { runId: "simulation-run" } };
    mocks.loadView.mockResolvedValue(strategist);
    const response = await GET(new Request("http://localhost/api/campaign/strategist/runs?runId=simulation-run"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, strategist, planning: { status: "idle", pendingPatch: null } });
    expect(mocks.loadView).toHaveBeenCalledWith(expect.objectContaining({ runId: "simulation-run" }));
  });
});
