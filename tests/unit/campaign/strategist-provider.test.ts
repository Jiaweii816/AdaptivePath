import { describe, expect, it, vi } from "vitest";
import { createOpenAiStrategistProvider } from "@/server/campaign/services";
import type { StrategistReadModel } from "@/server/campaign/domain";

const readModel = {
  readModelVersion: 1,
  campaign: { campaignId: "c", startDate: "2026-08-01", endDate: "2026-09-01", campaignDate: "2026-08-04", remainingDays: 28, dailyQuestionBudget: 3, language: "Python", selfReportedWeakNodes: [], preferredNodes: [], mixedWindowDays: 7, goalUpdatedAt: "2026-08-04T00:00:00.000Z" },
  activeSkeleton: { version: 1, nodePlans: [] },
  learnerNodes: [],
  nonTransferableSupply: [],
  recentReceipts: [],
  repairQueue: [],
  planningHistory: [],
  operational: { phase: "coverage", advanceFrontierNodeIds: [], currentPrimaryNodeId: null, dailyTaskGenerated: true, pendingPatchExists: false, latestStrategistRunWatermark: null, shortfallDaysInWindow: 0 },
} satisfies StrategistReadModel;

describe("OpenAI-compatible Strategist provider", () => {
  it("makes exactly one structured non-streaming call", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "strategist-model",
      choices: [{ message: { content: '{"decision":"no_change","rationale":"stable"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    });
    const provider = createOpenAiStrategistProvider({ client: { chat: { completions: { create } } } as never, model: "strategist-model" });
    const result = await provider.propose(readModel);
    expect(result.content).toContain("no_change");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ response_format: { type: "json_object" }, model: "strategist-model" });
    expect(create.mock.calls[0][0].stream).not.toBe(true);
  });

  it("does not perform a semantic repair call after provider failure", async () => {
    const create = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const provider = createOpenAiStrategistProvider({ client: { chat: { completions: { create } } } as never, model: "strategist-model" });
    await expect(provider.propose(readModel)).rejects.toThrow("provider unavailable");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
