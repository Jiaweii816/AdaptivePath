import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  campaignCurriculumAssets,
  validateCurriculumAssets,
} from "../curriculum";
import {
  deriveInitialSkeletonFromGoal,
  validateCreateCampaignInput,
  type CreateCampaignInput,
} from "../domain";
import {
  ActiveCampaignExistsError,
  CampaignCoreService,
  type CampaignClock,
} from "./campaign-core-service";
import { resolveActiveCampaignForLearner } from "./campaign-experience-service";

export type CampaignCreationSummary = Readonly<{
  campaignId: string;
  activeSkeletonVersion: number;
  endDate: string;
  dailyQuestionBudget: number;
  language: "Python";
  timezone: string;
}>;

export type CampaignCreationResult =
  | Readonly<{ kind: "created"; campaign: CampaignCreationSummary }>
  | Readonly<{ kind: "already_active"; campaign: CampaignCreationSummary }>;

export class CampaignOnboardingError extends Error {
  constructor(
    readonly code: "validation_error" | "creation_conflict" | "creation_failed",
    message: string,
    readonly fieldErrors: Readonly<Record<string, readonly string[]>> = {},
    readonly status = code === "validation_error" ? 400 : code === "creation_conflict" ? 409 : 500,
  ) {
    super(message);
    this.name = "CampaignOnboardingError";
  }
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function summarize(campaign: {
  id: string;
  activeSkeletonVersion: number;
  goal: {
    endDate: Date;
    dailyQuestionBudget: number;
    language: string;
    timezone: string;
  } | null;
}): CampaignCreationSummary {
  if (!campaign.goal || campaign.goal.language !== "Python") {
    throw new CampaignOnboardingError("creation_failed", "Campaign was created without a valid Goal.");
  }
  return {
    campaignId: campaign.id,
    activeSkeletonVersion: campaign.activeSkeletonVersion,
    endDate: dateOnly(campaign.goal.endDate),
    dailyQuestionBudget: campaign.goal.dailyQuestionBudget,
    language: "Python",
    timezone: campaign.goal.timezone,
  };
}

function creationKey(userId: string, token: string): string {
  return createHash("sha256").update(`${userId}\u0000${token}`).digest("hex");
}

async function findCampaignSummary(db: PrismaClient, campaignId: string) {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { goal: true },
  });
  return campaign ? summarize(campaign) : null;
}

export async function createInitialCampaignFromOnboarding(input: {
  db: PrismaClient;
  userId: string;
  campaignDate: string;
  value: unknown;
  clock?: CampaignClock;
}): Promise<CampaignCreationResult> {
  const parsed = validateCreateCampaignInput(input.value, input.campaignDate);
  if (!parsed.success) {
    throw new CampaignOnboardingError(
      "validation_error",
      "Campaign details need correction.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const goal: CreateCampaignInput = parsed.data;
  const token = goal.idempotencyToken ?? randomUUID();
  const requestCreationKey = creationKey(input.userId, token);

  const existingRequest = await input.db.campaign.findUnique({
    where: { creationKey: requestCreationKey },
    include: { goal: true },
  });
  if (existingRequest) return { kind: "already_active", campaign: summarize(existingRequest) };

  const active = await resolveActiveCampaignForLearner(input.db, input.userId);
  if (active.kind === "conflict") {
    throw new CampaignOnboardingError(
      "creation_conflict",
      "Multiple active Campaigns already exist; creation was not attempted.",
    );
  }
  if (active.kind === "active") {
    return { kind: "already_active", campaign: summarize(active.campaign) };
  }

  const personalized = deriveInitialSkeletonFromGoal({
    weakNodeIds: goal.selfReportedWeakNodes,
    preferredNodeIds: goal.preferredNodes,
  });
  const validation = validateCurriculumAssets({
    graph: campaignCurriculumAssets.graph,
    skeleton: personalized.skeleton,
  });
  if (!validation.valid) {
    throw new CampaignOnboardingError("creation_failed", "Initial Campaign route is invalid.");
  }

  try {
    const campaign = await new CampaignCoreService(input.db, input.clock).materializeInitialCampaign({
      userId: input.userId,
      goal: {
        endDate: goal.endDate,
        dailyQuestionBudget: goal.dailyQuestionBudget,
        language: goal.language,
        timezone: goal.timezone,
        selfReportedWeakNodes: goal.selfReportedWeakNodes,
        preferredNodes: goal.preferredNodes,
      },
      initialSkeleton: personalized.skeleton,
      creationIdentity: {
        activeOwnerKey: input.userId,
        creationKey: requestCreationKey,
      },
    });
    return { kind: "created", campaign: summarize(campaign) };
  } catch (error) {
    if (error instanceof ActiveCampaignExistsError) {
      const campaign = await findCampaignSummary(input.db, error.campaignId);
      if (campaign) return { kind: "already_active", campaign };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const [sameRequest, activeAfterRace] = await Promise.all([
        input.db.campaign.findUnique({ where: { creationKey: requestCreationKey }, include: { goal: true } }),
        resolveActiveCampaignForLearner(input.db, input.userId),
      ]);
      if (sameRequest) return { kind: "already_active", campaign: summarize(sameRequest) };
      if (activeAfterRace.kind === "active") {
        return { kind: "already_active", campaign: summarize(activeAfterRace.campaign) };
      }
      throw new CampaignOnboardingError("creation_conflict", "Campaign creation conflicted with another request.");
    }
    if (error instanceof CampaignOnboardingError) throw error;
    throw new CampaignOnboardingError("creation_failed", "Campaign could not be created.");
  }
}
