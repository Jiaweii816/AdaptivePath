import { describe, expect, it } from "vitest";
import { campaignCurriculumAssets, genericCampaignSkeleton } from "@/server/campaign/curriculum";
import {
  campaignSkeletonPatchOperationSchema,
  campaignSkeletonPatchProposalSchema,
  canonicalJson,
} from "@/server/campaign/domain";
import { validateCampaignSkeletonPatch } from "@/server/campaign/core";

const activeSkeleton = {
  version: 1,
  mixedWindowDays: genericCampaignSkeleton.mixedWindowDays,
  nodePlans: genericCampaignSkeleton.nodePlans,
};

function proposal(operations: unknown[], extra: Record<string, unknown> = {}) {
  return {
    patchSchemaVersion: 1,
    baseVersion: 1,
    trigger: "user_route_adjustment",
    rationale: "Adjust the future route without changing learner state.",
    operations,
    ...extra,
  };
}

describe("Campaign Skeleton Patch contracts", () => {
  it.each([
    { type: "set_node_included", nodeId: "N1", included: false },
    { type: "move_node", nodeId: "N18", beforeNodeId: "N19" },
    { type: "move_node", nodeId: "N18", afterNodeId: "N17" },
    { type: "set_node_priority", nodeId: "N1", priority: 100 },
    { type: "set_target_week", nodeId: "N1", targetWeek: 12 },
    { type: "set_node_rationale", nodeId: "N1", rationale: "Focus this mechanism sooner." },
    { type: "set_mixed_window_days", mixedWindowDays: 14 },
  ])("accepts canonical operation $type", (operation) => {
    expect(campaignSkeletonPatchOperationSchema.parse(operation)).toEqual(operation);
  });

  it("rejects unknown, missing, extra, self-ambiguous, and forbidden operations", () => {
    expect(campaignSkeletonPatchOperationSchema.safeParse({ type: "set_mastery", nodeId: "N1" }).success).toBe(false);
    expect(campaignSkeletonPatchOperationSchema.safeParse({ type: "set_phase", phase: "coverage" }).success).toBe(false);
    expect(campaignSkeletonPatchOperationSchema.safeParse({ type: "edit_daily_task", taskId: "x" }).success).toBe(false);
    expect(campaignSkeletonPatchOperationSchema.safeParse({ type: "set_node_priority", nodeId: "N1" }).success).toBe(false);
    expect(campaignSkeletonPatchOperationSchema.safeParse({ type: "set_node_priority", nodeId: "N1", priority: 1, mastery: true }).success).toBe(false);
    expect(campaignSkeletonPatchOperationSchema.safeParse({ type: "move_node", nodeId: "N1", beforeNodeId: "N2", afterNodeId: "N4" }).success).toBe(false);
  });

  it("fixes range, rationale, schema-version, and budget constraints", () => {
    expect(campaignSkeletonPatchProposalSchema.safeParse(proposal([{ type: "set_node_priority", nodeId: "N1", priority: 101 }])).success).toBe(false);
    expect(campaignSkeletonPatchProposalSchema.safeParse(proposal([{ type: "set_target_week", nodeId: "N1", targetWeek: 0 }])).success).toBe(false);
    expect(campaignSkeletonPatchProposalSchema.safeParse(proposal([{ type: "set_mixed_window_days", mixedWindowDays: 0 }])).success).toBe(false);
    expect(campaignSkeletonPatchProposalSchema.safeParse(proposal([{ type: "set_node_rationale", nodeId: "N1", rationale: "x".repeat(501) }])).success).toBe(false);
    expect(campaignSkeletonPatchProposalSchema.safeParse({ ...proposal([{ type: "set_node_priority", nodeId: "N1", priority: 1 }]), patchSchemaVersion: 3 }).success).toBe(false);
    expect(campaignSkeletonPatchProposalSchema.safeParse(proposal([{ type: "set_node_priority", nodeId: "N1", priority: 1 }], { dailyBudgetSuggestion: { proposedBudget: 2, rationale: "Too low" } })).success).toBe(false);
  });

  it("uses stable canonical serialization", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
  });
});

