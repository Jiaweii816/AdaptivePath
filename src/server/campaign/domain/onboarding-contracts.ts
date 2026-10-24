import { createHash } from "node:crypto";
import { z } from "zod";
import {
  campaignCurriculumAssets,
  genericCampaignSkeleton,
  type CampaignSkeleton,
  type CampaignSkeletonNodePlan,
} from "../curriculum";
import {
  campaignDateSchema,
  campaignNodeIdSchema,
  campaignTimeZoneSchema,
} from "./contracts";

const transferableNodes = campaignCurriculumAssets.graph.nodes.filter(
  (node) => node.kind === "transferable",
);
const transferableNodeIds = new Set(transferableNodes.map((node) => node.nodeId));
const defaultOrderByNodeId = new Map(
  genericCampaignSkeleton.nodePlans.map((plan) => [plan.nodeId, plan.order]),
);

const transferableNodeIdSchema = campaignNodeIdSchema.refine(
  (nodeId) => transferableNodeIds.has(nodeId),
  "Only transferable Learning Nodes can be selected",
);

function normalizedNodeIds(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    (defaultOrderByNodeId.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (defaultOrderByNodeId.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right));
}

export const createCampaignInputSchema = z.object({
  endDate: campaignDateSchema,
  dailyQuestionBudget: z.number().int().min(3),
  language: z.literal("Python"),
  timezone: campaignTimeZoneSchema,
  selfReportedWeakNodes: z.array(transferableNodeIdSchema).default([]).transform(normalizedNodeIds),
  preferredNodes: z.array(transferableNodeIdSchema).default([]).transform(normalizedNodeIds),
  idempotencyToken: z.string().uuid().optional(),
}).strict();

export type CreateCampaignInput = z.infer<typeof createCampaignInputSchema>;

export function validateCreateCampaignInput(
  value: unknown,
  campaignDate: string,
) {
  campaignDateSchema.parse(campaignDate);
  return createCampaignInputSchema.superRefine((input, context) => {
    if (input.endDate < campaignDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date cannot be earlier than today's Campaign date",
      });
    }
  }).safeParse(value);
}

function personalizationReason(
  nodeId: string,
  weak: ReadonlySet<string>,
  preferred: ReadonlySet<string>,
): string | null {
  if (weak.has(nodeId) && preferred.has(nodeId)) {
    return "Learner selected this as both a weak area and a preferred early focus.";
  }
  if (preferred.has(nodeId)) return "Learner selected this as a preferred early focus.";
  if (weak.has(nodeId)) return "Learner identified this as a weak area for earlier practice.";
  return null;
}

/**
 * Personalizes only route planning fields. It never fabricates exposure,
 * mastery, health, unlock, repair, or evidence state. A node selected in both
 * lists receives one bounded boost rather than two cumulative boosts.
 */
export function deriveInitialSkeletonFromGoal(input: {
  weakNodeIds: readonly string[];
  preferredNodeIds: readonly string[];
  baseSkeleton?: CampaignSkeleton;
}): { skeleton: CampaignSkeleton; fingerprint: string; changedNodeIds: readonly string[] } {
  const weak = new Set(input.weakNodeIds.map((nodeId) => transferableNodeIdSchema.parse(nodeId)));
  const preferred = new Set(input.preferredNodeIds.map((nodeId) => transferableNodeIdSchema.parse(nodeId)));
  const base = input.baseSkeleton ?? genericCampaignSkeleton;
  const selected = new Set([...weak, ...preferred]);
  const requiredBefore = new Map<string, Set<string>>();
  for (const edge of campaignCurriculumAssets.graph.edges) {
    if (edge.type !== "required") continue;
    const prerequisites = requiredBefore.get(edge.toNodeId) ?? new Set<string>();
    prerequisites.add(edge.fromNodeId);
    requiredBefore.set(edge.toNodeId, prerequisites);
  }

  const remaining = new Map(base.nodePlans.map((plan) => [plan.nodeId, plan]));
  const ordered: CampaignSkeletonNodePlan[] = [];
  const placed = new Set<string>();
  while (remaining.size > 0) {
    const candidates = [...remaining.values()]
      .filter((plan) => [...(requiredBefore.get(plan.nodeId) ?? [])].every((nodeId) => placed.has(nodeId)))
      .sort((left, right) =>
        Number(selected.has(right.nodeId)) - Number(selected.has(left.nodeId))
        || left.order - right.order
        || left.nodeId.localeCompare(right.nodeId));
    const next = candidates[0];
    if (!next) throw new Error("Initial CampaignSkeleton contains an invalid required dependency cycle.");
    ordered.push(next);
    placed.add(next.nodeId);
    remaining.delete(next.nodeId);
  }

  const nodePlans = ordered.map((plan, index) => {
    const reason = personalizationReason(plan.nodeId, weak, preferred);
    const boost = weak.has(plan.nodeId) && preferred.has(plan.nodeId)
      ? 30
      : preferred.has(plan.nodeId)
        ? 20
        : weak.has(plan.nodeId)
          ? 10
          : 0;
    return {
      ...plan,
      order: index + 1,
      priority: Math.min(100, plan.priority + boost),
      rationale: reason ? `${plan.rationale} ${reason}` : plan.rationale,
    };
  });
  const skeleton = { ...base, nodePlans };
  const canonical = JSON.stringify({
    curriculumId: skeleton.curriculumId,
    curriculumVersion: skeleton.curriculumVersion,
    mixedWindowDays: skeleton.mixedWindowDays,
    nodePlans: skeleton.nodePlans,
  });
  return {
    skeleton,
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
    changedNodeIds: nodePlans
      .filter((plan) => {
        const original = base.nodePlans.find((candidate) => candidate.nodeId === plan.nodeId);
        return original?.order !== plan.order || original.priority !== plan.priority || original.rationale !== plan.rationale;
      })
      .map((plan) => plan.nodeId),
  };
}
