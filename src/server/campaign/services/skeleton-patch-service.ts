import { Prisma, type PrismaClient } from "@prisma/client";
import { campaignCurriculumAssets } from "../curriculum";
import {
  formatCampaignDate,
  resolveUnlockedNodes,
  validateCampaignSkeletonPatch,
  validateStrategistProposalPolicy,
} from "../core";
import {
  campaignPatchActorTypeSchema,
  campaignPatchStatusSchema,
  campaignSkeletonPatchProposalSchema,
  canonicalJson,
  dailyBudgetSuggestionSchema,
  dateBudgetSuggestionSchema,
  fingerprintCampaignPatch,
  storedCampaignSkeletonPatchOperationsSchema,
  type CampaignPatchActorType,
  type CampaignSkeletonPatchOperation,
  type DailyBudgetDecision,
  type DateBudgetSuggestion,
  type StoredCampaignSkeletonPatchOperation,
} from "../domain";
import {
  findActiveSkeleton,
  findSkeletonPatchByFingerprint,
  findSkeletonPatchForOwner,
  type CampaignDb,
} from "../store";
import { projectCampaignNodeState, projectCampaignSkeleton, type CampaignClock } from "./campaign-core-service";
import { reconcileRouteDependentState } from "./route-reconciliation-service";

const defaultClock: CampaignClock = { now: () => new Date() };

export class CampaignSkeletonPatchError extends Error {
  constructor(
    readonly code:
      | "campaign_not_found"
      | "patch_not_found"
      | "invalid_patch"
      | "invalid_partial_selection"
      | "budget_acceptance_requires_user",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CampaignSkeletonPatchError";
  }
}

class StaleBaseVersionError extends Error {}

function parseOperationEnvelope(value: string) {
  return storedCampaignSkeletonPatchOperationsSchema.parse(JSON.parse(value));
}

function parseOperations(value: string) {
  return parseOperationEnvelope(value).operations;
}

function parseBudgetSuggestions(value: string | null): {
  legacy: ReturnType<typeof dailyBudgetSuggestionSchema.parse> | null;
  dates: DateBudgetSuggestion[];
} {
  if (!value) return { legacy: null, dates: [] };
  const parsed: unknown = JSON.parse(value);
  const legacy = dailyBudgetSuggestionSchema.safeParse(parsed);
  if (legacy.success) return { legacy: legacy.data, dates: [] };
  const envelope = parsed && typeof parsed === "object"
    ? parsed as { legacyDailyBudgetSuggestion?: unknown; dateBudgetSuggestions?: unknown }
    : {};
  const legacyEnvelope = envelope.legacyDailyBudgetSuggestion
    ? dailyBudgetSuggestionSchema.parse(envelope.legacyDailyBudgetSuggestion)
    : null;
  const dates = Array.isArray(envelope.dateBudgetSuggestions)
    ? envelope.dateBudgetSuggestions.map((entry) => dateBudgetSuggestionSchema.parse(entry))
    : [];
  return { legacy: legacyEnvelope, dates };
}

function withoutOperationId(operation: StoredCampaignSkeletonPatchOperation): CampaignSkeletonPatchOperation {
  return Object.fromEntries(
    Object.entries(operation).filter(([key]) => key !== "operationId"),
  ) as CampaignSkeletonPatchOperation;
}

function validationSummary(result: ReturnType<typeof validateStrategistProposalPolicy>) {
  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    changedNodeIds: result.skeletonValidation.changedNodeIds,
    impactSummary: result.skeletonValidation.impactSummary,
    validationFingerprint: result.skeletonValidation.fingerprint,
  };
}

