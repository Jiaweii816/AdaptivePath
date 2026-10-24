import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { dispatchRecordedBackgroundJob, type BackgroundJobDispatchOptions } from "@/server/jobs/background-job-dispatch";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import { getStrategistModel } from "@/server/llm/models";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import { validateAutomaticStrategistProposal, evaluateStrategistWake } from "../core";
import { campaignCurriculumAssets } from "../curriculum";
import {
  STRATEGIST_EVALUATOR_VERSION,
  STRATEGIST_PROMPT_VERSION,
  PRODUCTION_STRATEGIST_RUNTIME_VERSION,
  STRATEGIST_RUNTIME_SCHEMA_VERSION,
  canonicalStrategistJson,
  parseStrategistProviderOutput,
  strategistDigest,
  strategistWakeSnapshotSchema,
  strategistRunModeSchema,
} from "../domain";
import { CampaignSkeletonPatchError, CampaignSkeletonPatchService } from "./skeleton-patch-service";
import { buildStrategistReadModel } from "./strategist-read-model";
import {
  createOpenAiStrategistProvider,
  type StrategistProvider,
  type StrategistProviderResult,
} from "./strategist-provider";
import { ProductionStrategistPlannerProvider } from "./production-strategist-planner-provider";
import {
  STRATEGIST_PLANNER_HARD_MAX,
  executeStrategistPlanExecuteRuntime,
} from "./strategist-scripted-runtime";
import { buildStrategistRuntimeContext } from "./strategist-runtime-context";
import {
  createCalendarFreeBusyTool,
  type CalendarFreeBusyTool,
} from "./calendar-mcp-client";
import type {
  StrategistConstraintExtractor,
  StrategistPlannerProvider,
} from "./scripted-strategist-planner-provider";

const STALE_STRATEGIST_RUN_MS = 10 * 60 * 1000;
const TERMINAL_PROCESSED_STATUSES = ["no_change", "proposed", "invalid"] as const;
export const STRATEGIST_DAILY_RUN_LIMITS = Object.freeze({ automatic: 2, user: 5, simulation: 10 });
type StrategistRunOrigin = keyof typeof STRATEGIST_DAILY_RUN_LIMITS;

function parseRuntimeRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function getCampaignStrategistRuntimeVersion(value: string | null) {
  const version = parseRuntimeRecord(value)?.runtimeVersion;
  return version === PRODUCTION_STRATEGIST_RUNTIME_VERSION ? PRODUCTION_STRATEGIST_RUNTIME_VERSION : "legacy" as const;
}

function productionRuntimeSeed(input: {
  origin: StrategistRunOrigin;
  campaignDate: string;
  runMode?: "proposal" | "simulation";
  requestText?: string | null;
}) {
  return canonicalStrategistJson({
    schemaVersion: STRATEGIST_RUNTIME_SCHEMA_VERSION,
    runtimeVersion: PRODUCTION_STRATEGIST_RUNTIME_VERSION,
    runMode: strategistRunModeSchema.parse(input.runMode),
    origin: input.origin,
    campaignDate: input.campaignDate,
    request: input.requestText ? { text: input.requestText.slice(0, 2_000) } : null,
    status: "queued",
  });
}

