import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  buildCampaignPatchReviewView,
  type CampaignPatchReviewView,
  type CampaignPlanningReviewView,
} from "../presentation";
import { projectCampaignSkeleton } from "./campaign-core-service";
import {
  CampaignSkeletonPatchError,
  CampaignSkeletonPatchService,
} from "./skeleton-patch-service";

const rejectionReasonSchema = z.string().trim().min(1).max(500);

export type CampaignPatchReviewErrorCode =
  | "patch_not_found"
  | "ownership_denied"
  | "already_decided"
  | "stale_base_version"
  | "invalid_partial_selection"
  | "validation_failed"
  | "stale_external_data"
  | "decision_conflict";

export class CampaignPatchReviewError extends Error {
  constructor(
    readonly code: CampaignPatchReviewErrorCode,
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "CampaignPatchReviewError";
  }
}

async function loadSkeletonVersion(db: PrismaClient, campaignId: string, version: number) {
  return db.campaignSkeleton.findUniqueOrThrow({
    where: { campaignId_version: { campaignId, version } },
    include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
  });
}

async function assertPatchOwnership(db: PrismaClient, userId: string, patchId: string) {
  const patch = await db.campaignSkeletonPatch.findUnique({
    where: { id: patchId },
    include: {
      campaign: { include: { goal: true } },
      decision: true,
    },
  });
  if (!patch) {
    throw new CampaignPatchReviewError("patch_not_found", "找不到这项路线建议。", 404);
  }
  if (patch.campaign.userId !== userId || patch.campaign.status !== "active" || !patch.campaign.goal) {
    throw new CampaignPatchReviewError("ownership_denied", "你无权操作这项路线建议。", 403);
  }
  return patch;
}