describe("validateCampaignSkeletonPatch", () => {
  it("keeps legacy targetWeek and defaults missing goalDepth to mastery", () => {
    const result = validateCampaignSkeletonPatch({
      activeSkeleton,
      curriculum: campaignCurriculumAssets,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: proposal([{ type: "set_target_week", nodeId: "N20", targetWeek: 8 }]),
    });
    expect(result.valid).toBe(true);
    expect(result.resultingSkeletonPreview?.nodePlans.find((plan) => plan.nodeId === "N20"))
      .toMatchObject({ targetWeek: 8 });
    expect(result.resultingSkeletonPreview?.nodePlans.find((plan) => plan.nodeId === "N1")?.goalDepth ?? "mastery")
      .toBe("mastery");
  });

  it("applies v2 goalDepth and targetByDate operations", () => {
    const result = validateCampaignSkeletonPatch({
      activeSkeleton,
      curriculum: campaignCurriculumAssets,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: {
        ...proposal([
          { type: "set_goal_depth", nodeId: "N20", goalDepth: "exposure" },
          { type: "set_target_by_date", nodeId: "N20", targetByDate: "2026-09-01" },
        ]),
        patchSchemaVersion: 2,
      },
    });
    expect(result.valid).toBe(true);
    expect(result.resultingSkeletonPreview?.nodePlans.find((plan) => plan.nodeId === "N20"))
      .toMatchObject({ goalDepth: "exposure", targetByDate: "2026-09-01" });
  });

  it("materializes a valid stable reorder with contiguous order", () => {
    const input = {
      activeSkeleton,
      curriculum: campaignCurriculumAssets,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: proposal([{ type: "move_node", nodeId: "N18", beforeNodeId: "N19" }]),
    };
    const first = validateCampaignSkeletonPatch(input);
    const second = validateCampaignSkeletonPatch(input);
    expect(first.valid).toBe(true);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.normalizedOperations[0].operationId).toBe("op-001");
    expect(first.resultingSkeletonPreview?.nodePlans.map((plan) => plan.order)).toEqual(
      Array.from({ length: 17 }, (_, index) => index + 1),
    );
    expect(first.resultingSkeletonPreview?.nodePlans.find((plan) => plan.nodeId === "N18")?.order)
      .toBeLessThan(first.resultingSkeletonPreview!.nodePlans.find((plan) => plan.nodeId === "N19")!.order);
  });

  it("rejects required-order and included-dependency violations", () => {
    const order = validateCampaignSkeletonPatch({
      activeSkeleton,
      curriculum: campaignCurriculumAssets,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: proposal([{ type: "move_node", nodeId: "N19", afterNodeId: "N20" }]),
    });
    expect(order.valid).toBe(false);
    expect(order.errors.map((error) => error.code)).toContain("required_order_violation");

    const included = validateCampaignSkeletonPatch({
      activeSkeleton,
      curriculum: campaignCurriculumAssets,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: proposal([{ type: "set_node_included", nodeId: "N19", included: false }]),
    });
    expect(included.valid).toBe(false);
    expect(included.errors.map((error) => error.code)).toContain("required_prerequisite_excluded");
  });

  it("warns for recommended order and ignores related edges", () => {
    const result = validateCampaignSkeletonPatch({
      activeSkeleton,
      curriculum: {
        ...campaignCurriculumAssets,
        graph: {
          ...campaignCurriculumAssets.graph,
          edges: [...campaignCurriculumAssets.graph.edges, {
            fromNodeId: "N20",
            toNodeId: "N1",
            type: "related" as const,
            rationale: "test-only relation",
          }],
        },
      },
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: proposal([{ type: "move_node", nodeId: "N8", beforeNodeId: "N1" }]),
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("recommended_order_not_followed");
    expect(result.errors).toEqual([]);
  });

  it("rejects duplicate/conflicting operations, self moves, NT nodes, and stale versions", () => {
    const duplicate = validateCampaignSkeletonPatch({
      activeSkeleton,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: proposal([
        { type: "set_node_priority", nodeId: "N1", priority: 2 },
        { type: "set_node_priority", nodeId: "N1", priority: 3 },
      ]),
    });
    expect(duplicate.errors.map((error) => error.code)).toContain("duplicate_or_conflicting_operation");

    const selfMove = validateCampaignSkeletonPatch({
      activeSkeleton,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: proposal([{ type: "move_node", nodeId: "N1", beforeNodeId: "N1" }]),
    });
    expect(selfMove.errors.map((error) => error.code)).toContain("self_referential_move");

    const nt = validateCampaignSkeletonPatch({
      activeSkeleton,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: proposal([{ type: "set_node_included", nodeId: "N3", included: true }]),
    });
    expect(nt.valid).toBe(false);

    const stale = validateCampaignSkeletonPatch({
      activeSkeleton,
      campaignGoal: { dailyQuestionBudget: 3 },
      proposedPatch: { ...proposal([{ type: "set_node_priority", nodeId: "N1", priority: 4 }]), baseVersion: 2 },
    });
    expect(stale.errors.map((error) => error.code)).toContain("stale_base_version");
  });

  it("returns a stable pending-patch warning without changing Today", () => {
    const result = validateCampaignSkeletonPatch({
      activeSkeleton,
      campaignGoal: { dailyQuestionBudget: 3 },
      currentDailyTask: { taskId: "today", campaignDate: "2026-08-04" },
      existingPendingPatch: { patchId: "other", baseVersion: 1 },
      proposedPatch: proposal([{ type: "set_mixed_window_days", mixedWindowDays: 10 }]),
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("pending_patch_exists");
    expect(result.impactSummary.currentDailyTaskUnaffected).toBe(true);
  });
});
