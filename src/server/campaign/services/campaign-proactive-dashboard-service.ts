import type { PrismaClient } from "@prisma/client";
import type { PlannerProposalDto } from "@/server/planner/planner.types";
import {
  loadPendingPlannerProposals,
  loadPlannerReviewFocus,
} from "@/server/planner/proactive-dashboard-service";
import type { ReviewFocusBoard } from "@/server/planner/review-focus/review-focus.types";
import { campaignCurriculumAssets } from "../curriculum";
import type {
  CampaignProactiveDashboardView,
  CampaignRecoveryOverflowView,
} from "../presentation";
import { buildCampaignProblemAvailability } from "./campaign-core-service";

const EXPOSURE_RANK = { never_seen: 0, externally_seen: 1, internally_attempted: 2 } as const;

function scheduledRepairIds(value: string) {
  try {
    const parsed = JSON.parse(value) as { scheduledRepairQueueItemIds?: unknown };
    return new Set(Array.isArray(parsed.scheduledRepairQueueItemIds)
      ? parsed.scheduledRepairQueueItemIds.filter((entry): entry is string => typeof entry === "string")
      : []);
  } catch {
    return new Set<string>();
  }
}

export async function loadCampaignRecoveryOverflow(input: {
  db: PrismaClient;
  campaignId: string;
  userId: string;
  campaignDate: string;
}): Promise<CampaignRecoveryOverflowView[]> {
  const [repairs, activeTask, availability] = await Promise.all([
    input.db.campaignRepairQueueItem.findMany({
      where: { campaignId: input.campaignId, status: { in: ["pending", "scheduled"] } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    input.db.campaignDailyTask.findUnique({
      where: { campaignId_campaignDate: { campaignId: input.campaignId, campaignDate: input.campaignDate } },
      select: { selectionMetadataJson: true, items: { select: { problemSlug: true } } },
    }),
    buildCampaignProblemAvailability(input.db, input.userId, new Map()),
  ]);
  const assignedRepairIds = activeTask
    ? scheduledRepairIds(activeTask.selectionMetadataJson)
    : new Set<string>();
  const usedSlugs = new Set(activeTask?.items.map((item) => item.problemSlug) ?? []);
  const seenNodes = new Set<string>();
  const selected: Array<{
    repair: (typeof repairs)[number];
    problemSlug: string | null;
  }> = [];
  for (const repair of repairs) {
    if (assignedRepairIds.has(repair.id) || seenNodes.has(repair.nodeId)) continue;
    seenNodes.add(repair.nodeId);
    const candidate = availability
      .filter((problem) =>
        problem.nodeId === repair.nodeId &&
        problem.eligibleRoles.includes("remedial") &&
        !usedSlugs.has(problem.problemSlug) &&
        (!problem.cooldownUntil || input.campaignDate >= problem.cooldownUntil),
      )
      .sort((left, right) =>
        EXPOSURE_RANK[left.exposureType] - EXPOSURE_RANK[right.exposureType] ||
        left.recommendedOrder - right.recommendedOrder ||
        left.problemSlug.localeCompare(right.problemSlug),
      )[0];
    if (candidate) usedSlugs.add(candidate.problemSlug);
    selected.push({ repair, problemSlug: candidate?.problemSlug ?? null });
  }
  const problemRows = selected.some((entry) => entry.problemSlug)
    ? await input.db.problem.findMany({
        where: { slug: { in: selected.flatMap((entry) => entry.problemSlug ? [entry.problemSlug] : []) } },
        select: { slug: true, title: true, leetcodeNumber: true },
      })
    : [];
  const problemBySlug = new Map(problemRows.map((problem) => [problem.slug, problem]));
  const nodeById = new Map(campaignCurriculumAssets.graph.nodes.map((node) => [node.nodeId, node]));
  return selected.map(({ repair, problemSlug }) => {
    const problem = problemSlug ? problemBySlug.get(problemSlug) : null;
    return {
      id: `repair:${repair.id}`,
      repairQueueItemId: repair.id,
      nodeId: repair.nodeId,
      nodeName: nodeById.get(repair.nodeId)?.label.en ?? repair.nodeId,
      reason: "This recovery need did not fit today's single required Recover slot.",
      targetProblemSlug: problemSlug,
      targetProblemTitle: problem?.title ?? null,
      targetLeetcodeNumber: problem?.leetcodeNumber ?? null,
    };
  });
}

export type CampaignProactiveDashboardLoaders = Readonly<{
  loadReplanProposals: (input: {
    db: PrismaClient;
    userId: string;
  }) => Promise<PlannerProposalDto[]>;
  loadReviewFocus: (input: {
    db: PrismaClient;
    userId: string;
    now: Date;
  }) => Promise<ReviewFocusBoard>;
  loadRecoveryOverflow?: typeof loadCampaignRecoveryOverflow;
}>;

const defaultLoaders: CampaignProactiveDashboardLoaders = {
  loadReplanProposals: loadPendingPlannerProposals,
  loadReviewFocus: loadPlannerReviewFocus,
  loadRecoveryOverflow: loadCampaignRecoveryOverflow,
};

export async function loadCampaignProactiveDashboard(input: {
  db: PrismaClient;
  userId: string;
  now: Date;
  campaignId?: string;
  campaignDate?: string;
  loaders?: CampaignProactiveDashboardLoaders;
}): Promise<CampaignProactiveDashboardView> {
  const loaders = input.loaders ?? defaultLoaders;
  const [replan, reviewFocus, overflowRepairs] = await Promise.allSettled([
    loaders.loadReplanProposals({ db: input.db, userId: input.userId }),
    loaders.loadReviewFocus({ db: input.db, userId: input.userId, now: input.now }),
    input.campaignId && input.campaignDate && loaders.loadRecoveryOverflow
      ? loaders.loadRecoveryOverflow({
          db: input.db,
          userId: input.userId,
          campaignId: input.campaignId,
          campaignDate: input.campaignDate,
        })
      : Promise.resolve([]),
  ]);

  const proposals = replan.status === "fulfilled" ? replan.value : [];
  const overflow = overflowRepairs.status === "fulfilled" ? overflowRepairs.value : [];

  return {
    replan: replan.status === "fulfilled" || overflowRepairs.status === "fulfilled"
      ? {
          status: proposals.length > 0 || overflow.length > 0 ? "ready" : "empty",
          proposals,
          overflowRepairs: overflow,
        }
      : { status: "unavailable", proposals: [], overflowRepairs: [] },
    reviewFocus: reviewFocus.status === "fulfilled"
      ? {
          status: reviewFocus.value.cards.length > 0 ? "ready" : "empty",
          board: reviewFocus.value,
        }
      : { status: "unavailable", board: { cards: [] } },
  };
}
