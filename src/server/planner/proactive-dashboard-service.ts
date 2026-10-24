import type { PrismaClient } from "@prisma/client";
import type { PlannerProposalDto } from "./planner.types";
import { projectPlannerProposal } from "./planner-proposal-presenter";
import { buildReviewFocusBoard } from "./review-focus/build-review-focus-board";
import type { ReviewFocusBoard } from "./review-focus/review-focus.types";

async function activeReadinessGoalId(db: PrismaClient, userId: string) {
  const goal = await db.readinessGoal.findFirst({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return goal?.id ?? null;
}

export async function loadPendingPlannerProposals(input: {
  db: PrismaClient;
  userId: string;
}): Promise<PlannerProposalDto[]> {
  const goalId = await activeReadinessGoalId(input.db, input.userId);
  if (!goalId) return [];

  const proposals = await input.db.plannerProposal.findMany({
    where: { userId: input.userId, goalId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  return proposals.map(projectPlannerProposal);
}

export async function loadPlannerReviewFocus(input: {
  db: PrismaClient;
  userId: string;
  now: Date;
}): Promise<ReviewFocusBoard> {
  const goalId = await activeReadinessGoalId(input.db, input.userId);
  return buildReviewFocusBoard(input.db, {
    userId: input.userId,
    goalId,
    now: input.now,
  });
}
