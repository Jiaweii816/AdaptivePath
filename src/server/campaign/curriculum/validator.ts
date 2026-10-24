import { hot150Problems } from "@/data/hot150";
import {
  CURRICULUM_EDGE_TYPES,
  CURRICULUM_SLOT_ROLES,
  LEARNING_NODE_KINDS,
  type CurriculumAssets,
} from "./types";

export const CURRICULUM_VALIDATION_ISSUE_CODES = [
  "duplicate_node_id",
  "unknown_problem_slug",
  "duplicate_primary_problem",
  "missing_primary_problem",
  "too_few_primary_problems",
  "invalid_node_kind",
  "invalid_slot_role",
  "missing_slot_role",
  "invalid_edge_type",
  "unknown_edge_node",
  "required_cycle",
  "skeleton_curriculum_mismatch",
  "unknown_skeleton_node",
  "duplicate_skeleton_node",
  "invalid_skeleton_order",
  "duplicate_skeleton_order",
  "required_order_violation",
  "invalid_mixed_window_days",
  "non_transferable_skeleton_node",
  "missing_transferable_skeleton_node",
] as const;

export type CurriculumValidationIssueCode =
  (typeof CURRICULUM_VALIDATION_ISSUE_CODES)[number];

export type CurriculumValidationIssue = Readonly<{
  code: CurriculumValidationIssueCode;
  path: string;
  message: string;
}>;

export type CurriculumValidationResult = Readonly<{
  valid: boolean;
  issues: readonly CurriculumValidationIssue[];
}>;

export type CurriculumValidationOptions = Readonly<{
  knownProblemSlugs?: readonly string[];
  minimumPrimaryProblemsPerNode?: number;
  requireCompleteProblemCoverage?: boolean;
}>;

const DEFAULT_KNOWN_PROBLEM_SLUGS = hot150Problems.map(
  (problem) => problem.slug,
);

/**
 * Validates repository-owned Campaign curriculum truth without reading a
 * database or invoking a provider. Runtime types are deliberately rechecked
 * so generated or hand-edited JSON cannot bypass TypeScript-only guarantees.
 */
