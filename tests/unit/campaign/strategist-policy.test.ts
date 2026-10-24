import { describe, expect, it } from "vitest";
import {
  evaluateStrategistWake,
  validateAutomaticStrategistProposal,
} from "@/server/campaign/core";
import {
  parseStrategistProviderOutput,
  strategistDigest,
  type StrategistWakeSnapshot,
} from "@/server/campaign/domain";

function snapshot(overrides: Partial<StrategistWakeSnapshot> = {}): StrategistWakeSnapshot {
  return {
    campaignDate: "2026-08-04",
    activeSkeletonVersion: 1,
    campaignWeek: 2,
    goalDigest: strategistDigest("goal"),
    stateDigest: strategistDigest("state"),
    frontierDigest: strategistDigest(["N1"]),
    phase: "coverage",
    receiptDigest: strategistDigest("receipts"),
    repairDigest: strategistDigest("repairs"),
    masteredNodeIds: [],
    pendingRepairCount: 0,
    oldestPendingRepairAgeDays: 0,
    consecutiveIncompleteReceipts: 0,
    consecutiveShortfallReceipts: 0,
    evaluatedWatermark: "2026-08-04T12:00:00.000Z",
    ...overrides,
  };
}

describe("Strategist wake evaluator", () => {
  it("skips pending patches before every trigger", () => {
    expect(evaluateStrategistWake({
      campaignId: "campaign-1",
      campaignDate: "2026-08-04",
      activeSkeletonVersion: 1,
      pendingPatchExists: true,
      current: snapshot({ pendingRepairCount: 5 }),
      latestCompleted: null,
    })).toMatchObject({ shouldWake: false, skippedReason: "pending_patch_exists" });
  });

  it("uses goal, significant-state, weekly, then no-trigger priority", () => {
    const prior = snapshot();
    const base = {
      campaignId: "campaign-1",
      campaignDate: "2026-08-04",
      activeSkeletonVersion: 1,
      pendingPatchExists: false,
      latestCompleted: prior,
    };
    expect(evaluateStrategistWake({ ...base, current: snapshot({ goalDigest: strategistDigest("goal-2") }) }).trigger).toBe("goal_changed");
    expect(evaluateStrategistWake({ ...base, current: snapshot({ masteredNodeIds: ["N1"], stateDigest: strategistDigest("mastered") }) }).trigger).toBe("significant_state_change");
    expect(evaluateStrategistWake({ ...base, current: snapshot({ pendingRepairCount: 3, repairDigest: strategistDigest("new-repairs") }) }).reasons).toContain("repair_backlog");
    expect(evaluateStrategistWake({ ...base, current: snapshot({ consecutiveIncompleteReceipts: 2, receiptDigest: strategistDigest("new-receipts") }) }).reasons).toContain("consecutive_incomplete_days");
    expect(evaluateStrategistWake({ ...base, current: snapshot({ campaignWeek: 3 }) }).trigger).toBe("weekly_boundary");
    expect(evaluateStrategistWake({ ...base, current: snapshot() })).toMatchObject({ shouldWake: false, skippedReason: "no_trigger" });
  });

  it("is deterministic and does not retrigger unchanged threshold state", () => {
    const prior = snapshot({ pendingRepairCount: 3, oldestPendingRepairAgeDays: 3 });
    const input = {
      campaignId: "campaign-1",
      campaignDate: "2026-08-05",
      activeSkeletonVersion: 1,
      pendingPatchExists: false,
      current: snapshot({ campaignDate: "2026-08-05", pendingRepairCount: 3, oldestPendingRepairAgeDays: 4 }),
      latestCompleted: prior,
    };
    expect(evaluateStrategistWake(input)).toEqual(evaluateStrategistWake(input));
    expect(evaluateStrategistWake(input).shouldWake).toBe(false);
  });
});

describe("Strategist provider protocol and automatic policy", () => {
  it("strictly parses no-change and canonical M4A operations", () => {
    expect(parseStrategistProviderOutput(JSON.stringify({ decision: "no_change", rationale: "Keep the route stable." }))).toMatchObject({ decision: "no_change" });
    expect(parseStrategistProviderOutput(JSON.stringify({
      decision: "propose_patch",
      rationale: "Move a future node.",
      operations: [{ type: "set_node_priority", nodeId: "N2", priority: 80 }],
      dailyBudgetSuggestion: null,
    }))).toMatchObject({ decision: "propose_patch" });
    expect(() => parseStrategistProviderOutput(JSON.stringify({ decision: "no_change", rationale: "x", patchId: "forged" }))).toThrow();
    expect(() => parseStrategistProviderOutput(JSON.stringify({ decision: "propose_patch", rationale: "x", operations: [{ type: "set_mastery", nodeId: "N2" }], dailyBudgetSuggestion: null }))).toThrow();
    expect(() => parseStrategistProviderOutput(JSON.stringify({ decision: "propose_patch", rationale: "x", operations: Array.from({ length: 9 }, () => ({ type: "set_node_priority", nodeId: "N2", priority: 1 })), dailyBudgetSuggestion: null }))).toThrow();
    expect(() => parseStrategistProviderOutput(JSON.stringify({ decision: "no_change", rationale: "x".repeat(501) }))).toThrow();
    expect(() => parseStrategistProviderOutput("not json")).toThrow();
  });

  it("allows only future unstarted transferable changes", () => {
    const base = { nodeStates: [{ nodeId: "N1", started: true, masteryState: "learning" as const }, { nodeId: "N2", started: false, masteryState: "learning" as const }], transferableNodeIds: ["N1", "N2"] };
    expect(validateAutomaticStrategistProposal({ ...base, operations: [{ type: "set_node_priority", nodeId: "N2", priority: 90 }] }).valid).toBe(true);
    expect(validateAutomaticStrategistProposal({ ...base, operations: [{ type: "set_target_week", nodeId: "N2", targetWeek: 3 }] }).valid).toBe(true);
    expect(validateAutomaticStrategistProposal({ ...base, operations: [{ type: "set_node_rationale", nodeId: "N2", rationale: "Keep this future mechanism near the front." }] }).valid).toBe(true);
    expect(validateAutomaticStrategistProposal({ ...base, operations: [{ type: "move_node", nodeId: "N2", afterNodeId: "N1" }] }).valid).toBe(true);
    expect(validateAutomaticStrategistProposal({ ...base, operations: [{ type: "set_mixed_window_days", mixedWindowDays: 10 }] }).valid).toBe(true);
    expect(validateAutomaticStrategistProposal({ ...base, operations: [{ type: "set_node_priority", nodeId: "N1", priority: 90 }] })).toMatchObject({ valid: false });
    expect(validateAutomaticStrategistProposal({ ...base, operations: [{ type: "set_node_included", nodeId: "N2", included: false }] })).toMatchObject({ valid: false });
    expect(validateAutomaticStrategistProposal({ ...base, operations: [{ type: "set_node_priority", nodeId: "N3", priority: 90 }] })).toMatchObject({ valid: false });
  });
});
