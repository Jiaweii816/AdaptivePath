import { describe, expect, it } from "vitest";
import { hot150Problems } from "@/data/hot150";
import { localHot150Bank } from "@/data/hot150/local-bank.generated";
import {
  CURRICULUM_SLOT_ROLES,
  campaignCurriculumAssets,
  campaignLearningNodes,
  genericCampaignSkeleton,
  validateCurriculumAssets,
} from "@/server/campaign/curriculum";

const EXPECTED_COUNTS: Record<string, number> = {
  N1: 9, N2: 10, N3: 9, N4: 5, N5: 6, N6: 6, N7: 12,
  N8: 6, N9: 4, N10: 7, N11: 11, N12: 13, N13: 9,
  N14: 5, N15: 5, N16: 6, N17: 6, N18: 5, N19: 7, N20: 9,
};

describe("Campaign curriculum assets v2", () => {
  it("passes the deterministic repository validator", () => {
    expect(validateCurriculumAssets(campaignCurriculumAssets)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("implements the exact 20-node, 17 T / 3 NT graph and node counts", () => {
    expect(campaignLearningNodes.map((node) => node.nodeId)).toEqual(
      Array.from({ length: 20 }, (_, index) => `N${index + 1}`),
    );
    const transferable = campaignLearningNodes.filter(
      (node) => node.kind === "transferable",
    );
    const nonTransferable = campaignLearningNodes.filter(
      (node) => node.kind === "non_transferable",
    );
    expect(transferable).toHaveLength(17);
    expect(nonTransferable.map((node) => node.nodeId)).toEqual(["N3", "N5", "N6"]);
    expect(transferable.flatMap((node) => node.primaryProblems)).toHaveLength(129);
    expect(nonTransferable.flatMap((node) => node.primaryProblems)).toHaveLength(21);
    for (const node of campaignLearningNodes) {
      expect(node.primaryProblems).toHaveLength(EXPECTED_COUNTS[node.nodeId]);
      expect(node.primaryProblems.length).toBeGreaterThanOrEqual(4);
      expect(node.primaryProblems.map((problem) => problem.orderInNode)).toEqual(
        node.primaryProblems.map((_, index) => index + 1),
      );
    }
  });

  it("covers all 150 catalog and runnable-bank slugs exactly once", () => {
    const primarySlugs = campaignLearningNodes.flatMap((node) =>
      node.primaryProblems.map((problem) => problem.problemSlug),
    );
    expect(primarySlugs).toHaveLength(150);
    expect(new Set(primarySlugs).size).toBe(150);
    expect([...primarySlugs].sort()).toEqual(
      hot150Problems.map((problem) => problem.slug).sort(),
    );
    expect([...primarySlugs].sort()).toEqual(
      localHot150Bank.problems.map((problem) => problem.slug).sort(),
    );
  });

  it("keeps mixed out of per-problem eligibility", () => {
    const used = new Set<string>();
    for (const node of campaignLearningNodes) {
      for (const problem of node.primaryProblems) {
        expect(problem.slotRoles.length).toBeGreaterThan(0);
        expect(problem.slotRoles).not.toContain("mixed");
        for (const role of problem.slotRoles) {
          expect(CURRICULUM_SLOT_ROLES).toContain(role);
          used.add(role);
        }
      }
    }
    expect([...used].sort()).toEqual([...CURRICULUM_SLOT_ROLES].sort());
  });

  it("has exactly three required hard gates and only soft recommended remainder", () => {
    const required = campaignCurriculumAssets.graph.edges
      .filter((edge) => edge.type === "required")
      .map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`);
    expect(required).toEqual(["N12->N13", "N15->N17", "N19->N20"]);
    expect(
      campaignCurriculumAssets.graph.edges.filter((edge) => edge.type === "related"),
    ).toEqual([]);
    expect(
      validateCurriculumAssets(campaignCurriculumAssets).issues.filter(
        (issue) => issue.code === "required_cycle",
      ),
    ).toEqual([]);
  });

  it("provides a 17-node transferable-only default skeleton", () => {
    const plans = genericCampaignSkeleton.nodePlans;
    expect(plans).toHaveLength(17);
    expect(genericCampaignSkeleton.mixedWindowDays).toBe(7);
    expect(plans.map((plan) => plan.order)).toEqual(
      plans.map((_, index) => index + 1),
    );
    expect(plans.map((plan) => plan.nodeId)).not.toEqual(
      expect.arrayContaining(["N3", "N5", "N6"]),
    );
    expect(
      plans.every(
        (plan) =>
          campaignLearningNodes.find((node) => node.nodeId === plan.nodeId)?.kind ===
          "transferable",
      ),
    ).toBe(true);
    expect(JSON.stringify(genericCampaignSkeleton)).not.toMatch(
      /phase|mastered|mastery|health|attempted|exposureState/,
    );
  });
});