async function dailyRunCount(db: PrismaClient, input: { campaignId: string; campaignDate: string; origin: StrategistRunOrigin }) {
  const runs = await db.campaignStrategistRun.findMany({
    where: { campaignId: input.campaignId },
    select: { runtimeStateJson: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return runs.filter((run) => {
    const state = parseRuntimeRecord(run.runtimeStateJson);
    return state?.campaignDate === input.campaignDate && state.origin === input.origin;
  }).length;
}

export async function checkCampaignStrategistDailyQuota(db: PrismaClient, input: { campaignId: string; campaignDate: string; origin: StrategistRunOrigin }) {
  const used = await dailyRunCount(db, input);
  const limit = STRATEGIST_DAILY_RUN_LIMITS[input.origin];
  return { allowed: used < limit, used, limit };
}

function tokenCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

function providerUsage(result: StrategistProviderResult) {
  return {
    inputTokens: tokenCount(result.usage?.prompt_tokens),
    outputTokens: tokenCount(result.usage?.completion_tokens),
    totalTokens: tokenCount(result.usage?.total_tokens),
  };
}

function errorClass(error: unknown) {
  if (error instanceof SyntaxError) return "invalid_json";
  if (error instanceof CampaignSkeletonPatchError) return "m4a_validator_rejected";
  if (error instanceof Error && error.name === "ZodError") return "invalid_output_schema";
  if (error instanceof Error && /timeout/i.test(error.message)) return "provider_timeout";
  return error instanceof Error ? error.name.slice(0, 100) : "unknown_error";
}

async function markInvalid(
  db: PrismaClient,
  runId: string,
  input: { now: Date; code: string; result?: StrategistProviderResult; outputDigest?: string },
) {
  const usage = input.result ? providerUsage(input.result) : { inputTokens: null, outputTokens: null, totalTokens: null };
  return db.campaignStrategistRun.update({
    where: { id: runId },
    data: {
      status: "invalid",
      completedAt: input.now,
      latencyMs: input.result?.latencyMs ?? null,
      ...usage,
      errorClass: input.code,
      outputDigest: input.outputDigest ?? null,
      updatedAt: input.now,
    },
  });
}

export async function executeCampaignStrategistRun(input: {
  db: PrismaClient;
  runId: string;
  provider: StrategistProvider;
  traceContext?: Parameters<StrategistProvider["propose"]>[1];
  now?: () => Date;
}) {
  const clock = input.now ?? (() => new Date());
  const startedAt = clock();
  const claimed = await input.db.campaignStrategistRun.updateMany({
    where: { id: input.runId, status: "queued", startedAt: null },
    data: { status: "running", startedAt, attemptCount: { increment: 1 }, updatedAt: startedAt },
  });
  if (claimed.count !== 1) {
    return { kind: "already_claimed" as const, run: await input.db.campaignStrategistRun.findUniqueOrThrow({ where: { id: input.runId } }) };
  }
  const run = await input.db.campaignStrategistRun.findUniqueOrThrow({
    where: { id: input.runId },
    include: { campaign: true },
  });
  try {
    const projection = await buildStrategistReadModel({
      db: input.db,
      campaignId: run.campaignId,
      campaignDate: strategistWakeSnapshotSchema.parse(JSON.parse(run.wakeSnapshotJson)).campaignDate,
    });
    if (projection.inputDigest !== run.inputDigest) {
      const invalid = await markInvalid(input.db, run.id, { now: clock(), code: "stale_input_digest" });
      return { kind: "invalid" as const, run: invalid };
    }
    const providerResult = await input.provider.propose(projection.readModel, input.traceContext);
    const outputDigest = strategistDigest(providerResult.content);
    let output;
    try {
      output = parseStrategistProviderOutput(providerResult.content);
    } catch (error) {
      const invalid = await markInvalid(input.db, run.id, {
        now: clock(),
        code: errorClass(error),
        result: providerResult,
        outputDigest,
      });
      return { kind: "invalid" as const, run: invalid };
    }
    const usage = providerUsage(providerResult);
    if (output.decision === "no_change") {
      const completedAt = clock();
      const completed = await input.db.campaignStrategistRun.update({
        where: { id: run.id },
        data: {
          status: "no_change",
          rationaleSummary: output.rationale,
          completedAt,
          latencyMs: providerResult.latencyMs,
          ...usage,
          outputDigest,
          updatedAt: completedAt,
        },
      });
      return { kind: "no_change" as const, run: completed };
    }
    const automatic = validateAutomaticStrategistProposal({
      operations: output.operations,
      nodeStates: projection.readModel.learnerNodes.map((node) => ({
        nodeId: node.nodeId,
        started: node.started,
        masteryState: node.masteryState,
      })),
      transferableNodeIds: campaignCurriculumAssets.graph.nodes.filter((node) => node.kind === "transferable").map((node) => node.nodeId),
    });
    if (!automatic.valid) {
      const invalid = await markInvalid(input.db, run.id, {
        now: clock(),
        code: `automatic_policy:${automatic.errors.map((issue) => issue.code).join(",")}`.slice(0, 200),
        result: providerResult,
        outputDigest,
      });
      return { kind: "invalid" as const, run: invalid, errors: automatic.errors };
    }
    let proposal;
    try {
      proposal = await new CampaignSkeletonPatchService(input.db, { now: clock }).createSkeletonPatchProposal({
        userId: run.campaign.userId,
        campaignId: run.campaignId,
        proposal: {
          patchSchemaVersion: 1,
          baseVersion: run.activeSkeletonVersion,
          trigger: `strategist_${run.trigger}`,
          rationale: output.rationale,
          operations: output.operations,
          dailyBudgetSuggestion: output.dailyBudgetSuggestion,
        },
      });
    } catch (error) {
      if (error instanceof CampaignSkeletonPatchError || (error instanceof Error && error.name === "ZodError")) {
        const invalid = await markInvalid(input.db, run.id, {
          now: clock(),
          code: errorClass(error),
          result: providerResult,
          outputDigest,
        });
        return { kind: "invalid" as const, run: invalid };
      }
      throw error;
    }
    const completedAt = clock();
    const completed = await input.db.campaignStrategistRun.update({
      where: { id: run.id },
      data: {
        status: "proposed",
        proposalPatchId: proposal.patch.id,
        rationaleSummary: output.rationale,
        completedAt,
        latencyMs: providerResult.latencyMs,
        ...usage,
        outputDigest,
        updatedAt: completedAt,
      },
    });
    return { kind: "proposed" as const, run: completed, patch: proposal.patch };
  } catch (error) {
    const completedAt = clock();
    await input.db.campaignStrategistRun.updateMany({
      where: { id: run.id, status: "running" },
      data: { status: "failed", completedAt, errorClass: errorClass(error), updatedAt: completedAt },
    });
    throw error;
  }
}

export async function executeVersionedCampaignStrategistRun(input: {
  db: PrismaClient;
  runId: string;
  campaignDate: string;
  traceContext?: Parameters<StrategistProvider["propose"]>[1];
  legacyProvider?: StrategistProvider;
  plannerProvider?: StrategistPlannerProvider;
  constraintExtractor?: StrategistConstraintExtractor;
  now?: () => Date;
  calendarTool?: CalendarFreeBusyTool;
}) {
  const run = await input.db.campaignStrategistRun.findUniqueOrThrow({
    where: { id: input.runId },
    select: { runtimeStateJson: true },
  });
  if (getCampaignStrategistRuntimeVersion(run.runtimeStateJson) === "legacy") {
    return executeCampaignStrategistRun({
      db: input.db,
      runId: input.runId,
      provider: input.legacyProvider ?? createOpenAiStrategistProvider(),
      traceContext: input.traceContext,
      now: input.now,
    });
  }
  const provider = input.plannerProvider ?? new ProductionStrategistPlannerProvider();
  const extractor = input.constraintExtractor
    ?? ("extractConstraints" in provider ? provider as StrategistPlannerProvider & StrategistConstraintExtractor : undefined);
  let calendarTool = input.calendarTool;
  if (!calendarTool) {
    try {
      calendarTool = createCalendarFreeBusyTool();
    } catch {
      calendarTool = undefined;
    }
  }
  return executeStrategistPlanExecuteRuntime({
    db: input.db,
    runId: input.runId,
    provider,
    constraintExtractor: extractor,
    runtimeVersion: PRODUCTION_STRATEGIST_RUNTIME_VERSION,
    now: input.now?.() ?? new Date(),
    campaignDate: input.campaignDate,
    traceContext: input.traceContext,
    calendarTool,
  });
}

export async function reconcileStaleCampaignStrategistRuns(
  db: PrismaClient,
  input: { now: Date; staleAfterMs?: number },
) {
  const cutoff = new Date(input.now.valueOf() - (input.staleAfterMs ?? STALE_STRATEGIST_RUN_MS));
  const running = await db.campaignStrategistRun.updateMany({
    where: { status: "running", startedAt: { lt: cutoff }, completedAt: null },
    data: { status: "failed", completedAt: input.now, errorClass: "stale_worker", updatedAt: input.now },
  });
  const queued = await db.campaignStrategistRun.updateMany({
    where: { status: "queued", createdAt: { lt: cutoff }, completedAt: null },
    data: { status: "failed", completedAt: input.now, errorClass: "stale_dispatch", updatedAt: input.now },
  });
  return { running: running.count, queued: queued.count };
}

export async function maybeEnqueueStrategistWake(input: {
  db: PrismaClient;
  userId: string;
  campaignId: string;
  campaignDate: string;
  now: Date;
  provider?: StrategistProvider;
  providerFactory?: () => StrategistProvider;
  plannerProvider?: StrategistPlannerProvider;
  plannerProviderFactory?: () => StrategistPlannerProvider;
  constraintExtractor?: StrategistConstraintExtractor;
  calendarTool?: CalendarFreeBusyTool;
  dispatchOptions?: BackgroundJobDispatchOptions;
}) {
  const campaign = await input.db.campaign.findFirst({
    where: { id: input.campaignId, userId: input.userId, status: "active" },
    select: { id: true, activeSkeletonVersion: true },
  });
  if (!campaign) return { kind: "campaign_not_found" as const };
  await reconcileStaleCampaignStrategistRuns(input.db, { now: input.now });
  const projection = await buildStrategistReadModel({ db: input.db, campaignId: campaign.id, campaignDate: input.campaignDate });
  const latest = await input.db.campaignStrategistRun.findFirst({
    where: { campaignId: campaign.id, status: { in: [...TERMINAL_PROCESSED_STATUSES] } },
    orderBy: [{ completedAt: "desc" }, { id: "asc" }],
  });
  const latestSnapshot = latest
    ? strategistWakeSnapshotSchema.safeParse(JSON.parse(latest.wakeSnapshotJson)).data ?? null
    : null;
  const evaluation = evaluateStrategistWake({
    campaignId: campaign.id,
    campaignDate: input.campaignDate,
    activeSkeletonVersion: campaign.activeSkeletonVersion,
    pendingPatchExists: projection.readModel.operational.pendingPatchExists,
    current: projection.wakeSnapshot,
    latestCompleted: latestSnapshot,
  });
  if (!evaluation.shouldWake || !evaluation.trigger || !evaluation.triggerFingerprint) {
    return { kind: "skipped" as const, evaluation };
  }

  const existingFingerprint = await input.db.campaignStrategistRun.findUnique({ where: { triggerFingerprint: evaluation.triggerFingerprint } });
  if (existingFingerprint) {
    return { kind: existingFingerprint.status === "queued" ? "already_queued" as const : "already_processed" as const, evaluation, run: existingFingerprint };
  }
  const useLegacy = Boolean(input.provider || input.providerFactory);
  if (!useLegacy) {
    const quota = await checkCampaignStrategistDailyQuota(input.db, { campaignId: campaign.id, campaignDate: input.campaignDate, origin: "automatic" });
    if (!quota.allowed) return { kind: "rate_limited" as const, code: "automatic_daily_quota" as const, quota, evaluation };
  }

  const runId = randomUUID();
  const rootTraceRunId = randomUUID();
  const processInstanceId = input.dispatchOptions?.processInstanceId ?? getProcessInstanceId();
  const configuredPlanner = input.plannerProvider;
  const providerName = useLegacy
    ? input.provider?.name ?? "openai-compatible-strategist"
    : configuredPlanner?.name ?? "openai-compatible-strategist-runtime";
  const modelAlias = useLegacy
    ? input.provider?.modelAlias ?? getStrategistModel()
    : configuredPlanner?.modelAlias ?? getStrategistModel();
  let run: Prisma.CampaignStrategistRunGetPayload<object>;
  try {
    run = await input.db.$transaction(async (tx) => {
      await tx.agentTraceRun.create({
        data: {
          id: rootTraceRunId,
          userId: input.userId,
          path: "campaign_strategist",
          actionKind: "evaluate_wake",
          memoryOrigin: resolveMemoryOrigin(),
          processInstanceId,
          status: "succeeded",
          startedAt: input.now,
          endedAt: input.now,
          durationMs: 0,
          traceCompleteness: "complete",
          finalFlushAt: input.now,
        },
      });
      return tx.campaignStrategistRun.create({
        data: {
          id: runId,
          campaignId: campaign.id,
          activeSkeletonVersion: campaign.activeSkeletonVersion,
          trigger: evaluation.trigger!,
          triggerFingerprint: evaluation.triggerFingerprint!,
          inputDigest: projection.inputDigest,
          wakeSnapshotJson: canonicalStrategistJson(projection.wakeSnapshot),
          promptVersion: STRATEGIST_PROMPT_VERSION,
          evaluatorVersion: STRATEGIST_EVALUATOR_VERSION,
          provider: providerName,
          modelAlias,
          status: "queued",
          runtimeStateJson: useLegacy ? null : productionRuntimeSeed({ origin: "automatic", campaignDate: input.campaignDate }),
          traceRunId: rootTraceRunId,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await input.db.campaignStrategistRun.findUniqueOrThrow({ where: { triggerFingerprint: evaluation.triggerFingerprint } });
      return { kind: existing.status === "queued" ? "already_queued" as const : "already_processed" as const, evaluation, run: existing };
    }
    throw error;
  }

  try {
    const job = await dispatchRecordedBackgroundJob({
      prisma: input.db,
      kind: "campaign_strategist",
      task: "campaign.strategist.propose_patch",
      origin: { originatingTraceRunId: rootTraceRunId },
      metadata: {
        strategistRunId: run.id,
        trigger: evaluation.trigger,
        triggerFingerprintDigest: strategistDigest(evaluation.triggerFingerprint),
        activeSkeletonVersion: campaign.activeSkeletonVersion,
      },
      options: {
        ...input.dispatchOptions,
        processInstanceId,
        dedupeKey: `campaign-strategist:${evaluation.triggerFingerprint}`,
      },
      run: ({ traceContext }) => executeVersionedCampaignStrategistRun({
        db: input.db,
        runId: run.id,
        campaignDate: input.campaignDate,
        legacyProvider: input.provider ?? input.providerFactory?.(),
        plannerProvider: input.plannerProvider ?? input.plannerProviderFactory?.(),
        constraintExtractor: input.constraintExtractor,
        calendarTool: input.calendarTool,
        traceContext,
      }),
    });
    run = await input.db.campaignStrategistRun.update({
      where: { id: run.id },
      data: { backgroundJobId: job.id, updatedAt: input.now },
    });
    return { kind: "queued" as const, evaluation, run };
  } catch (error) {
    await input.db.campaignStrategistRun.updateMany({
      where: { id: run.id, status: "queued" },
      data: { status: "failed", completedAt: input.now, errorClass: "dispatch_failed", updatedAt: input.now },
    });
    throw error;
  }
}

export async function maybeEnqueueStrategistWakeForLearner(input: {
  db: PrismaClient;
  userId: string;
  campaignDate: string;
  now: Date;
  providerFactory?: () => StrategistProvider;
  plannerProviderFactory?: () => StrategistPlannerProvider;
  constraintExtractor?: StrategistConstraintExtractor;
  calendarTool?: CalendarFreeBusyTool;
  dispatchOptions?: BackgroundJobDispatchOptions;
}) {
  const campaigns = await input.db.campaign.findMany({
    where: { userId: input.userId, status: "active" },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 2,
  });
  if (campaigns.length !== 1) return { kind: campaigns.length === 0 ? "no_campaign" as const : "campaign_conflict" as const };
  return maybeEnqueueStrategistWake({ ...input, campaignId: campaigns[0].id });
}

const userProposalRequestSchema = z.object({
  requestText: z.string().trim().min(1).max(2_000),
}).strict();

const RETRYABLE_STRATEGIST_RUN_STATUSES = new Set(["failed", "invalid", "budget_exhausted", "stale"]);

async function resolveProductRunFingerprint(db: PrismaClient, baseFingerprint: string) {
  let triggerFingerprint = baseFingerprint;
  for (let retryIndex = 0; retryIndex < 20; retryIndex += 1) {
    const existing = await db.campaignStrategistRun.findUnique({ where: { triggerFingerprint } });
    if (!existing) return { triggerFingerprint, existing: null };
    if (!RETRYABLE_STRATEGIST_RUN_STATUSES.has(existing.status)) return { triggerFingerprint, existing };
    triggerFingerprint = strategistDigest({
      kind: "strategist_failed_run_retry",
      previousTriggerFingerprint: triggerFingerprint,
    });
  }
  throw new Error("Strategist retry fingerprint chain exceeded its safety bound.");
}

async function requestCampaignStrategistProductRun(input: {
  db: PrismaClient;
  userId: string;
  campaignId: string;
  campaignDate: string;
  requestText: string;
  runMode: "proposal" | "simulation";
  now: Date;
  plannerProvider?: StrategistPlannerProvider;
  plannerProviderFactory?: () => StrategistPlannerProvider;
  constraintExtractor?: StrategistConstraintExtractor;
  calendarTool?: CalendarFreeBusyTool;
  dispatchOptions?: BackgroundJobDispatchOptions;
}) {
  const request = userProposalRequestSchema.parse({ requestText: input.requestText });
  const campaign = await input.db.campaign.findFirst({
    where: { id: input.campaignId, userId: input.userId, status: "active" },
    select: { id: true, activeSkeletonVersion: true },
  });
  if (!campaign) return { kind: "campaign_not_found" as const };
  const projection = await buildStrategistReadModel({ db: input.db, campaignId: campaign.id, campaignDate: input.campaignDate });
  if (input.runMode === "proposal" && projection.readModel.operational.pendingPatchExists) return { kind: "pending_patch" as const };
  const baseTriggerFingerprint = strategistDigest({
    kind: `user_${input.runMode}`,
    campaignId: campaign.id,
    campaignDate: input.campaignDate,
    activeSkeletonVersion: campaign.activeSkeletonVersion,
    requestText: request.requestText,
  });
  const resolvedFingerprint = await resolveProductRunFingerprint(input.db, baseTriggerFingerprint);
  const triggerFingerprint = resolvedFingerprint.triggerFingerprint;
  const existing = resolvedFingerprint.existing;
  if (existing) return { kind: "already_exists" as const, run: existing };
  const quotaOrigin = input.runMode === "simulation" ? "simulation" : "user";
  const quota = await checkCampaignStrategistDailyQuota(input.db, { campaignId: campaign.id, campaignDate: input.campaignDate, origin: quotaOrigin });
  if (!quota.allowed) return { kind: "rate_limited" as const, code: `${quotaOrigin}_daily_quota` as const, quota };

  const runId = randomUUID();
  const rootTraceRunId = randomUUID();
  const processInstanceId = input.dispatchOptions?.processInstanceId ?? getProcessInstanceId();
  const providerName = input.plannerProvider?.name ?? "openai-compatible-strategist-runtime";
  const modelAlias = input.plannerProvider?.modelAlias ?? getStrategistModel();
  let run: Prisma.CampaignStrategistRunGetPayload<object>;
  try {
    run = await input.db.$transaction(async (tx) => {
      await tx.agentTraceRun.create({ data: {
        id: rootTraceRunId,
        userId: input.userId,
        path: "campaign_strategist",
        actionKind: input.runMode === "simulation" ? "user_simulation" : "user_proposal",
        memoryOrigin: resolveMemoryOrigin(),
        processInstanceId,
        status: "succeeded",
        startedAt: input.now,
        endedAt: input.now,
        durationMs: 0,
        traceCompleteness: "complete",
        finalFlushAt: input.now,
      } });
      return tx.campaignStrategistRun.create({ data: {
        id: runId,
        campaignId: campaign.id,
        activeSkeletonVersion: campaign.activeSkeletonVersion,
        trigger: input.runMode === "simulation" ? "user_simulation" : "user_proposal",
        triggerFingerprint,
        inputDigest: projection.inputDigest,
        wakeSnapshotJson: canonicalStrategistJson(projection.wakeSnapshot),
        promptVersion: "strategist-plan-execute-v1",
        evaluatorVersion: STRATEGIST_EVALUATOR_VERSION,
        provider: providerName,
        modelAlias,
        status: "queued",
        runtimeStateJson: productionRuntimeSeed({ origin: quotaOrigin, campaignDate: input.campaignDate, runMode: input.runMode, requestText: request.requestText }),
        traceRunId: rootTraceRunId,
        createdAt: input.now,
        updatedAt: input.now,
      } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { kind: "already_exists" as const, run: await input.db.campaignStrategistRun.findUniqueOrThrow({ where: { triggerFingerprint } }) };
    }
    throw error;
  }

  const job = await dispatchRecordedBackgroundJob({
    prisma: input.db,
    kind: "campaign_strategist",
    task: "campaign.strategist.plan_execute",
    origin: { originatingTraceRunId: rootTraceRunId },
    metadata: { strategistRunId: run.id, runtimeVersion: PRODUCTION_STRATEGIST_RUNTIME_VERSION, origin: quotaOrigin, runMode: input.runMode },
    options: { ...input.dispatchOptions, processInstanceId, dedupeKey: `campaign-strategist:${triggerFingerprint}` },
    run: ({ traceContext }) => executeVersionedCampaignStrategistRun({
      db: input.db,
      runId: run.id,
      campaignDate: input.campaignDate,
      plannerProvider: input.plannerProvider ?? input.plannerProviderFactory?.(),
      constraintExtractor: input.constraintExtractor,
      calendarTool: input.calendarTool,
      traceContext,
    }),
  });
  run = await input.db.campaignStrategistRun.update({ where: { id: run.id }, data: { backgroundJobId: job.id, updatedAt: input.now } });
  return { kind: "queued" as const, run };
}

type StrategistProductRunInput = Omit<Parameters<typeof requestCampaignStrategistProductRun>[0], "runMode">;

export function requestCampaignStrategistProposal(input: StrategistProductRunInput) {
  return requestCampaignStrategistProductRun({ ...input, runMode: "proposal" });
}

export function requestCampaignStrategistSimulation(input: StrategistProductRunInput) {
  return requestCampaignStrategistProductRun({ ...input, runMode: "simulation" });
}

const clarificationAnswerSchema = z.string().trim().min(1).max(1_000);

export async function resumeCampaignStrategistRun(input: {
  db: PrismaClient;
  userId: string;
  runId: string;
  answer: string;
  calendarAuthorization?: Readonly<
    | { decision: "allow"; rangeStart: string; rangeEnd: string }
    | { decision: "deny" }
  >;
  now: Date;
  plannerProvider?: StrategistPlannerProvider;
  plannerProviderFactory?: () => StrategistPlannerProvider;
  constraintExtractor?: StrategistConstraintExtractor;
  calendarTool?: CalendarFreeBusyTool;
  dispatchOptions?: BackgroundJobDispatchOptions;
}) {
  const answer = clarificationAnswerSchema.parse(input.answer);
  const run = await input.db.campaignStrategistRun.findFirst({ where: { id: input.runId, campaign: { userId: input.userId } }, include: { campaign: true } });
  if (!run) return { kind: "run_not_found" as const };
  if (getCampaignStrategistRuntimeVersion(run.runtimeStateJson) !== PRODUCTION_STRATEGIST_RUNTIME_VERSION) return { kind: "legacy_run" as const };
  if (run.status !== "needs_clarification") return { kind: "not_awaiting_clarification" as const };
  const state = parseRuntimeRecord(run.runtimeStateJson);
  if (!state || state.runMode !== "proposal" && state.runMode !== "simulation") return { kind: "invalid_runtime_state" as const };
  const campaignDate = typeof state.campaignDate === "string"
    ? state.campaignDate
    : strategistWakeSnapshotSchema.parse(JSON.parse(run.wakeSnapshotJson)).campaignDate;
  if (run.campaign.status !== "active" || run.campaign.activeSkeletonVersion !== run.activeSkeletonVersion) {
    await input.db.campaignStrategistRun.updateMany({ where: { id: run.id, status: "needs_clarification" }, data: { status: "stale", completedAt: input.now, errorClass: "stale_skeleton", updatedAt: input.now } });
    return { kind: "stale" as const };
  }
  const [pending, assembled] = await Promise.all([
    input.db.campaignSkeletonPatch.count({ where: { campaignId: run.campaignId, status: "pending" } }),
    buildStrategistRuntimeContext({ db: input.db, campaignId: run.campaignId, campaignDate }),
  ]);
  if (pending > 0) {
    await input.db.campaignStrategistRun.updateMany({ where: { id: run.id, status: "needs_clarification" }, data: { status: "no_change", completedAt: input.now, errorClass: "pending_patch_exists", updatedAt: input.now } });
    return { kind: "pending_patch" as const };
  }
  if (assembled.inputDigest !== run.inputDigest || state.contextDigest !== assembled.context.contextDigest) {
    await input.db.campaignStrategistRun.updateMany({ where: { id: run.id, status: "needs_clarification" }, data: { status: "stale", completedAt: input.now, errorClass: "stale_context", updatedAt: input.now } });
    return { kind: "stale" as const };
  }
  const budgets = state.budgetSnapshot as Record<string, { used: number; limit: number }>;
  if (!budgets?.plannerDecisions) return { kind: "invalid_runtime_state" as const };
  let resolvedConstraints = state.resolvedConstraints as Record<string, unknown> | undefined;
  if (input.calendarAuthorization) {
    const clarification = state.clarification as { question?: unknown; knownFacts?: unknown; tradeoff?: unknown } | null | undefined;
    const clarificationText = [
      clarification?.question,
      clarification?.tradeoff,
      ...(Array.isArray(clarification?.knownFacts) ? clarification.knownFacts : []),
    ].filter((value): value is string => typeof value === "string").join(" ");
    if (!/calendar|日历/i.test(clarificationText) || !resolvedConstraints) return { kind: "calendar_authorization_not_requested" as const };
    const permissions = resolvedConstraints.permissions && typeof resolvedConstraints.permissions === "object" && !Array.isArray(resolvedConstraints.permissions)
      ? resolvedConstraints.permissions as Record<string, unknown>
      : {};
    if (input.calendarAuthorization.decision === "allow") {
      const rangeStart = Date.parse(input.calendarAuthorization.rangeStart);
      const rangeEnd = Date.parse(input.calendarAuthorization.rangeEnd);
      if (rangeEnd <= rangeStart || rangeEnd - rangeStart > 7 * 86_400_000) return { kind: "invalid_calendar_authorization_range" as const };
      const requestedDates = clarificationText.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
      if (requestedDates.length < 2
        || input.calendarAuthorization.rangeStart.slice(0, 10) !== requestedDates[0]
        || input.calendarAuthorization.rangeEnd.slice(0, 10) !== requestedDates[1]) {
        return { kind: "invalid_calendar_authorization_range" as const };
      }
      resolvedConstraints = {
        ...resolvedConstraints,
        permissions: {
          ...permissions,
          calendarOptionalLookup: true,
          calendarAuthorizedRange: { start: input.calendarAuthorization.rangeStart, end: input.calendarAuthorization.rangeEnd },
        },
      };
    } else {
      resolvedConstraints = {
        ...resolvedConstraints,
        permissions: { ...permissions, calendarOptionalLookup: false, calendarAuthorizedRange: null },
      };
    }
  }
  const resumedState = {
    ...state,
    status: "queued",
    ...(resolvedConstraints ? { resolvedConstraints } : {}),
    clarificationResponse: { answer, answeredAt: input.now.toISOString() },
    budgetSnapshot: {
      ...budgets,
      plannerDecisions: {
        ...budgets.plannerDecisions,
        limit: Math.min(STRATEGIST_PLANNER_HARD_MAX, budgets.plannerDecisions.limit + 2),
      },
    },
  };
  const claimed = await input.db.campaignStrategistRun.updateMany({
    where: { id: run.id, status: "needs_clarification" },
    data: {
      status: "queued",
      startedAt: null,
      completedAt: null,
      backgroundJobId: null,
      errorClass: null,
      runtimeStateJson: canonicalStrategistJson(resumedState),
      updatedAt: input.now,
    },
  });
  if (claimed.count !== 1) return { kind: "already_resumed" as const };
  const processInstanceId = input.dispatchOptions?.processInstanceId ?? getProcessInstanceId();
  try {
    const job = await dispatchRecordedBackgroundJob({
      prisma: input.db,
      kind: "campaign_strategist",
      task: "campaign.strategist.resume",
      origin: { originatingTraceRunId: run.traceRunId ?? randomUUID() },
      metadata: { strategistRunId: run.id, runtimeVersion: PRODUCTION_STRATEGIST_RUNTIME_VERSION, resumed: true },
      options: { ...input.dispatchOptions, processInstanceId, dedupeKey: `campaign-strategist-resume:${run.id}` },
      run: ({ traceContext }) => executeVersionedCampaignStrategistRun({
        db: input.db,
        runId: run.id,
        campaignDate,
        plannerProvider: input.plannerProvider ?? input.plannerProviderFactory?.(),
        constraintExtractor: input.constraintExtractor,
        calendarTool: input.calendarTool,
        traceContext,
      }),
    });
    const updated = await input.db.campaignStrategistRun.update({ where: { id: run.id }, data: { backgroundJobId: job.id, updatedAt: input.now } });
    return { kind: "queued" as const, run: updated };
  } catch (error) {
    await input.db.campaignStrategistRun.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "failed", completedAt: input.now, errorClass: "resume_dispatch_failed", updatedAt: input.now } });
    throw error;
  }
}
