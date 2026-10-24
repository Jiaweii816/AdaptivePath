import type { PlannerProposalDto } from "./planner.types";

type PlannerProposalProjection = Readonly<{
  id: string;
  type: string;
  patternTag: string;
  reason: string;
  proposedChangeJson: string;
  targetProblemSlug: string | null;
  targetProblemTitle: string | null;
  targetLeetcodeNumber: number | null;
  createdAt: Date;
}>;

function parseProposedChange(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function projectPlannerProposal(
  proposal: PlannerProposalProjection,
): PlannerProposalDto {
  return {
    id: proposal.id,
    type: proposal.type,
    patternTag: proposal.patternTag,
    reason: proposal.reason,
    proposedChange: parseProposedChange(proposal.proposedChangeJson),
    targetProblemSlug: proposal.targetProblemSlug,
    targetProblemTitle: proposal.targetProblemTitle,
    targetLeetcodeNumber: proposal.targetLeetcodeNumber,
    createdAt: proposal.createdAt.toISOString(),
  };
}
