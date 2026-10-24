import { describe, expect, it } from "vitest";
import { genericCampaignSkeleton } from "@/server/campaign/curriculum";
import {
  validateStrategistProposalPolicy,
  type StrategistProposalPolicyContext,
} from "@/server/campaign/core";

const activeSkeleton = {
  version: 1,
  mixedWindowDays: genericCampaignSkeleton.mixedWindowDays,
  nodePlans: genericCampaignSkeleton.nodePlans,
};

function proposal(operations: unknown[], extra: Record<string, unknown> = {}) {
  return {
    patchSchemaVersion: 2,
    baseVersion: 1,
    trigger: "strategist_policy_fixture",
    rationale: "Exercise deterministic planning policy contracts.",
    operations,
    ...extra,
  };
}

function context(overrides: Partial<StrategistProposalPolicyContext> = {}): StrategistProposalPolicyContext {
  return {
    schemaVersion: 1,
    activeSkeletonVersion: 1,
    planningHorizon: { startDate: "2026-08-05", endDate: "2026-09-30" },
    goalSources: [
      { nodeId: "N20", source: "user" },
      { nodeId: "N18", source: "system" },
    ],
    currentDailyTask: { taskId: "today", campaignDate: "2026-08-05" },
    evaluatedAt: "2026-08-05T12:00:00.000Z",
    recentlyAcceptedChanges: [],
    newFacts: [],
    ...overrides,
  };
}

function validate(patch: unknown, policy = context(), skeleton = activeSkeleton) {
  return validateStrategistProposalPolicy({
    skeleton: {
      activeSkeleton: skeleton,
      proposedPatch: patch,
      campaignGoal: { dailyQuestionBudget: 3 },
      currentDailyTask: policy.currentDailyTask,
    },
    context: policy,
  });
}

describe("StrategistProposalPolicyValidator", () => {
  it("forbids deleting a user goal but allows a system goal deletion", () => {
    expect(validate(proposal([{ type: "set_node_included", nodeId: "N20", included: false }])).errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "user_goal_removal_forbidden" })]));
    expect(validate(proposal([{ type: "set_node_included", nodeId: "N18", included: false }])).valid).toBe(true);
  });

  it("supports mastery to exposure without changing mastery truth", () => {
    const result = validate(proposal([{ type: "set_goal_depth", nodeId: "N20", goalDepth: "exposure" }]));
    expect(result.valid).toBe(true);
    expect(result.resultingSkeletonPreview?.nodePlans.find((plan) => plan.nodeId === "N20"))
      .toMatchObject({ goalDepth: "exposure" });
  });

  it("checks date budgets and target dates against the explicit horizon", () => {
    const tooSmall = validate(proposal(
      [{ type: "set_node_priority", nodeId: "N20", priority: 91 }],
      { dateBudgetSuggestions: [{ campaignDate: "2026-08-06", maxQuestions: 2, rationale: "Too small." }] },
    ));
    expect(tooSmall.valid).toBe(false);
    expect(tooSmall.errors.some((issue) => issue.code === "invalid_patch_schema")).toBe(true);

    const outside = validate(proposal([
      { type: "set_target_by_date", nodeId: "N20", targetByDate: "2026-10-01" },
    ]));
    expect(outside.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "target_date_outside_horizon" }),
    ]));
  });

  it("rejects stale policy context and malformed external freshness", () => {
    const result = validate(
      proposal([{ type: "set_node_priority", nodeId: "N20", priority: 91 }]),
      context({
        activeSkeletonVersion: 2,
        externalFreshness: {
          observedAt: "2026-08-04T12:00:00.000Z",
          expiresAt: "2026-08-05T11:59:59.000Z",
        },
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "stale_policy_context",
      "invalid_external_freshness",
    ]));
  });

  it("revalidates partial acceptance through M4A", () => {
    const full = proposal([
      { type: "set_node_included", nodeId: "N20", included: false },
      { type: "move_node", nodeId: "N19", afterNodeId: "N20" },
    ]);
    expect(validate(full, context({ goalSources: [] })).valid).toBe(true);
    const partial = proposal([{ type: "move_node", nodeId: "N19", afterNodeId: "N20" }]);
    expect(validate(partial, context({ goalSources: [] })).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "required_order_violation" }),
    ]));
  });

  it("rejects exact reverse churn unless a newer planning fact exists", () => {
    const changedSkeleton = {
      ...activeSkeleton,
      nodePlans: activeSkeleton.nodePlans.map((plan) =>
        plan.nodeId === "N20" ? { ...plan, priority: 91 } : plan,
      ),
    };
    const accepted = {
      operationType: "set_node_priority" as const,
      nodeId: "N20",
      beforeValue: activeSkeleton.nodePlans.find((plan) => plan.nodeId === "N20")!.priority,
      afterValue: 91,
      acceptedAt: "2026-08-04T12:00:00.000Z",
    };
    const reverse = proposal([{
      type: "set_node_priority",
      nodeId: "N20",
      priority: accepted.beforeValue,
    }]);
    expect(validate(reverse, context({ recentlyAcceptedChanges: [accepted] }), changedSkeleton).errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "exact_reverse_patch_churn" })]));
    expect(validate(reverse, context({
      recentlyAcceptedChanges: [accepted],
      newFacts: [{ type: "repair_trigger", nodeId: "N20", observedAt: "2026-08-05T01:00:00.000Z" }],
    }), changedSkeleton).valid).toBe(true);
  });
});
