import { describe, expect, it } from "vitest";
import { buildGrowthMapLayout } from "@/features/campaign/growth-map-layout";
import type { CampaignRoadmapNodeView } from "@/server/campaign";

function node(index: number, overrides: Partial<CampaignRoadmapNodeView> = {}): CampaignRoadmapNodeView {
  return {
    nodeId: `N${index}`,
    nodeName: `Node ${index}`,
    order: index,
    status: "available",
    statusLabel: "可开始",
    masteryState: "learning",
    masteryHealth: "stable",
    latestPositiveStreak: 0,
    attemptedProblemCount: 0,
    neverSeenProblemCount: 5,
    completedProblems: 0,
    totalProblems: 5,
    masteryProgressCurrent: 0,
    masteryProgressRequired: 2,
    pendingRepairCount: 0,
    current: false,
    available: true,
    locked: false,
    recentSettlements: [],
    coreInvariant: "Invariant",
    requiredPrerequisites: [],
    recommendedPrerequisites: [],
    lockedReason: null,
    ...overrides,
  };
}

describe("R2A Growth Map layout", () => {
  it("places all transferable nodes in stable, unique dependency-map coordinates", () => {
    const nodes = Array.from({ length: 17 }, (_, index) => node(index + 1));
    const first = buildGrowthMapLayout(nodes);
    const second = buildGrowthMapLayout(nodes);
    expect(first).toEqual(second);
    expect(first).toHaveLength(17);
    expect(first[0]).toMatchObject({ node: { nodeId: "N1" }, mobileOrder: 1, x: 500, y: 84 });
    expect(first[11]).toMatchObject({ node: { nodeId: "N12" }, mobileOrder: 11, x: 720, y: 599 });
    expect(first[16]).toMatchObject({ node: { nodeId: "N17" }, mobileOrder: 15, x: 720, y: 955 });
    expect(new Set(first.map((item) => `${item.x}:${item.y}`)).size).toBe(17);
  });

  it("keeps current, locked, and excluded state attached to the server node projection", () => {
    const layout = buildGrowthMapLayout([
      node(1, { current: true, status: "learning", statusLabel: "学习中" }),
      node(2, { status: "locked", statusLabel: "尚未解锁", locked: true, available: false }),
      node(3, { status: "not_included", statusLabel: "本战役未安排", masteryState: null, masteryHealth: null }),
    ]);
    expect(layout.map((item) => item.node.status)).toEqual(["learning", "locked", "not_included"]);
  });

  it("keeps dependency-map coordinates and display identity stable across patched route order", () => {
    const original = [node(1), node(2), node(3), node(4), node(5), node(6)];
    const patched = [original[0], original[5], ...original.slice(1, 5)];
    const originalN4 = buildGrowthMapLayout(original).find((item) => item.node.nodeId === "N4");
    const patchedN4 = buildGrowthMapLayout(patched).find((item) => item.node.nodeId === "N4");
    expect(originalN4).toMatchObject({ x: 520, y: 588, mobileOrder: 9 });
    expect(patchedN4).toMatchObject({ x: 520, y: 588, mobileOrder: 9 });
  });

  it("rejects duplicate positions caused by duplicate node identity", () => {
    expect(() => buildGrowthMapLayout([node(1), node(1)])).toThrow("Duplicate Growth Map node");
  });
});
