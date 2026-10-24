import { Prisma, type PrismaClient } from "@prisma/client";
import {
  campaignCurriculumAssets,
  genericCampaignSkeleton,
  type CampaignSkeleton,
} from "../curriculum";
import {
  campaignGoalInputSchema,
  campaignDateSchema,
  normalizedSettlementInputSchema,
  plannerSelfRatingSchema,
  type CampaignGoalInput,
  type CarryoverTaskItem,
  type LearnerNodeStateProjection,
  type ProblemAvailability,
  type ProblemExposureType,
  type SettlementProjection,
  type SkeletonProjection,
} from "../domain/contracts";
import {
  DAILY_SELECTOR_VERSION,
  deriveRepairQueueDecision,
  projectNextDailyTask,
  reduceLearnerNodeState,
  resolveNormalizedSettlementOutcome,
  resolveUnlockedNodes,
  serializeLearnerNodeState,
  serializeCarryoverTaskItem,
  serializeProblemAvailability,
  serializeRepairQueueCandidate,
} from "../core";
import {
  campaignTaskInclude,
  findActiveSkeleton,
  findCampaignWithGoal,
  findDailyTask,
  type CampaignDb,
} from "../store/campaign-repository";
import { rebuildCampaignTaskReceipt } from "./task-receipt-service";

const INTERNAL_COOLDOWN_DAYS = 7;

export type CampaignClock = Readonly<{ now: () => Date }>;
const defaultClock: CampaignClock = { now: () => new Date() };

export class ActiveCampaignExistsError extends Error {
  constructor(readonly campaignId: string) {
    super("Learner already has an active Campaign.");
    this.name = "ActiveCampaignExistsError";
  }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function parseJsonArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
    ? parsed
    : [];
}

export function projectCampaignNodeState(state: {
  nodeId: string;
  exposureState: string;
  masteryState: string;
  masteryHealth: string;
  unlockedAt: Date | null;
  startedAt: Date | null;
  masteredAt: Date | null;
  masteredBySettlementId: string | null;
  latestPositiveStreak: number;
  latestSettlementIdsJson: string;
}): LearnerNodeStateProjection {
  return {
    nodeId: state.nodeId,
    exposureState: state.exposureState as LearnerNodeStateProjection["exposureState"],
    masteryState: state.masteryState as LearnerNodeStateProjection["masteryState"],
    masteryHealth: state.masteryHealth as LearnerNodeStateProjection["masteryHealth"],
    unlockedAt: state.unlockedAt,
    startedAt: state.startedAt,
    masteredAt: state.masteredAt,
    masteredBySettlementId: state.masteredBySettlementId,
    latestPositiveStreak: state.latestPositiveStreak,
    latestSettlementIds: parseJsonArray(state.latestSettlementIdsJson),
  };
}

export function projectCampaignSkeleton(skeleton: Awaited<ReturnType<typeof findActiveSkeleton>>): SkeletonProjection {
  return {
    version: skeleton.version,
    mixedWindowDays: skeleton.mixedWindowDays,
    nodePlans: skeleton.nodePlans.map((plan) => ({
      nodeId: plan.nodeId,
      included: plan.included,
      order: plan.sortOrder,
      targetWeek: plan.targetWeek,
      goalDepth: plan.goalDepth === "exposure" ? "exposure" : "mastery",
      targetByDate: plan.targetByDate,
      priority: plan.priority,
      rationale: plan.rationale,
    })),
  };
}

function selectionSkeletonVersion(value: string): number {
  try {
    const parsed = JSON.parse(value) as { skeletonVersion?: unknown };
    return Number.isInteger(parsed.skeletonVersion) && Number(parsed.skeletonVersion) >= 1
      ? Number(parsed.skeletonVersion)
      : 1;
  } catch {
    return 1;
  }
}

function scheduledRepairQueueItemIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as { scheduledRepairQueueItemIds?: unknown };
    return Array.isArray(parsed.scheduledRepairQueueItemIds)
      ? parsed.scheduledRepairQueueItemIds.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

