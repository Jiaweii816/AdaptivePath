export const CAMPAIGN_SLOT_ROLES = [
  "advance",
  "target",
  "remedial",
  "probe",
  "mixed",
] as const;

export type CampaignSlotRole = (typeof CAMPAIGN_SLOT_ROLES)[number];

export const CURRICULUM_SLOT_ROLES = [
  "advance",
  "target",
  "remedial",
  "probe",
] as const;

export type CurriculumSlotRole = (typeof CURRICULUM_SLOT_ROLES)[number];

export const LEARNING_NODE_KINDS = [
  "transferable",
  "non_transferable",
] as const;

export type LearningNodeKind = (typeof LEARNING_NODE_KINDS)[number];

export const CURRICULUM_EDGE_TYPES = [
  "required",
  "recommended",
  "related",
] as const;

export type CurriculumEdgeType = (typeof CURRICULUM_EDGE_TYPES)[number];

export type LearningNodeProblem = Readonly<{
  problemSlug: string;
  orderInNode: number;
  slotRoles: readonly CurriculumSlotRole[];
}>;

export type LearningNode = Readonly<{
  nodeId: string;
  label: Readonly<{
    en: string;
    zh: string;
  }>;
  description: string;
  difficulty: 1 | 2 | 3 | 4;
  kind: LearningNodeKind;
  primaryProblems: readonly LearningNodeProblem[];
}>;

/**
 * Edges point from a prerequisite or reference node to the node it informs.
 * Only `required` edges block unlocks; `related` records a non-directional
 * teaching association even though it is stored once in this directed shape.
 */
export type CurriculumEdge = Readonly<{
  fromNodeId: string;
  toNodeId: string;
  type: CurriculumEdgeType;
  rationale: string;
}>;

export type CurriculumGraph = Readonly<{
  curriculumId: string;
  version: number;
  nodes: readonly LearningNode[];
  edges: readonly CurriculumEdge[];
}>;

export type CampaignSkeletonNodePlan = Readonly<{
  nodeId: string;
  included: boolean;
  order: number;
  targetWeek: number;
  /** Planning intent only; absent legacy values normalize to mastery. */
  goalDepth?: "mastery" | "exposure";
  targetByDate?: string | null;
  priority: number;
  rationale: string;
}>;

/**
 * A learner-neutral route template. It intentionally contains no exposure,
 * mastery, health, attempt, or evidence state.
 */
export type CampaignSkeleton = Readonly<{
  skeletonId: string;
  curriculumId: string;
  curriculumVersion: number;
  version: number;
  mixedWindowDays: number;
  nodePlans: readonly CampaignSkeletonNodePlan[];
}>;

export type CurriculumAssets = Readonly<{
  graph: CurriculumGraph;
  skeleton: CampaignSkeleton;
}>;
