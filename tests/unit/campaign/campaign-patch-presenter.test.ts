import { describe, expect, it } from "vitest";
import { genericCampaignSkeleton } from "@/server/campaign/curriculum";
import {
  canonicalJson,
  canonicalizePatchOperations,
  type CampaignSkeletonPatchOperation,
} from "@/server/campaign/domain";
import { buildCampaignPatchReviewView } from "@/server/campaign/presentation";

const baseSkeleton = {
  version: 1,
  mixedWindowDays: genericCampaignSkeleton.mixedWindowDays,
  nodePlans: genericCampaignSkeleton.nodePlans,
};

function patch(operations: readonly CampaignSkeletonPatchOperation[], extra: Record<string, unknown> = {}) {
  return {
    id: "patch-safe-opaque-id",
    status: "pending",
    trigger: "strategist_weekly_boundary",
    rationale: "根据近期进度，小幅调整尚未开始的后续路线。",
    createdAt: new Date("2026-08-04T15:00:00.000Z"),
    baseVersion: 1,
    operationsJson: canonicalJson({
      patchSchemaVersion: 1,
      operations: canonicalizePatchOperations(operations),
    }),
    dailyBudgetSuggestionJson: null,
    ...extra,
  };
}

describe("Campaign Patch review presenter", () => {
  it("maps every canonical operation to stable, readable before/after copy", () => {
    const view = buildCampaignPatchReviewView({
      patch: patch([
        { type: "set_node_included", nodeId: "N1", included: false },
        { type: "move_node", nodeId: "N19", beforeNodeId: "N18" },
        { type: "set_node_priority", nodeId: "N2", priority: 90 },
        { type: "set_target_week", nodeId: "N4", targetWeek: 3 },
        { type: "set_node_rationale", nodeId: "N7", rationale: "先巩固区间状态，再进入后续路线。" },
        { type: "set_mixed_window_days", mixedWindowDays: 10 },
      ], {
        dailyBudgetSuggestionJson: canonicalJson({
          proposedBudget: 4,
          rationale: "未来每天增加一道题，以匹配剩余天数。",
        }),
      }),
      baseSkeleton,
      activeVersion: 1,
      currentDailyBudget: 3,
    });

    expect(view.operations.map((operation) => operation.operationId)).toEqual([
      "op-001", "op-002", "op-003", "op-004", "op-005", "op-006",
    ]);
    expect(view.triggerLabel).toBe("Weekly route check");
    expect(view.operations.map((operation) => operation.operationType)).toEqual([
      "set_node_included",
      "move_node",
      "set_node_priority",
      "set_target_week",
      "set_node_rationale",
      "set_mixed_window_days",
    ]);
    expect(view.operations[0].readableDescription).toContain("Remove");
    expect(view.operations[1]).toMatchObject({ beforeValue: "Position 16", afterValue: "Before Heaps and Top-K (position 15)" });
    expect(view.operations[2].readableDescription).toContain("Raise");
    expect(view.operations[3].readableDescription).toContain("target week");
    expect(view.operations[4].readableDescription).toContain("route rationale");
    expect(view.operations[5].readableDescription).toContain("from 7 to 10 days");
    expect(view.dailyBudgetSuggestion).toEqual({
      currentBudget: 3,
      proposedBudget: 4,
      rationale: "未来每天增加一道题，以匹配剩余天数。",
    });
    expect(view.impactSummary).toMatchObject({ affectedNodeCount: 5, currentDailyTaskUnaffected: true });
    expect(view.operations.every((operation) => operation.selectedByDefault && operation.selectable)).toBe(true);
  });

  it("marks stale proposals as reject-only and never exposes raw planning records", () => {
    const view = buildCampaignPatchReviewView({
      patch: patch([{ type: "set_node_priority", nodeId: "N2", priority: 80 }]),
      baseSkeleton,
      activeVersion: 2,
      currentDailyBudget: 3,
    });
    expect(view).toMatchObject({ isStale: true, canAccept: false, canPartiallyAccept: false, canReject: true });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/learnerId|ownerId|operationsJson|validatorSummaryJson|promptVersion|triggerFingerprint|StrategistReadModel|SELECT |Prisma/);
  });

  it("projects validator warnings as bounded user-facing text", () => {
    const view = buildCampaignPatchReviewView({
      patch: patch([{ type: "move_node", nodeId: "N8", beforeNodeId: "N1" }]),
      baseSkeleton,
      activeVersion: 1,
      currentDailyBudget: 3,
    });
    expect(view.warnings).toContain("This change does not follow a recommended learning order, but it does not block the route.");
    expect(JSON.stringify(view.warnings)).not.toContain("Recommended prerequisite");
  });
});