async function presentPatch(
  db: PrismaClient,
  patch: Awaited<ReturnType<typeof assertPatchOwnership>>,
): Promise<CampaignPatchReviewView> {
  const [baseSkeleton, strategistRun] = await Promise.all([
    loadSkeletonVersion(db, patch.campaignId, patch.baseVersion),
    db.campaignStrategistRun.findFirst({
      where: { proposalPatchId: patch.id },
      select: { runtimeStateJson: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);
  let runtimeState: Record<string, unknown> = {};
  try {
    const parsed: unknown = strategistRun?.runtimeStateJson ? JSON.parse(strategistRun.runtimeStateJson) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) runtimeState = parsed as Record<string, unknown>;
  } catch {
    runtimeState = {};
  }
  const rejectedCandidateReasons = Array.isArray(runtimeState.rejectedCandidates)
    ? runtimeState.rejectedCandidates.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const codes = (entry as { codes?: unknown }).codes;
        return Array.isArray(codes) ? codes.filter((code): code is string => typeof code === "string") : [];
      })
    : [];
  return buildCampaignPatchReviewView({
    patch,
    baseSkeleton: projectCampaignSkeleton(baseSkeleton),
    activeVersion: patch.campaign.activeSkeletonVersion,
    currentDailyBudget: patch.campaign.goal!.dailyQuestionBudget,
    externalDataAsOf: typeof runtimeState.externalDataAsOf === "string" ? runtimeState.externalDataAsOf : null,
    externalDataValidUntil: typeof runtimeState.externalDataValidUntil === "string" ? runtimeState.externalDataValidUntil : null,
    rejectedCandidateReasons: [...new Set(rejectedCandidateReasons)].slice(0, 10),
  });
}

export async function loadCampaignPatchReviewView(input: {
  db: PrismaClient;
  userId: string;
  patchId: string;
}) {
  return presentPatch(input.db, await assertPatchOwnership(input.db, input.userId, input.patchId));
}

export async function loadCampaignPlanningReviewView(input: {
  db: PrismaClient;
  userId: string;
  campaignId: string;
}): Promise<CampaignPlanningReviewView> {
  const campaign = await input.db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { userId: true, status: true },
  });
  if (!campaign || campaign.userId !== input.userId || campaign.status !== "active") {
    throw new CampaignPatchReviewError("ownership_denied", "你无权读取这项路线建议。", 403);
  }
  const pending = await input.db.campaignSkeletonPatch.findFirst({
    where: { campaignId: input.campaignId, status: "pending" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (pending) {
    return {
      status: "pending_review",
      pendingPatch: await loadCampaignPatchReviewView({
        db: input.db,
        userId: input.userId,
        patchId: pending.id,
      }),
    };
  }
  const latestRun = await input.db.campaignStrategistRun.findFirst({
    where: { campaignId: input.campaignId },
    select: { status: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (latestRun?.status === "queued" || latestRun?.status === "running") {
    return { status: "checking", pendingPatch: null };
  }
  if (latestRun?.status === "invalid" || latestRun?.status === "failed") {
    return { status: "unavailable", pendingPatch: null };
  }
  return { status: "idle", pendingPatch: null };
}

type PatchDecisionInput =
  | Readonly<{
      action: "accept_all";
      acceptDailyBudgetSuggestion: boolean;
    }>
  | Readonly<{
      action: "partial_accept";
      acceptedOperationIds: readonly string[];
      acceptDailyBudgetSuggestion: boolean;
    }>
  | Readonly<{
      action: "reject";
      rejectionReason?: string;
    }>;

function mapPatchServiceError(error: unknown): never {
  if (error instanceof CampaignPatchReviewError) throw error;
  if (error instanceof CampaignSkeletonPatchError) {
    if (error.code === "patch_not_found") {
      throw new CampaignPatchReviewError("patch_not_found", "找不到这项路线建议。", 404);
    }
    if (error.code === "invalid_partial_selection") {
      throw new CampaignPatchReviewError(
        "invalid_partial_selection",
        "请选择至少一项、但不是全部的改动；全部接受请使用“接受全部”。",
      );
    }
    if (error.code === "invalid_patch") {
      const issues = (error.details as { errors?: readonly { code?: string }[] } | undefined)?.errors ?? [];
      const requiredBroken = issues.some((issue) =>
        issue.code === "required_order_violation" || issue.code === "required_prerequisite_excluded"
      );
      throw new CampaignPatchReviewError(
        "validation_failed",
        requiredBroken
          ? "所选改动会破坏必修前置关系，请同时选择相关调整或保留当前路线。"
          : "所选改动无法形成合法路线，请调整选择后重试。",
      );
    }
  }
  throw new CampaignPatchReviewError("decision_conflict", "路线建议状态已变化，请刷新后查看最新结果。");
}

export async function decideCampaignPatch(input: {
  db: PrismaClient;
  userId: string;
  patchId: string;
  decision: PatchDecisionInput;
}) {
  const patch = await assertPatchOwnership(input.db, input.userId, input.patchId);
  if (patch.status !== "pending") {
    return { kind: "already_decided" as const, message: "这项路线建议已经处理。" };
  }
  const acceptsBudget = input.decision.action !== "reject" && input.decision.acceptDailyBudgetSuggestion;
  if (acceptsBudget) {
    const presented = await presentPatch(input.db, patch);
    if (presented.externalDataStale || presented.dateBudgetSuggestions?.some((suggestion) => suggestion.stale)) {
      throw new CampaignPatchReviewError(
        "stale_external_data",
        "Calendar 依据已经过期。请重新运行 Strategist，或仅接受不依赖 Calendar 的路线改动。",
      );
    }
  }
  const service = new CampaignSkeletonPatchService(input.db);
  try {
    const result = input.decision.action === "accept_all"
      ? await service.acceptSkeletonPatch({
          userId: input.userId,
          patchId: input.patchId,
          actorType: "user",
          acceptDailyBudgetSuggestion: input.decision.acceptDailyBudgetSuggestion,
        })
      : input.decision.action === "partial_accept"
        ? await service.partiallyAcceptSkeletonPatch({
            userId: input.userId,
            patchId: input.patchId,
            acceptedOperationIds: input.decision.acceptedOperationIds,
            actorType: "user",
            acceptDailyBudgetSuggestion: input.decision.acceptDailyBudgetSuggestion,
          })
        : await service.rejectSkeletonPatch({
            userId: input.userId,
            patchId: input.patchId,
            actorType: "user",
            rationale: input.decision.rejectionReason
              ? rejectionReasonSchema.parse(input.decision.rejectionReason)
              : undefined,
          });
    if (result.kind === "stale_base_version") {
      throw new CampaignPatchReviewError(
        "stale_base_version",
        "这项建议基于较早的路线版本，无法直接应用。",
      );
    }
    if (result.kind === "already_decided") {
      return { kind: "already_decided" as const, message: "这项路线建议已经处理。" };
    }
    return input.decision.action === "reject"
      ? { kind: "rejected" as const, message: "已保留当前路线。" }
      : {
          kind: "applied" as const,
          message: "后续学习路线已更新，今日任务保持不变。",
          newVersion: "newVersion" in result ? result.newVersion : undefined,
        };
  } catch (error) {
    mapPatchServiceError(error);
  }
}
