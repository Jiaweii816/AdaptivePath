import { describe, expect, it } from "vitest";
import {
  assertValidCurriculumAssets,
  campaignCurriculumAssets,
  type CurriculumAssets,
  validateCurriculumAssets,
} from "@/server/campaign/curriculum";

function issueCodes(assets: CurriculumAssets) {
  return validateCurriculumAssets(assets).issues.map((issue) => issue.code);
}

describe("Campaign curriculum validator", () => {
  it("rejects duplicate Learning Node ids", () => {
    const assets = {
      ...campaignCurriculumAssets,
      graph: {
        ...campaignCurriculumAssets.graph,
        nodes: [
          ...campaignCurriculumAssets.graph.nodes,
          campaignCurriculumAssets.graph.nodes[0],
        ],
      },
    } satisfies CurriculumAssets;

    expect(issueCodes(assets)).toContain("duplicate_node_id");
  });

  it("rejects unknown catalog slugs", () => {
    const [firstNode, ...remainingNodes] = campaignCurriculumAssets.graph.nodes;
    const [firstProblem, ...remainingProblems] = firstNode.primaryProblems;
    const assets = {
      ...campaignCurriculumAssets,
      graph: {
        ...campaignCurriculumAssets.graph,
        nodes: [
          {
            ...firstNode,
            primaryProblems: [
              { ...firstProblem, problemSlug: "not-in-hot150" },
              ...remainingProblems,
            ],
          },
          ...remainingNodes,
        ],
      },
    } satisfies CurriculumAssets;

    expect(issueCodes(assets)).toContain("unknown_problem_slug");
  });

  it("rejects more than one primary Learning Node for a problem", () => {
    const [firstNode, secondNode, ...remainingNodes] =
      campaignCurriculumAssets.graph.nodes;
    const assets = {
      ...campaignCurriculumAssets,
      graph: {
        ...campaignCurriculumAssets.graph,
        nodes: [
          firstNode,
          {
            ...secondNode,
            primaryProblems: [
              ...secondNode.primaryProblems,
              {
                ...firstNode.primaryProblems[0],
                orderInNode: secondNode.primaryProblems.length + 1,
              },
            ],
          },
          ...remainingNodes,
        ],
      },
    } satisfies CurriculumAssets;

    expect(issueCodes(assets)).toContain("duplicate_primary_problem");
  });

  it("rejects nodes with fewer than four primary problems", () => {
    const [firstNode, ...remainingNodes] = campaignCurriculumAssets.graph.nodes;
    const assets = {
      ...campaignCurriculumAssets,
      graph: {
        ...campaignCurriculumAssets.graph,
        nodes: [
          { ...firstNode, primaryProblems: firstNode.primaryProblems.slice(0, 3) },
          ...remainingNodes,
        ],
      },
    } satisfies CurriculumAssets;

    expect(issueCodes(assets)).toContain("too_few_primary_problems");
  });

  it("rejects a cycle in the required prerequisite subgraph", () => {
    const assets = {
      ...campaignCurriculumAssets,
      graph: {
        ...campaignCurriculumAssets.graph,
        edges: [
          ...campaignCurriculumAssets.graph.edges,
          {
            fromNodeId: "N13",
            toNodeId: "N12",
            type: "required",
            rationale: "Test-only reverse prerequisite.",
          },
        ],
      },
    } satisfies CurriculumAssets;

    expect(issueCodes(assets)).toContain("required_cycle");
  });

  it("accepts nodes above the former eight-problem ceiling", () => {
    expect(
      campaignCurriculumAssets.graph.nodes
        .filter((node) => node.primaryProblems.length > 8)
        .map((node) => [node.nodeId, node.primaryProblems.length]),
    ).toEqual([
      ["N1", 9], ["N2", 10], ["N3", 9], ["N7", 12],
      ["N11", 11], ["N12", 13], ["N13", 9], ["N20", 9],
    ]);
    expect(validateCurriculumAssets(campaignCurriculumAssets).valid).toBe(true);
  });

  it("rejects skeleton references to unknown Learning Nodes", () => {
    const [firstPlan, ...remainingPlans] =
      campaignCurriculumAssets.skeleton.nodePlans;
    const assets = {
      ...campaignCurriculumAssets,
      skeleton: {
        ...campaignCurriculumAssets.skeleton,
        nodePlans: [
          { ...firstPlan, nodeId: "unknown-learning-node" },
          ...remainingPlans,
        ],
      },
    } satisfies CurriculumAssets;

    expect(issueCodes(assets)).toContain("unknown_skeleton_node");
  });

  it("rejects slot roles outside the Campaign role vocabulary", () => {
    const [firstNode, ...remainingNodes] = campaignCurriculumAssets.graph.nodes;
    const [firstProblem, ...remainingProblems] = firstNode.primaryProblems;
    const assets = {
      ...campaignCurriculumAssets,
      graph: {
        ...campaignCurriculumAssets.graph,
        nodes: [
          {
            ...firstNode,
            primaryProblems: [
              { ...firstProblem, slotRoles: ["advance", "boss"] },
              ...remainingProblems,
            ],
          },
          ...remainingNodes,
        ],
      },
    } as unknown as CurriculumAssets;

    expect(issueCodes(assets)).toContain("invalid_slot_role");
    expect(() => assertValidCurriculumAssets(assets)).toThrow(
      /invalid_slot_role/,
    );
  });
});