function proposalFingerprint(input: {
  campaignId: string;
  baseVersion: number;
  trigger: string;
  rationale: string;
  patchSchemaVersion: number;
  operations: readonly StoredCampaignSkeletonPatchOperation[];
  dailyBudgetSuggestion: unknown;
  dateBudgetSuggestions: unknown;
}) {
  const legacyPayload = {
    campaignId: input.campaignId,
    patchSchemaVersion: input.patchSchemaVersion,
    baseVersion: input.baseVersion,
    trigger: input.trigger,
    rationale: input.rationale,
    operations: input.operations,
    dailyBudgetSuggestion: input.dailyBudgetSuggestion ?? null,
  };
  return fingerprintCampaignPatch(
    input.patchSchemaVersion === 1
      ? legacyPayload
      : { ...legacyPayload, dateBudgetSuggestions: input.dateBudgetSuggestions ?? [] },
  );
}

function parseNodeIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function operationValueFromSkeleton(
  operation: CampaignSkeletonPatchOperation,
  skeleton: ReturnType<typeof projectCampaignSkeleton>,
): unknown {
  if (operation.type === "set_mixed_window_days") return skeleton.mixedWindowDays;
  const plan = skeleton.nodePlans.find((entry) => entry.nodeId === operation.nodeId);
  if (!plan) return null;
  switch (operation.type) {
    case "set_node_included": return plan.included;
    case "set_node_priority": return plan.priority;
    case "set_target_week": return plan.targetWeek;
    case "set_goal_depth": return plan.goalDepth ?? "mastery";
    case "set_target_by_date": return plan.targetByDate ?? null;
    case "set_node_rationale": return plan.rationale;
    case "move_node": return plan.order;
  }
}

export async function buildStrategistPolicyContext(
  db: CampaignDb,
  campaign: Awaited<ReturnType<typeof loadOwnedCampaign>>,
  now: Date,
) {
  const campaignDate = formatCampaignDate(now, campaign.goal.timezone);
  const userGoals = new Set([
    ...parseNodeIds(campaign.goal.selfReportedWeakNodesJson),
    ...parseNodeIds(campaign.goal.preferredNodesJson),
  ]);
  const currentDailyTask = await db.campaignDailyTask.findUnique({
    where: { campaignId_campaignDate: { campaignId: campaign.id, campaignDate } },
    select: { id: true, campaignDate: true },
  });
  const decisions = await db.campaignSkeletonDecisionLog.findMany({
    where: { campaignId: campaign.id, action: { in: ["accepted", "partially_accepted"] } },
    include: { patch: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  const skeletonVersions = [...new Set(decisions.flatMap((decision) =>
    decision.resultingVersion ? [decision.baseVersion, decision.resultingVersion] : [decision.baseVersion],
  ))];
  const skeletonRows = skeletonVersions.length > 0
    ? await db.campaignSkeleton.findMany({
        where: { campaignId: campaign.id, version: { in: skeletonVersions } },
        include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
      })
    : [];
  const skeletonByVersion = new Map(skeletonRows.map((skeleton) => [skeleton.version, projectCampaignSkeleton(skeleton)]));
  const recentlyAcceptedChanges = decisions.flatMap((decision) => {
    if (!decision.resultingVersion) return [];
    const before = skeletonByVersion.get(decision.baseVersion);
    const after = skeletonByVersion.get(decision.resultingVersion);
    if (!before || !after) return [];
    const acceptedIds = new Set(parseNodeIds(decision.acceptedOperationIdsJson));
    return parseOperations(decision.patch.operationsJson)
      .filter((operation) => acceptedIds.has(operation.operationId))
      .map((stored) => {
        const operation = withoutOperationId(stored);
        return {
          operationType: operation.type,
          ...(operation.type === "set_mixed_window_days" ? {} : { nodeId: operation.nodeId }),
          beforeValue: operationValueFromSkeleton(operation, before),
          afterValue: operationValueFromSkeleton(operation, after),
          acceptedAt: decision.createdAt.toISOString(),
        };
      });
  });
  const [masteryFacts, repairFacts] = await Promise.all([
    db.campaignLearnerNodeState.findMany({
      where: { campaignId: campaign.id, masteredAt: { not: null } },
      select: { nodeId: true, masteredAt: true },
    }),
    db.campaignRepairQueueItem.findMany({
      where: { campaignId: campaign.id },
      select: { nodeId: true, createdAt: true },
    }),
  ]);
  return {
    schemaVersion: 1 as const,
    activeSkeletonVersion: campaign.activeSkeletonVersion,
    planningHorizon: {
      startDate: campaignDate,
      endDate: campaign.goal.endDate.toISOString().slice(0, 10),
    },
    goalSources: campaignCurriculumAssets.graph.nodes.map((node) => ({
      nodeId: node.nodeId,
      source: userGoals.has(node.nodeId) ? "user" as const : "system" as const,
    })),
    currentDailyTask: currentDailyTask
      ? { taskId: currentDailyTask.id, campaignDate: currentDailyTask.campaignDate }
      : null,
    recentlyAcceptedChanges,
    newFacts: [
      ...masteryFacts.flatMap((fact) => fact.masteredAt ? [{ type: "mastery" as const, nodeId: fact.nodeId, observedAt: fact.masteredAt.toISOString() }] : []),
      ...repairFacts.map((fact) => ({ type: "repair_trigger" as const, nodeId: fact.nodeId, observedAt: fact.createdAt.toISOString() })),
    ],
    evaluatedAt: now.toISOString(),
  };
}

export async function validatePlanningProposal(input: {
  db: CampaignDb;
  campaign: Awaited<ReturnType<typeof loadOwnedCampaign>>;
  now: Date;
  trigger: string;
  skeleton: Parameters<typeof validateCampaignSkeletonPatch>[0];
}) {
  if (input.trigger.startsWith("strategist_")) {
    return validateStrategistProposalPolicy({
      skeleton: input.skeleton,
      context: await buildStrategistPolicyContext(input.db, input.campaign, input.now),
    });
  }
  const skeletonValidation = validateCampaignSkeletonPatch(input.skeleton);
  return {
    valid: skeletonValidation.valid,
    errors: skeletonValidation.errors,
    warnings: skeletonValidation.warnings,
    skeletonValidation,
    resultingSkeletonPreview: skeletonValidation.resultingSkeletonPreview,
  };
}

async function loadOwnedCampaign(db: CampaignDb, campaignId: string, userId: string) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, userId, status: "active" },
    include: { goal: true },
  });
  if (!campaign?.goal) {
    throw new CampaignSkeletonPatchError("campaign_not_found", "Campaign or Campaign Goal was not found for this learner.");
  }
  return { ...campaign, goal: campaign.goal };
}