export function validateCurriculumAssets(
  assets: CurriculumAssets,
  options: CurriculumValidationOptions = {},
): CurriculumValidationResult {
  const issues: CurriculumValidationIssue[] = [];
  const knownProblemSlugs = new Set(
    options.knownProblemSlugs ?? DEFAULT_KNOWN_PROBLEM_SLUGS,
  );
  const minimumPrimaryProblemsPerNode =
    options.minimumPrimaryProblemsPerNode ?? 4;
  const requireCompleteProblemCoverage =
    options.requireCompleteProblemCoverage ?? true;
  const nodeIds = new Set<string>();
  const primaryOwnerBySlug = new Map<string, string>();

  for (const [nodeIndex, node] of assets.graph.nodes.entries()) {
    const nodePath = `graph.nodes[${nodeIndex}]`;
    if (nodeIds.has(node.nodeId)) {
      issues.push({
        code: "duplicate_node_id",
        path: `${nodePath}.nodeId`,
        message: `Learning Node id '${node.nodeId}' is declared more than once.`,
      });
    }
    nodeIds.add(node.nodeId);

    if (!(LEARNING_NODE_KINDS as readonly string[]).includes(node.kind)) {
      issues.push({
        code: "invalid_node_kind",
        path: `${nodePath}.kind`,
        message: `Learning Node '${node.nodeId}' has unsupported kind '${node.kind}'.`,
      });
    }

    if (node.primaryProblems.length < minimumPrimaryProblemsPerNode) {
      issues.push({
        code: "too_few_primary_problems",
        path: `${nodePath}.primaryProblems`,
        message: `Learning Node '${node.nodeId}' has ${node.primaryProblems.length} primary problems; minimum is ${minimumPrimaryProblemsPerNode}.`,
      });
    }

    for (const [problemIndex, problem] of node.primaryProblems.entries()) {
      const problemPath = `${nodePath}.primaryProblems[${problemIndex}]`;
      if (!knownProblemSlugs.has(problem.problemSlug)) {
        issues.push({
          code: "unknown_problem_slug",
          path: `${problemPath}.problemSlug`,
          message: `Problem slug '${problem.problemSlug}' is not in the configured catalog.`,
        });
      }

      const priorOwner = primaryOwnerBySlug.get(problem.problemSlug);
      if (priorOwner) {
        issues.push({
          code: "duplicate_primary_problem",
          path: `${problemPath}.problemSlug`,
          message: `Problem '${problem.problemSlug}' is primary in both '${priorOwner}' and '${node.nodeId}'.`,
        });
      } else {
        primaryOwnerBySlug.set(problem.problemSlug, node.nodeId);
      }

      if (problem.slotRoles.length === 0) {
        issues.push({
          code: "missing_slot_role",
          path: `${problemPath}.slotRoles`,
          message: `Problem '${problem.problemSlug}' must declare at least one Campaign slot role.`,
        });
      }

      for (const [roleIndex, role] of problem.slotRoles.entries()) {
        if (!(CURRICULUM_SLOT_ROLES as readonly string[]).includes(role)) {
          issues.push({
            code: "invalid_slot_role",
            path: `${problemPath}.slotRoles[${roleIndex}]`,
            message: `Slot role '${role}' is not a supported Campaign slot role.`,
          });
        }
      }
    }
  }

  if (requireCompleteProblemCoverage) {
    for (const slug of knownProblemSlugs) {
      if (!primaryOwnerBySlug.has(slug)) {
        issues.push({
          code: "missing_primary_problem",
          path: "graph.nodes",
          message: `Problem '${slug}' has no primary Learning Node.`,
        });
      }
    }
  }

  const requiredEdges: Array<{
    fromNodeId: string;
    toNodeId: string;
  }> = [];
  for (const [edgeIndex, edge] of assets.graph.edges.entries()) {
    const edgePath = `graph.edges[${edgeIndex}]`;
    if (!(CURRICULUM_EDGE_TYPES as readonly string[]).includes(edge.type)) {
      issues.push({
        code: "invalid_edge_type",
        path: `${edgePath}.type`,
        message: `Edge type '${edge.type}' is not supported.`,
      });
    }
    if (!nodeIds.has(edge.fromNodeId)) {
      issues.push({
        code: "unknown_edge_node",
        path: `${edgePath}.fromNodeId`,
        message: `Edge source '${edge.fromNodeId}' does not reference a Learning Node.`,
      });
    }
    if (!nodeIds.has(edge.toNodeId)) {
      issues.push({
        code: "unknown_edge_node",
        path: `${edgePath}.toNodeId`,
        message: `Edge target '${edge.toNodeId}' does not reference a Learning Node.`,
      });
    }
    if (
      edge.type === "required" &&
      nodeIds.has(edge.fromNodeId) &&
      nodeIds.has(edge.toNodeId)
    ) {
      requiredEdges.push({
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
      });
    }
  }

  const requiredCycle = findRequiredCycle(nodeIds, requiredEdges);
  if (requiredCycle) {
    issues.push({
      code: "required_cycle",
      path: "graph.edges",
      message: `Required prerequisite cycle detected: ${requiredCycle.join(" -> ")}.`,
    });
  }

  if (
    assets.skeleton.curriculumId !== assets.graph.curriculumId ||
    assets.skeleton.curriculumVersion !== assets.graph.version
  ) {
    issues.push({
      code: "skeleton_curriculum_mismatch",
      path: "skeleton",
      message: "CampaignSkeleton does not target this Curriculum Graph version.",
    });
  }

  if (
    !Number.isInteger(assets.skeleton.mixedWindowDays) ||
    assets.skeleton.mixedWindowDays < 1
  ) {
    issues.push({
      code: "invalid_mixed_window_days",
      path: "skeleton.mixedWindowDays",
      message: "CampaignSkeleton mixedWindowDays must be a positive integer.",
    });
  }

  const skeletonNodeIds = new Set<string>();
  const skeletonOrderOwners = new Map<number, string>();
  const includedOrderByNodeId = new Map<string, number>();
  for (const [planIndex, plan] of assets.skeleton.nodePlans.entries()) {
    const planPath = `skeleton.nodePlans[${planIndex}]`;
    if (!nodeIds.has(plan.nodeId)) {
      issues.push({
        code: "unknown_skeleton_node",
        path: `${planPath}.nodeId`,
        message: `CampaignSkeleton references unknown Learning Node '${plan.nodeId}'.`,
      });
    }
    const plannedNode = assets.graph.nodes.find((node) => node.nodeId === plan.nodeId);
    if (plannedNode?.kind === "non_transferable") {
      issues.push({
        code: "non_transferable_skeleton_node",
        path: `${planPath}.nodeId`,
        message: `Non-transferable Learning Node '${plan.nodeId}' cannot enter the default CampaignSkeleton.`,
      });
    }
    if (skeletonNodeIds.has(plan.nodeId)) {
      issues.push({
        code: "duplicate_skeleton_node",
        path: `${planPath}.nodeId`,
        message: `CampaignSkeleton declares Learning Node '${plan.nodeId}' more than once.`,
      });
    }
    skeletonNodeIds.add(plan.nodeId);

    if (!Number.isInteger(plan.order) || plan.order < 1) {
      issues.push({
        code: "invalid_skeleton_order",
        path: `${planPath}.order`,
        message: `CampaignSkeleton order for '${plan.nodeId}' must be a positive integer.`,
      });
    }
    const priorOrderOwner = skeletonOrderOwners.get(plan.order);
    if (priorOrderOwner) {
      issues.push({
        code: "duplicate_skeleton_order",
        path: `${planPath}.order`,
        message: `CampaignSkeleton order ${plan.order} is shared by '${priorOrderOwner}' and '${plan.nodeId}'.`,
      });
    } else {
      skeletonOrderOwners.set(plan.order, plan.nodeId);
    }
    if (plan.included) includedOrderByNodeId.set(plan.nodeId, plan.order);
  }

  for (const node of assets.graph.nodes) {
    if (node.kind === "transferable" && !skeletonNodeIds.has(node.nodeId)) {
      issues.push({
        code: "missing_transferable_skeleton_node",
        path: "skeleton.nodePlans",
        message: `Transferable Learning Node '${node.nodeId}' is missing from CampaignSkeleton.`,
      });
    }
  }

  for (const edge of requiredEdges) {
    const fromOrder = includedOrderByNodeId.get(edge.fromNodeId);
    const toOrder = includedOrderByNodeId.get(edge.toNodeId);
    if (fromOrder !== undefined && toOrder !== undefined && fromOrder >= toOrder) {
      issues.push({
        code: "required_order_violation",
        path: "skeleton.nodePlans",
        message: `Required prerequisite '${edge.fromNodeId}' must precede '${edge.toNodeId}' in CampaignSkeleton.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function assertValidCurriculumAssets(
  assets: CurriculumAssets,
  options: CurriculumValidationOptions = {},
): void {
  const result = validateCurriculumAssets(assets, options);
  if (result.valid) return;

  throw new Error(
    `Invalid Campaign curriculum assets:\n${result.issues
      .map((issue) => `- [${issue.code}] ${issue.path}: ${issue.message}`)
      .join("\n")}`,
  );
}

function findRequiredCycle(
  nodeIds: ReadonlySet<string>,
  edges: readonly { fromNodeId: string; toNodeId: string }[],
): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) adjacency.set(nodeId, []);
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
  }

  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];

  function visit(nodeId: string): string[] | null {
    state.set(nodeId, "visiting");
    stack.push(nodeId);

    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      if (state.get(nextNodeId) === "visiting") {
        const cycleStart = stack.lastIndexOf(nextNodeId);
        return [...stack.slice(cycleStart), nextNodeId];
      }
      if (state.get(nextNodeId) !== "visited") {
        const cycle = visit(nextNodeId);
        if (cycle) return cycle;
      }
    }

    stack.pop();
    state.set(nodeId, "visited");
    return null;
  }

  for (const nodeId of nodeIds) {
    if (!state.has(nodeId)) {
      const cycle = visit(nodeId);
      if (cycle) return cycle;
    }
  }

  return null;
}