async function reconcileScheduledRepairsBeforeDate(
  tx: CampaignDb,
  campaignId: string,
  campaignDate: string,
  now: Date,
) {
  const scheduled = await tx.campaignRepairQueueItem.findMany({
    where: { campaignId, status: "scheduled" },
    select: { id: true, nodeId: true },
  });
  if (scheduled.length === 0) return;

  const scheduledById = new Map(scheduled.map((repair) => [repair.id, repair]));
  const referenced = new Map<string, { campaignDate: string; settled: boolean }>();
  const tasks = await tx.campaignDailyTask.findMany({
    where: { campaignId },
    select: {
      campaignDate: true,
      selectionMetadataJson: true,
      items: { select: { nodeId: true, slotRole: true, settlement: { select: { id: true } } } },
    },
  });
  for (const task of tasks) {
    for (const repairId of scheduledRepairQueueItemIds(task.selectionMetadataJson)) {
      const repair = scheduledById.get(repairId);
      if (!repair) continue;
      const remedialItems = task.items.filter((item) =>
        item.slotRole === "remedial" && item.nodeId === repair.nodeId,
      );
      referenced.set(repairId, {
        campaignDate: task.campaignDate,
        settled: remedialItems.length > 0 && remedialItems.every((item) => Boolean(item.settlement)),
      });
    }
  }

  const resolveIds: string[] = [];
  const requeueIds: string[] = [];
  for (const repair of scheduled) {
    const assignment = referenced.get(repair.id);
    if (assignment?.settled) resolveIds.push(repair.id);
    else if (!assignment || assignment.campaignDate < campaignDate) requeueIds.push(repair.id);
  }
  if (resolveIds.length > 0) {
    await tx.campaignRepairQueueItem.updateMany({
      where: { campaignId, id: { in: resolveIds }, status: "scheduled" },
      data: { status: "resolved", updatedAt: now },
    });
  }
  if (requeueIds.length > 0) {
    await tx.campaignRepairQueueItem.updateMany({
      where: { campaignId, id: { in: requeueIds }, status: "scheduled" },
      data: { status: "pending", updatedAt: now },
    });
  }
}

export async function buildExposurePlanningState(
  db: CampaignDb,
  campaignId: string,
  skeletonVersion: number,
) {
  const tasks = await db.campaignDailyTask.findMany({
    where: { campaignId },
    select: {
      selectionMetadataJson: true,
      items: {
        select: { nodeId: true, slotRole: true, status: true, settlement: { select: { id: true } } },
      },
    },
  });
  const satisfied = new Set<string>();
  const pending = new Set<string>();
  for (const task of tasks) {
    if (selectionSkeletonVersion(task.selectionMetadataJson) !== skeletonVersion) continue;
    for (const item of task.items) {
      if (item.settlement) {
        satisfied.add(item.nodeId);
        pending.delete(item.nodeId);
      } else if (item.slotRole === "probe" && (item.status === "pending" || item.status === "in_progress")) {
        if (!satisfied.has(item.nodeId)) pending.add(item.nodeId);
      }
    }
  }
  return {
    skeletonVersion,
    satisfiedNodeIds: [...satisfied].sort(),
    pendingProbeNodeIds: [...pending].sort(),
  };
}