export class CampaignSkeletonPatchService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: CampaignClock = defaultClock,
  ) {}

  async createSkeletonPatchProposal(input: {
    userId: string;
    campaignId: string;
    proposal: unknown;
  }) {
    const proposal = campaignSkeletonPatchProposalSchema.parse(input.proposal);
    const campaign = await loadOwnedCampaign(this.prisma, input.campaignId, input.userId);
    const activeSkeleton = await findActiveSkeleton(this.prisma, input.campaignId);
    const normalizedOperations = proposal.operations.map((operation, index) => ({
      operationId: `op-${String(index + 1).padStart(3, "0")}`,
      ...operation,
    })) as StoredCampaignSkeletonPatchOperation[];
    const fingerprint = proposalFingerprint({
      campaignId: input.campaignId,
      baseVersion: proposal.baseVersion,
      trigger: proposal.trigger,
      rationale: proposal.rationale,
      patchSchemaVersion: proposal.patchSchemaVersion,
      operations: normalizedOperations,
      dailyBudgetSuggestion: proposal.dailyBudgetSuggestion,
      dateBudgetSuggestions: proposal.dateBudgetSuggestions,
    });
    const duplicate = await findSkeletonPatchByFingerprint(this.prisma, {
      campaignId: input.campaignId,
      userId: input.userId,
      proposalFingerprint: fingerprint,
    });
    if (duplicate) return { kind: "existing" as const, patch: duplicate };

    const existingPending = await this.prisma.campaignSkeletonPatch.findFirst({
      where: { campaignId: input.campaignId, status: "pending" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const result = await validatePlanningProposal({
      db: this.prisma,
      campaign,
      now: this.clock.now(),
      trigger: proposal.trigger,
      skeleton: {
        activeSkeleton: projectCampaignSkeleton(activeSkeleton),
        proposedPatch: proposal,
        campaignGoal: { dailyQuestionBudget: campaign.goal.dailyQuestionBudget },
        existingPendingPatch: existingPending
          ? { patchId: existingPending.id, baseVersion: existingPending.baseVersion }
          : null,
      },
    });
    if (!result.valid) {
      throw new CampaignSkeletonPatchError("invalid_patch", "Campaign Skeleton patch validation failed.", result);
    }
    const now = this.clock.now();
    try {
      const patch = await this.prisma.campaignSkeletonPatch.create({
        data: {
          campaignId: input.campaignId,
          baseVersion: proposal.baseVersion,
          trigger: proposal.trigger,
          rationale: proposal.rationale,
          status: "pending",
          patchSchemaVersion: proposal.patchSchemaVersion,
          operationsJson: canonicalJson({
            patchSchemaVersion: proposal.patchSchemaVersion,
            operations: result.skeletonValidation.normalizedOperations,
          }),
          proposalFingerprint: fingerprint,
          dailyBudgetSuggestionJson: proposal.patchSchemaVersion === 1
            ? proposal.dailyBudgetSuggestion
              ? canonicalJson(proposal.dailyBudgetSuggestion)
              : null
            : proposal.dailyBudgetSuggestion || (proposal.dateBudgetSuggestions?.length ?? 0) > 0
              ? canonicalJson({
                  legacyDailyBudgetSuggestion: proposal.dailyBudgetSuggestion ?? null,
                  dateBudgetSuggestions: proposal.dateBudgetSuggestions ?? [],
                })
              : null,
          validatorSummaryJson: canonicalJson(validationSummary(result)),
          createdAt: now,
          updatedAt: now,
        },
        include: { decision: true },
      });
      return { kind: "created" as const, patch, validation: result };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await findSkeletonPatchByFingerprint(this.prisma, {
          campaignId: input.campaignId,
          userId: input.userId,
          proposalFingerprint: fingerprint,
        });
        if (raced) return { kind: "existing" as const, patch: raced };
      }
      throw error;
    }
  }

  async acceptSkeletonPatch(input: {
    userId: string;
    patchId: string;
    actorType: CampaignPatchActorType;
    rationale?: string;
    acceptDailyBudgetSuggestion?: boolean;
  }) {
    return this.decideAndApply({
      ...input,
      mode: "accept",
      acceptedOperationIds: null,
    });
  }

  async partiallyAcceptSkeletonPatch(input: {
    userId: string;
    patchId: string;
    acceptedOperationIds: readonly string[];
    actorType: CampaignPatchActorType;
    rationale?: string;
    acceptDailyBudgetSuggestion?: boolean;
  }) {
    return this.decideAndApply({ ...input, mode: "partial" });
  }

  async rejectSkeletonPatch(input: {
    userId: string;
    patchId: string;
    actorType: CampaignPatchActorType;
    rationale?: string;
  }) {
    const actorType = campaignPatchActorTypeSchema.parse(input.actorType);
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const patch = await findSkeletonPatchForOwner(tx, input);
      if (!patch) throw new CampaignSkeletonPatchError("patch_not_found", "Campaign Skeleton patch was not found.");
      const status = campaignPatchStatusSchema.parse(patch.status);
      if (status !== "pending") return { kind: "already_decided" as const, patch };
      const operations = parseOperations(patch.operationsJson);
      const changed = await tx.campaignSkeletonPatch.updateMany({
        where: { id: patch.id, status: "pending" },
        data: { status: "rejected", decidedAt: now, updatedAt: now },
      });
      if (changed.count !== 1) {
        const decided = await findSkeletonPatchForOwner(tx, input);
        return { kind: "already_decided" as const, patch: decided! };
      }
      await tx.campaignSkeletonDecisionLog.create({
        data: {
          campaignId: patch.campaignId,
          patchId: patch.id,
          action: "rejected",
          actorType,
          baseVersion: patch.baseVersion,
          resultingVersion: null,
          acceptedOperationIdsJson: "[]",
          rejectedOperationIdsJson: canonicalJson(operations.map((operation) => operation.operationId)),
          dailyBudgetDecision: patch.dailyBudgetSuggestionJson ? "rejected" : "not_present",
          rationale: input.rationale?.trim() || null,
          createdAt: now,
        },
      });
      return {
        kind: "rejected" as const,
        patch: await findSkeletonPatchForOwner(tx, input),
      };
    });
  }

  private async decideAndApply(input: {
    userId: string;
    patchId: string;
    actorType: CampaignPatchActorType;
    rationale?: string;
    acceptDailyBudgetSuggestion?: boolean;
    mode: "accept" | "partial";
    acceptedOperationIds: readonly string[] | null;
  }) {
    const actorType = campaignPatchActorTypeSchema.parse(input.actorType);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const patch = await findSkeletonPatchForOwner(tx, input);
        if (!patch) throw new CampaignSkeletonPatchError("patch_not_found", "Campaign Skeleton patch was not found.");
        const status = campaignPatchStatusSchema.parse(patch.status);
        if (status !== "pending") return { kind: "already_decided" as const, patch };
        const campaign = await loadOwnedCampaign(tx, patch.campaignId, input.userId);
        if (campaign.activeSkeletonVersion !== patch.baseVersion) {
          return {
            kind: "stale_base_version" as const,
            patch,
            activeVersion: campaign.activeSkeletonVersion,
          };
        }
        const storedEnvelope = parseOperationEnvelope(patch.operationsJson);
        const allOperations = storedEnvelope.operations;
        const allIds = allOperations.map((operation) => operation.operationId);
        let acceptedOperations = allOperations;
        if (input.mode === "partial") {
          const selectedIds = [...new Set(input.acceptedOperationIds ?? [])];
          if (
            selectedIds.length === 0 ||
            selectedIds.length >= allIds.length ||
            selectedIds.some((operationId) => !allIds.includes(operationId))
          ) {
            throw new CampaignSkeletonPatchError(
              "invalid_partial_selection",
              "Partial acceptance must select at least one but not all stored operation ids.",
            );
          }
          acceptedOperations = allOperations.filter((operation) => selectedIds.includes(operation.operationId));
        }
        const rejectedOperationIds = allIds.filter(
          (operationId) => !acceptedOperations.some((operation) => operation.operationId === operationId),
        );
        const activeSkeleton = await findActiveSkeleton(tx, patch.campaignId);
        const budgetSuggestions = parseBudgetSuggestions(patch.dailyBudgetSuggestionJson);
        const hasBudgetSuggestion = Boolean(budgetSuggestions.legacy) || budgetSuggestions.dates.length > 0;
        if (hasBudgetSuggestion && input.acceptDailyBudgetSuggestion && actorType !== "user") {
          throw new CampaignSkeletonPatchError(
            "budget_acceptance_requires_user",
            "Only an explicit user decision can accept a daily budget suggestion.",
          );
        }
        if (budgetSuggestions.dates.length > 0 && input.acceptDailyBudgetSuggestion) {
          const conflictingOverride = await tx.campaignDailyBudgetOverride.findFirst({
            where: {
              campaignId: patch.campaignId,
              campaignDate: { in: budgetSuggestions.dates.map((suggestion) => suggestion.campaignDate) },
            },
            select: { campaignDate: true, patchId: true },
          });
          if (conflictingOverride && conflictingOverride.patchId !== patch.id) {
            throw new CampaignSkeletonPatchError(
              "invalid_patch",
              "An accepted date budget already owns this campaign date.",
              { errors: [{ code: "date_budget_override_conflict", campaignDate: conflictingOverride.campaignDate }] },
            );
          }
        }
        const proposal = {
          patchSchemaVersion: storedEnvelope.patchSchemaVersion,
          baseVersion: patch.baseVersion,
          trigger: patch.trigger,
          rationale: patch.rationale,
          operations: acceptedOperations.map(withoutOperationId),
          dailyBudgetSuggestion: budgetSuggestions.legacy,
          dateBudgetSuggestions: budgetSuggestions.dates,
        };
        const validation = await validatePlanningProposal({
          db: tx,
          campaign,
          now: this.clock.now(),
          trigger: patch.trigger,
          skeleton: {
            activeSkeleton: projectCampaignSkeleton(activeSkeleton),
            proposedPatch: proposal,
            campaignGoal: { dailyQuestionBudget: campaign.goal!.dailyQuestionBudget },
          },
        });
        if (!validation.valid || !validation.resultingSkeletonPreview) {
          throw new CampaignSkeletonPatchError("invalid_patch", "Accepted Patch operations no longer produce a valid Skeleton.", validation);
        }

        const now = this.clock.now();
        const nextVersion = campaign.activeSkeletonVersion + 1;
        const decisionStatus = input.mode === "accept" ? "accepted" : "partially_accepted";
        const claimed = await tx.campaignSkeletonPatch.updateMany({
          where: { id: patch.id, status: "pending" },
          data: {
            status: decisionStatus,
            decidedAt: now,
            appliedSkeletonVersion: nextVersion,
            validatorSummaryJson: canonicalJson(validationSummary(validation)),
            updatedAt: now,
          },
        });
        if (claimed.count !== 1) {
          const decided = await findSkeletonPatchForOwner(tx, input);
          return { kind: "already_decided" as const, patch: decided! };
        }
        await tx.campaignSkeleton.create({
          data: {
            campaignId: patch.campaignId,
            version: nextVersion,
            mixedWindowDays: validation.resultingSkeletonPreview.mixedWindowDays,
            createdAt: now,
            nodePlans: {
              create: validation.resultingSkeletonPreview.nodePlans.map((plan) => ({
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
        });
        const advanced = await tx.campaign.updateMany({
          where: { id: patch.campaignId, userId: input.userId, activeSkeletonVersion: patch.baseVersion },
          data: { activeSkeletonVersion: nextVersion, updatedAt: now },
        });
        if (advanced.count !== 1) throw new StaleBaseVersionError();

        const existingStates = await tx.campaignLearnerNodeState.findMany({ where: { campaignId: patch.campaignId } });
        const existingNodeIds = new Set(existingStates.map((state) => state.nodeId));
        for (const plan of validation.resultingSkeletonPreview.nodePlans) {
          if (!existingNodeIds.has(plan.nodeId)) {
            await tx.campaignLearnerNodeState.create({
              data: {
                campaignId: patch.campaignId,
                nodeId: plan.nodeId,
                exposureState: "unknown",
                masteryState: "learning",
                masteryHealth: "stable",
                latestSettlementIdsJson: "[]",
                createdAt: now,
                updatedAt: now,
              },
            });
          }
        }
        const allStates = await tx.campaignLearnerNodeState.findMany({ where: { campaignId: patch.campaignId } });
        const unlock = resolveUnlockedNodes({
          curriculum: campaignCurriculumAssets,
          skeleton: validation.resultingSkeletonPreview,
          nodeStates: allStates.map(projectCampaignNodeState),
        });
        if (unlock.newlyUnlockedNodeIds.length > 0) {
          await tx.campaignLearnerNodeState.updateMany({
            where: {
              campaignId: patch.campaignId,
              nodeId: { in: [...unlock.newlyUnlockedNodeIds] },
              unlockedAt: null,
            },
            data: { unlockedAt: now, updatedAt: now },
          });
        }

        await reconcileRouteDependentState(tx, {
          campaignId: patch.campaignId,
          resultingSkeleton: validation.resultingSkeletonPreview,
          campaignDate: formatCampaignDate(now, campaign.goal!.timezone),
          now,
        });

        const dailyBudgetDecision: DailyBudgetDecision = hasBudgetSuggestion
          ? input.acceptDailyBudgetSuggestion
            ? "accepted"
            : "rejected"
          : "not_present";
        if (budgetSuggestions.legacy && dailyBudgetDecision === "accepted") {
          await tx.campaignGoal.update({
            where: { campaignId: patch.campaignId },
            data: { dailyQuestionBudget: budgetSuggestions.legacy.proposedBudget, updatedAt: now },
          });
        }
        if (budgetSuggestions.dates.length > 0 && dailyBudgetDecision === "accepted") {
          for (const suggestion of budgetSuggestions.dates) {
            await tx.campaignDailyBudgetOverride.create({
              data: {
                campaignId: patch.campaignId,
                campaignDate: suggestion.campaignDate,
                maxQuestions: suggestion.maxQuestions,
                source: "strategist_patch",
                status: "accepted",
                approvedAt: now,
                expiresAt: suggestion.expiresAt ? new Date(suggestion.expiresAt) : null,
                patchId: patch.id,
                createdAt: now,
                updatedAt: now,
              },
            });
          }
        }
        await tx.campaignSkeletonDecisionLog.create({
          data: {
            campaignId: patch.campaignId,
            patchId: patch.id,
            action: decisionStatus,
            actorType,
            baseVersion: patch.baseVersion,
            resultingVersion: nextVersion,
            acceptedOperationIdsJson: canonicalJson(acceptedOperations.map((operation) => operation.operationId)),
            rejectedOperationIdsJson: canonicalJson(rejectedOperationIds),
            dailyBudgetDecision,
            rationale: input.rationale?.trim() || null,
            createdAt: now,
          },
        });
        return {
          kind: "applied" as const,
          status: decisionStatus,
          newVersion: nextVersion,
          validation,
          patch: await findSkeletonPatchForOwner(tx, input),
        };
      });
    } catch (error) {
      if (error instanceof StaleBaseVersionError) {
        const patch = await findSkeletonPatchForOwner(this.prisma, input);
        const campaign = patch
          ? await this.prisma.campaign.findUnique({ where: { id: patch.campaignId } })
          : null;
        return {
          kind: "stale_base_version" as const,
          patch: patch!,
          activeVersion: campaign?.activeSkeletonVersion ?? -1,
        };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const patch = await findSkeletonPatchForOwner(this.prisma, input);
        if (patch?.status !== "pending") return { kind: "already_decided" as const, patch };
        const campaign = patch
          ? await this.prisma.campaign.findUnique({ where: { id: patch.campaignId } })
          : null;
        if (patch && campaign?.activeSkeletonVersion !== patch.baseVersion) {
          return { kind: "stale_base_version" as const, patch, activeVersion: campaign!.activeSkeletonVersion };
        }
      }
      throw error;
    }
  }
}

/** Read-only validation seam used by the iterative Runtime before its single
 * proposal write. Proposal Service repeats the same checks at the write edge. */
export async function validateStrategistPlanningProposal(input: {
  db: PrismaClient;
  userId: string;
  campaignId: string;
  proposal: unknown;
  now: Date;
}) {
  const proposal = campaignSkeletonPatchProposalSchema.parse(input.proposal);
  const campaign = await loadOwnedCampaign(input.db, input.campaignId, input.userId);
  const activeSkeleton = await findActiveSkeleton(input.db, input.campaignId);
  const existingPending = await input.db.campaignSkeletonPatch.findFirst({
    where: { campaignId: input.campaignId, status: "pending" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return validatePlanningProposal({
    db: input.db,
    campaign,
    now: input.now,
    trigger: proposal.trigger,
    skeleton: {
      activeSkeleton: projectCampaignSkeleton(activeSkeleton),
      proposedPatch: proposal,
      campaignGoal: { dailyQuestionBudget: campaign.goal.dailyQuestionBudget },
      existingPendingPatch: existingPending
        ? { patchId: existingPending.id, baseVersion: existingPending.baseVersion }
        : null,
    },
  });
}