export async function buildCampaignProblemAvailability(
  db: CampaignDb,
  userId: string,
  overrides: ReadonlyMap<string, Partial<Pick<ProblemAvailability, "exposureType" | "cooldownUntil" | "lastAttemptedAt">>>,
): Promise<ProblemAvailability[]> {
  const histories = await db.problemHistory.findMany({
    where: { userId },
    select: { createdAt: true, problem: { select: { slug: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const latestBySlug = new Map<string, Date>();
  for (const history of histories) {
    if (!latestBySlug.has(history.problem.slug)) {
      latestBySlug.set(history.problem.slug, history.createdAt);
    }
  }
  const campaignAttempts = await db.campaignTaskItem.findMany({
    where: {
      dailyTask: { campaign: { userId } },
      settlement: { isNot: null },
    },
    select: { problemSlug: true, settlement: { select: { settledAt: true } } },
  });
  for (const attempt of campaignAttempts) {
    if (!attempt.settlement) continue;
    const current = latestBySlug.get(attempt.problemSlug);
    if (!current || current < attempt.settlement.settledAt) {
      latestBySlug.set(attempt.problemSlug, attempt.settlement.settledAt);
    }
  }
  return campaignCurriculumAssets.graph.nodes.flatMap((node) =>
    node.primaryProblems.map((problem) => {
      const attemptedAt = latestBySlug.get(problem.problemSlug) ?? null;
      const override = overrides.get(problem.problemSlug);
      const exposureType: ProblemExposureType =
        override?.exposureType ?? (attemptedAt ? "internally_attempted" : "never_seen");
      return {
        problemSlug: problem.problemSlug,
        nodeId: node.nodeId,
        eligibleRoles: problem.slotRoles,
        recommendedOrder: problem.orderInNode,
        exposureType,
        lastAttemptedAt: override?.lastAttemptedAt ?? attemptedAt,
        cooldownUntil:
          override?.cooldownUntil ??
          (attemptedAt ? addDays(dateOnly(attemptedAt), INTERNAL_COOLDOWN_DAYS) : null),
      };
    }),
  );
}

export class CampaignCoreService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: CampaignClock = defaultClock,
  ) {}

  async materializeInitialCampaign(input: {
    userId: string;
    goal: CampaignGoalInput;
    initialSkeleton?: CampaignSkeleton;
    creationIdentity?: Readonly<{
      activeOwnerKey: string;
      creationKey: string;
    }>;
  }) {
    const goal = campaignGoalInputSchema.parse(input.goal);
    const initialSkeleton = input.initialSkeleton ?? genericCampaignSkeleton;
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      if (input.creationIdentity) {
        const active = await tx.campaign.findFirst({
          where: { userId: input.userId, status: "active" },
          select: { id: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        if (active) throw new ActiveCampaignExistsError(active.id);
      }
      const campaign = await tx.campaign.create({
        data: {
          userId: input.userId,
          status: "active",
          activeOwnerKey: input.creationIdentity?.activeOwnerKey,
          creationKey: input.creationIdentity?.creationKey,
          activeSkeletonVersion: 1,
          createdAt: now,
          updatedAt: now,
          goal: {
            create: {
              endDate: new Date(`${goal.endDate}T00:00:00.000Z`),
              dailyQuestionBudget: goal.dailyQuestionBudget,
              language: goal.language,
              timezone: goal.timezone,
              selfReportedWeakNodesJson: JSON.stringify(goal.selfReportedWeakNodes),
              preferredNodesJson: JSON.stringify(goal.preferredNodes),
              createdAt: now,
              updatedAt: now,
            },
          },
          skeletons: {
            create: {
              version: 1,
              mixedWindowDays: initialSkeleton.mixedWindowDays,
              createdAt: now,
              nodePlans: {
                create: initialSkeleton.nodePlans.map((plan) => ({
                  nodeId: plan.nodeId,
                  included: plan.included,
                  sortOrder: plan.order,
                  targetWeek: plan.targetWeek,
                  goalDepth: plan.goalDepth ?? "mastery",
                  targetByDate: plan.targetByDate ?? null,
                  priority: plan.priority,
                  rationale: plan.rationale,
                })),
              },
            },
          },
          learnerNodeStates: {
            create: initialSkeleton.nodePlans.map((plan) => ({
              nodeId: plan.nodeId,
              exposureState: "unknown",
              masteryState: "learning",
              masteryHealth: "stable",
              latestSettlementIdsJson: "[]",
              createdAt: now,
              updatedAt: now,
            })),
          },
        },
      });
      const states = await tx.campaignLearnerNodeState.findMany({
        where: { campaignId: campaign.id },
      });
      const resolution = resolveUnlockedNodes({
        curriculum: campaignCurriculumAssets,
        skeleton: {
          version: 1,
          mixedWindowDays: initialSkeleton.mixedWindowDays,
          nodePlans: initialSkeleton.nodePlans,
        },
        nodeStates: states.map(projectCampaignNodeState),
      });
      if (resolution.newlyUnlockedNodeIds.length > 0) {
        await tx.campaignLearnerNodeState.updateMany({
          where: {
            campaignId: campaign.id,
            nodeId: { in: [...resolution.newlyUnlockedNodeIds] },
            unlockedAt: null,
          },
          data: { unlockedAt: now, updatedAt: now },
        });
      }
      return tx.campaign.findUniqueOrThrow({
        where: { id: campaign.id },
        include: {
          goal: true,
          skeletons: { include: { nodePlans: true } },
          learnerNodeStates: true,
        },
      });
    });
  }

  async getOrCreateDailyTask(input: {
    campaignId: string;
    campaignDate: string;
    availabilityOverrides?: readonly (Partial<ProblemAvailability> & { problemSlug: string })[];
    carryoverItems?: readonly CarryoverTaskItem[];
  }) {
    campaignDateSchema.parse(input.campaignDate);
    const existing = await findDailyTask(this.prisma, input.campaignId, input.campaignDate);
    if (existing) return existing;
    const overrides = new Map(
      (input.availabilityOverrides ?? []).map((value) => [value.problemSlug, value]),
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const raced = await findDailyTask(tx, input.campaignId, input.campaignDate);
        if (raced) return raced;
        const campaign = await findCampaignWithGoal(tx, input.campaignId);
        if (!campaign.goal) throw new Error("Campaign goal is missing");
        const now = this.clock.now();
        await reconcileScheduledRepairsBeforeDate(
          tx,
          input.campaignId,
          input.campaignDate,
          now,
        );
        const skeleton = await findActiveSkeleton(tx, input.campaignId);
        const states = await tx.campaignLearnerNodeState.findMany({
          where: { campaignId: input.campaignId },
        });
        const repairs = await tx.campaignRepairQueueItem.findMany({
          where: { campaignId: input.campaignId, status: "pending" },
        });
        const problemAvailability = await buildCampaignProblemAvailability(
          tx,
          campaign.userId,
          overrides,
        );
        const exposurePlanning = await buildExposurePlanningState(
          tx,
          input.campaignId,
          skeleton.version,
        );
        const budgetOverrides = await tx.campaignDailyBudgetOverride.findMany({
          where: { campaignId: input.campaignId, status: "accepted" },
          orderBy: [{ campaignDate: "asc" }, { id: "asc" }],
        });
        const selected = projectNextDailyTask(
          {
            campaignId: input.campaignId,
            endDate: dateOnly(campaign.goal.endDate),
            curriculum: campaignCurriculumAssets,
            learnerNodeStates: states
              .map(projectCampaignNodeState)
              .map(serializeLearnerNodeState),
            repairQueueCandidates: repairs.map((repair) =>
              serializeRepairQueueCandidate({
                repairQueueItemId: repair.id,
                nodeId: repair.nodeId,
                priority: repair.priority,
                createdAt: repair.createdAt,
              }),
            ),
            problemAvailability: problemAvailability.map(serializeProblemAvailability),
            carryoverItems: input.carryoverItems?.map(serializeCarryoverTaskItem),
            exposurePlanning,
            acceptedDailyBudgetOverrides: budgetOverrides.map((override) => ({
              campaignDate: override.campaignDate,
              maxQuestions: override.maxQuestions,
              status: "accepted" as const,
              expiresAt: override.expiresAt?.toISOString() ?? null,
            })),
          },
          projectCampaignSkeleton(skeleton),
          campaign.goal.dailyQuestionBudget,
          input.campaignDate,
          { selectorVersion: DAILY_SELECTOR_VERSION },
        );
        if (selected.kind === "no_task") return selected;
        const task = await tx.campaignDailyTask.create({
          data: {
            campaignId: input.campaignId,
            campaignDate: input.campaignDate,
            budget: selected.budget,
            primaryNodeId: selected.primaryNodeId,
            status: "active",
            selectionMetadataJson: JSON.stringify({
              skeletonVersion: skeleton.version,
              scheduledRepairQueueItemIds: selected.scheduledRepairQueueItemIds,
              scheduledRepairs: selected.items.flatMap((item) => item.repairQueueItemId
                ? [{
                    repairQueueItemId: item.repairQueueItemId,
                    problemSlug: item.problemSlug,
                    nodeId: item.nodeId,
                  }]
                : []),
              shortfall: selected.shortfall,
            }),
            createdAt: now,
            updatedAt: now,
            items: {
              create: selected.items.map((item) => ({
                ...(item.carryoverFromTaskItemId
                  ? { carryoverFromTaskItemId: item.carryoverFromTaskItemId }
                  : {}),
                problemSlug: item.problemSlug,
                nodeId: item.nodeId,
                slotRole: item.slotRole,
                exposureType: item.exposureType,
                sortOrder: item.order,
                status: "pending",
                createdAt: now,
                updatedAt: now,
              })),
            },
          },
          include: campaignTaskInclude,
        });
        if (selected.primaryNodeId) {
          await tx.campaignLearnerNodeState.updateMany({
            where: {
              campaignId: input.campaignId,
              nodeId: selected.primaryNodeId,
              startedAt: null,
            },
            data: { startedAt: now, updatedAt: now },
          });
        }
        if (selected.scheduledRepairQueueItemIds.length > 0) {
          await tx.campaignRepairQueueItem.updateMany({
            where: {
              campaignId: input.campaignId,
              id: { in: [...selected.scheduledRepairQueueItemIds] },
              status: "pending",
            },
            data: { status: "scheduled", updatedAt: now },
          });
        }
        return task;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await findDailyTask(this.prisma, input.campaignId, input.campaignDate);
        if (raced) return raced;
      }
      throw error;
    }
  }

  async startTaskItemAttempt(input: {
    taskItemId: string;
    attemptId?: string;
    startedAt?: Date;
  }) {
    const startedAt = input.startedAt ?? this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.campaignTaskItem.update({
        where: { id: input.taskItemId },
        data: { status: "in_progress", updatedAt: startedAt },
      });
      return tx.campaignTaskItemAttempt.create({
        data: {
          ...(input.attemptId ? { id: input.attemptId } : {}),
          taskItemId: input.taskItemId,
          startedAt,
          createdAt: startedAt,
          updatedAt: startedAt,
        },
      });
    });
  }

  async settleTaskItem(input: {
    campaignId: string;
    taskItemId: string;
    attemptId: string;
    settledAt: Date;
    normalized: unknown;
  }) {
    const normalized = normalizedSettlementInputSchema.parse(input.normalized);
    try {
      return await this.prisma.$transaction(async (tx) => {
      const item = await tx.campaignTaskItem.findUniqueOrThrow({
        where: { id: input.taskItemId },
        include: {
          dailyTask: true,
          attempts: { where: { id: input.attemptId } },
          settlement: true,
        },
      });
      if (item.dailyTask.campaignId !== input.campaignId || item.attempts.length !== 1) {
        throw new Error("Task item and attempt do not belong to the campaign settlement");
      }
      if (item.settlement) return item.settlement;
      if (!['pending', 'in_progress'].includes(item.status)) {
        throw new Error("Campaign task item is no longer active for settlement");
      }

      const validRating = plannerSelfRatingSchema.safeParse(normalized.selfRating).success;
      const resolution = resolveNormalizedSettlementOutcome(normalized);
      if (!resolution) throw new Error("Invalid normalized Settlement input");
      if (resolution.outcome === "no_settlement") {
        throw new Error("Settlement requires a completed owned Review and persisted self-rating");
      }
      const positiveForMastery = resolution.positiveForMastery;
      const negativeOutcome = resolution.negativeOutcome;
      const selectedEvidence = resolution.evidence;
      const settlement = await tx.campaignTaskItemSettlement.create({
        data: {
          taskItemId: item.id,
          attemptId: input.attemptId,
          reviewCompleted: normalized.reviewCompleted,
          passed: resolution.passed,
          selfRating: validRating ? String(normalized.selfRating) : null,
          positiveForMastery,
          negativeOutcome,
          settledAt: input.settledAt,
          settlementVersion: 2,
          evidenceSource: selectedEvidence?.source ?? normalized.evidenceSource ?? null,
          evidenceReferenceId: selectedEvidence?.referenceId ?? normalized.evidenceReferenceId ?? null,
          evidenceClass: selectedEvidence?.evidenceClass ?? normalized.evidenceClass ?? null,
          evidenceAuthority: selectedEvidence?.evidenceAuthority ?? normalized.evidenceAuthority ?? null,
          evidenceScope: selectedEvidence?.evidenceScope ?? normalized.evidenceScope ?? null,
          evidenceSubject: selectedEvidence?.subject ?? normalized.evidenceSubject ?? null,
          createdAt: this.clock.now(),
        },
      });
      await tx.campaignTaskItemAttempt.update({
        where: { id: input.attemptId },
        data: {
          codeRevision: normalized.codeRevision ?? null,
          evidenceClass: selectedEvidence?.evidenceClass ?? normalized.evidenceClass ?? null,
          evidenceAuthority: selectedEvidence?.evidenceAuthority ?? normalized.evidenceAuthority ?? null,
          evidenceScope: selectedEvidence?.evidenceScope ?? normalized.evidenceScope ?? null,
          verdict: selectedEvidence
            ? selectedEvidence.verdict === "passed" ? "passed_visible_tests" : selectedEvidence.verdict === "failed" ? "failed" : normalized.verdict ?? null
            : normalized.verdict ?? null,
          completedAt: input.settledAt,
          updatedAt: this.clock.now(),
        },
      });
      await tx.campaignTaskItem.update({
        where: { id: item.id },
        data: { status: "settled", updatedAt: this.clock.now() },
      });

      if (item.slotRole === "remedial") {
        const repairIds = scheduledRepairQueueItemIds(item.dailyTask.selectionMetadataJson);
        if (repairIds.length > 0) {
          await tx.campaignRepairQueueItem.updateMany({
            where: {
              campaignId: input.campaignId,
              id: { in: repairIds },
              nodeId: item.nodeId,
              status: "scheduled",
            },
            data: { status: "resolved", updatedAt: this.clock.now() },
          });
        }
      }

      const curriculumNode = campaignCurriculumAssets.graph.nodes.find(
        (node) => node.nodeId === item.nodeId,
      );
      if (
        !curriculumNode ||
        !curriculumNode.primaryProblems.some(
          (problem) => problem.problemSlug === item.problemSlug,
        )
      ) {
        throw new Error("TaskItem does not match the active Curriculum Graph truth");
      }
      let beforeState: LearnerNodeStateProjection | null = null;
      let reduction: ReturnType<typeof reduceLearnerNodeState> | null = null;
      let currentRecordId: string | null = null;
      if (curriculumNode.kind === "transferable") {
        const currentRecord = await tx.campaignLearnerNodeState.findUniqueOrThrow({
          where: {
            campaignId_nodeId: {
              campaignId: input.campaignId,
              nodeId: item.nodeId,
            },
          },
        });
        currentRecordId = currentRecord.id;
        const nodeItems = await tx.campaignTaskItem.findMany({
          where: {
            dailyTask: { campaignId: input.campaignId },
            nodeId: item.nodeId,
          },
          include: { settlement: true },
        });
        const projections: SettlementProjection[] = nodeItems.flatMap((nodeItem) =>
          nodeItem.settlement
            ? [{
                settlementId: nodeItem.settlement.id,
                problemSlug: nodeItem.problemSlug,
                slotRole: nodeItem.slotRole as SettlementProjection["slotRole"],
                positiveForMastery: nodeItem.settlement.positiveForMastery,
                negativeOutcome: nodeItem.settlement.negativeOutcome,
                settledAt: nodeItem.settlement.settledAt,
              }]
            : [],
        );
        beforeState = projectCampaignNodeState(currentRecord);
        reduction = reduceLearnerNodeState({
          currentState: beforeState,
          settlements: projections,
        });
        await tx.campaignLearnerNodeState.update({
          where: { id: currentRecord.id },
          data: {
            exposureState: "internally_attempted",
            masteryState: reduction.state.masteryState,
            masteryHealth: reduction.state.masteryHealth,
            masteredAt: reduction.state.masteredAt,
            masteredBySettlementId: reduction.state.masteredBySettlementId,
            latestPositiveStreak: reduction.state.latestPositiveStreak,
            latestSettlementIdsJson: JSON.stringify(
              reduction.state.latestSettlementIds,
            ),
            updatedAt: this.clock.now(),
          },
        });
      }
      const repair = deriveRepairQueueDecision({
        nodeKind: curriculumNode.kind,
        beforeState,
        reduction,
        slotRole: item.slotRole as SettlementProjection["slotRole"],
        positiveForMastery,
        negativeOutcome,
      });
      if (repair.enqueue && repair.reason && repair.priority !== null) {
        await tx.campaignRepairQueueItem.upsert({
          where: {
            campaignId_nodeId_triggerTaskItemId_reason: {
              campaignId: input.campaignId,
              nodeId: item.nodeId,
              triggerTaskItemId: item.id,
              reason: repair.reason,
            },
          },
          create: {
            campaignId: input.campaignId,
            nodeId: item.nodeId,
            triggerTaskItemId: item.id,
            reason: repair.reason,
            priority: repair.priority,
            status: "pending",
            createdAt: this.clock.now(),
            updatedAt: this.clock.now(),
          },
          update: { priority: repair.priority, updatedAt: this.clock.now() },
        });
      }

      if (reduction && currentRecordId) {
        const reducedState = reduction.state;
        const skeleton = await findActiveSkeleton(tx, input.campaignId);
        const allStates = await tx.campaignLearnerNodeState.findMany({
          where: { campaignId: input.campaignId },
        });
        const resolution = resolveUnlockedNodes({
          curriculum: campaignCurriculumAssets,
          skeleton: projectCampaignSkeleton(skeleton),
          nodeStates: allStates.map((state) =>
            state.id === currentRecordId ? reducedState : projectCampaignNodeState(state),
          ),
        });
        if (resolution.newlyUnlockedNodeIds.length > 0) {
          await tx.campaignLearnerNodeState.updateMany({
            where: {
              campaignId: input.campaignId,
              nodeId: { in: [...resolution.newlyUnlockedNodeIds] },
              unlockedAt: null,
            },
            data: { unlockedAt: input.settledAt, updatedAt: this.clock.now() },
          });
        }
      }
      await rebuildCampaignTaskReceipt(tx, item.dailyTaskId, { now: this.clock.now() });
      return settlement;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.campaignTaskItemSettlement.findUnique({
          where: { taskItemId: input.taskItemId },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  async rebuildTaskReceipt(taskId: string) {
    return this.prisma.$transaction((tx) =>
      rebuildCampaignTaskReceipt(tx, taskId, { now: this.clock.now() }),
    );
  }

  async markRepairScheduled(repairQueueItemId: string) {
    return this.prisma.campaignRepairQueueItem.update({
      where: { id: repairQueueItemId },
      data: { status: "scheduled", updatedAt: this.clock.now() },
    });
  }

  async resolveRepair(repairQueueItemId: string) {
    return this.prisma.campaignRepairQueueItem.update({
      where: { id: repairQueueItemId },
      data: { status: "resolved", updatedAt: this.clock.now() },
    });
  }

}
