import type { PrismaClient } from "@prisma/client";
import type { MemoryUpdateCandidate } from "@/types/coach";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  evaluateDurableEligibility,
  mergeDurableEvidenceClusters,
  readDurableFactIntegrity,
  writeDurableFactIntegrity,
  type DurableEligibilityDecision,
  type DurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import {
  ACTIVE_STRATEGY_CAP,
  ARBITRATION_DELTAS,
  CONTRADICTED_REBUILD_BASE,
  EMPTY_STRATEGY_VALIDATION,
  NEW_FACT_BASE_CONFIDENCE,
  PREFERENCE_SET_CONFIDENCE,
  STRATEGY_CANDIDATE_CONFIDENCE,
  decideStrategyTransition,
  factCandidateSchema,
  normalizeMemoryTag,
  parseStrategyValidation,
  type FactCandidate,
  type StrategyProposal,
  type StrategyValidation,
} from "@/server/memory/memory.types";
import { resolveMemoryWritePolicy } from "@/server/memory/memory-origin";

type FactStorePrisma = Pick<
  PrismaClient,
  | "l2MemoryFact"
  | "l1MemoryEvent"
  | "runEvidence"
  | "mockInterviewRunEvidence"
  | "practiceRunLog"
  | "chatMessage"
  | "problem"
>;
type ExistingFact = NonNullable<
  Awaited<ReturnType<PrismaClient["l2MemoryFact"]["findUnique"]>>
>;

export type FactSource =
  | "review_diagnosis"
  | "historical_replay"
  | "chat_consolidation"
  | "user_explicit"
  | "reflection"
  | "mock_interview_feedback";

export type ArbitrateFactCandidatesArgs = {
  userId: string;
  problemId?: string;
  reviewAttemptId?: string;
  source: FactSource;
  candidates: unknown[];
  now?: Date;
};

export type RejectedCandidate = { candidate: unknown; reason: string };

export async function arbitrateFactCandidates(
  prisma: FactStorePrisma,
  args: ArbitrateFactCandidatesArgs,
) {
  const now = args.now ?? new Date();
  const updated: ExistingFact[] = [];
  const rejected: RejectedCandidate[] = [];
  const writePolicy = resolveMemoryWritePolicy();

  if (!writePolicy.durableWrites) {
    for (const candidate of args.candidates) {
      rejected.push(
        await reject(
          prisma,
          args,
          candidate,
          `ineligible_process_origin:${writePolicy.origin}`,
        ),
      );
    }
    return { updated, rejected };
  }

  for (const raw of args.candidates) {
    const parsed = factCandidateSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push(
        await reject(
          prisma,
          args,
          raw,
          `schema: ${parsed.error.issues[0]?.message ?? "invalid candidate"}`,
        ),
      );
      continue;
    }

    const candidate = {
      ...parsed.data,
      tag: normalizeMemoryTag(parsed.data.tag),
    };
    const eligibility = await evaluateDurableEligibility(prisma, {
      userId: args.userId,
      source: args.source,
      candidate,
    });
    if (!eligibility.eligible) {
      rejected.push(await reject(prisma, args, candidate, eligibility.reason));
      continue;
    }
    const governedCandidate = {
      ...candidate,
      tag: eligibility.mechanism,
    };

    const existing = await prisma.l2MemoryFact.findUnique({
      where: {
        userId_factType_tag_memoryOrigin: {
          userId: args.userId,
          factType: governedCandidate.factType,
          tag: governedCandidate.tag,
          memoryOrigin: "learner",
        },
      },
    });

    try {
      updated.push(
        await applyOpcode(prisma, {
          args,
          candidate: governedCandidate,
          existing,
          now,
          eligibility,
          hasStrongEvidence: eligibility.evidence.some(isPassedRunEvidence),
        }),
      );
    } catch (error) {
      rejected.push(await reject(prisma, args, candidate, errorMessage(error)));
    }
  }

  return { updated, rejected };
}

async function applyOpcode(
  prisma: FactStorePrisma,
  ctx: {
    args: ArbitrateFactCandidatesArgs;
    candidate: FactCandidate;
    existing: ExistingFact | null;
    eligibility: Extract<DurableEligibilityDecision, { eligible: true }>;
    hasStrongEvidence: boolean;
    now: Date;
  },
): Promise<ExistingFact> {
  const { args, candidate, existing, eligibility, now } = ctx;
  const existingIntegrity = existing
    ? readDurableFactIntegrity(existing.validationJson)
    : undefined;
  const governedExisting =
    existing?.memoryOrigin === "learner" ? existingIntegrity : undefined;
  const priorClusters = collapseReinforceClustersBySourceProblem(
    candidate.factType,
    candidate.evidenceKind,
    governedExisting?.evidenceClusters ?? [],
  );
  const mergedClusters = collapseReinforceClustersBySourceProblem(
    candidate.factType,
    candidate.evidenceKind,
    mergeDurableEvidenceClusters(
      priorClusters,
      eligibility.evidenceClusters,
    ),
  );
  const newClusterCount = mergedClusters.length - priorClusters.length;

  if (existing && governedExisting && newClusterCount === 0) {
    throw new Error("duplicate_evidence_cluster");
  }
  if (
    existing &&
    !governedExisting &&
    candidate.evidenceKind !== "reinforce" &&
    candidate.evidenceKind !== "preference_set"
  ) {
    throw new Error("existing_fact_not_trusted_reinforce_to_rebuild");
  }

  const promotionStatus =
    candidate.factType === "strategy"
      ? governedExisting && existing?.status === "validated"
        ? "trusted"
        : "pending"
      : hasSufficientPromotionEvidence(
            candidate.factType,
            mergedClusters,
            eligibility.requiredClusterCount,
          )
        ? "trusted"
        : "pending";
  const integrity: DurableFactIntegrity = {
    version: 1,
    origin: "learner",
    subject: eligibility.subject,
    mechanism: eligibility.mechanism,
    humanLabel: eligibility.humanLabel,
    portability: "portable",
    promotionStatus,
    evidenceClusters: mergedClusters,
  };
  const trustedEvidenceTraceIds = mergedClusters.flatMap(
    (cluster) => cluster.evidenceTraceIds,
  );

  switch (candidate.evidenceKind) {
    case "reinforce": {
      const status =
        candidate.factType === "strategy"
          ? governedExisting
            ? (existing?.status ?? "candidate")
            : "candidate"
          : promotionStatus === "pending"
            ? "candidate"
            : "active";
      const baseConfidence =
        candidate.factType === "strategy"
          ? STRATEGY_CANDIDATE_CONFIDENCE
          : NEW_FACT_BASE_CONFIDENCE;

      if (!existing) {
        return prisma.l2MemoryFact.create({
          data: {
            userId: args.userId,
            problemId: args.problemId,
            sourceReviewAttemptId: args.reviewAttemptId,
            factType: candidate.factType,
            tag: candidate.tag,
            label: eligibility.humanLabel,
            value: candidate.value,
            confidence: baseConfidence,
            evidenceCount: mergedClusters.length,
            status,
            source: args.source,
            memoryOrigin: "learner",
            evidenceTraceIds: JSON.stringify(trustedEvidenceTraceIds),
            validationJson: writeDurableFactIntegrity(
              candidate.factType === "strategy"
                ? JSON.stringify(EMPTY_STRATEGY_VALIDATION)
                : undefined,
              integrity,
            ),
            lastEvidenceSummary: candidate.observedBehavior,
            lastSeenAt: now,
          },
        });
      }

      const fromContradicted = existing.status === "contradicted";
      const rebuildingUngovernedLearnerRow = !governedExisting;
      return prisma.l2MemoryFact.update({
        where: { id: existing.id },
        data: {
          status,
          confidence: rebuildingUngovernedLearnerRow
            ? baseConfidence
            : fromContradicted
              ? CONTRADICTED_REBUILD_BASE
              : clamp(
                  existing.confidence +
                    ARBITRATION_DELTAS.reinforce * newClusterCount,
                ),
          evidenceCount: mergedClusters.length,
          label: eligibility.humanLabel,
          value: candidate.value,
          source: args.source,
          memoryOrigin: "learner",
          evidenceTraceIds: JSON.stringify(trustedEvidenceTraceIds),
          validationJson: writeDurableFactIntegrity(
            rebuildingUngovernedLearnerRow
              ? undefined
              : existing.validationJson,
            integrity,
          ),
          contradictionSummary: null,
          lastEvidenceSummary: candidate.observedBehavior,
          lastSeenAt: now,
        },
      });
    }
    case "weaken": {
      if (!existing) {
        throw new Error("weaken: no existing fact for this tag");
      }

      const consecutiveWeaken =
        existing.lastEvidenceSummary?.startsWith("[weaken]") ?? false;
      const flipsToImproving =
        consecutiveWeaken &&
        existing.status === "active" &&
        (existing.factType === "weakness" || existing.factType === "mistake");

      return prisma.l2MemoryFact.update({
        where: { id: existing.id },
        data: {
          confidence: clamp(existing.confidence - ARBITRATION_DELTAS.weaken),
          status: flipsToImproving ? "improving" : existing.status,
          evidenceCount: mergedClusters.length,
          memoryOrigin: "learner",
          evidenceTraceIds: JSON.stringify(trustedEvidenceTraceIds),
          validationJson: writeDurableFactIntegrity(
            existing.validationJson,
            integrity,
          ),
          lastEvidenceSummary: nextEvidenceSummary(candidate, {
            prefix: "[weaken] ",
          }),
          lastSeenAt: now,
        },
      });
    }
    case "resolve": {
      if (!existing) {
        throw new Error("resolve: no existing fact for this tag");
      }
      if (!ctx.hasStrongEvidence) {
        throw new Error(
          "resolve: requires strong evidence (passed run_evidence trace)",
        );
      }

      const singleStep = existing.factType === "unresolved_confusion";
      const nextStatus =
        singleStep || existing.status === "improving"
          ? "resolved"
          : "improving";

      return prisma.l2MemoryFact.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          evidenceCount: mergedClusters.length,
          memoryOrigin: "learner",
          evidenceTraceIds: JSON.stringify(trustedEvidenceTraceIds),
          validationJson: writeDurableFactIntegrity(
            existing.validationJson,
            integrity,
          ),
          lastEvidenceSummary: nextEvidenceSummary(candidate),
          lastSeenAt: now,
        },
      });
    }
    case "contradict": {
      if (!existing) {
        throw new Error("contradict: no existing fact for this tag");
      }

      return prisma.l2MemoryFact.update({
        where: { id: existing.id },
        data: {
          status: "contradicted",
          confidence: clamp(existing.confidence / 2),
          contradictionSummary: candidate.value,
          evidenceCount: mergedClusters.length,
          memoryOrigin: "learner",
          evidenceTraceIds: JSON.stringify(trustedEvidenceTraceIds),
          validationJson: writeDurableFactIntegrity(existing.validationJson, {
            ...integrity,
            promotionStatus: "pending",
          }),
          lastEvidenceSummary: candidate.observedBehavior,
          lastSeenAt: now,
        },
      });
    }
    case "preference_set": {
      if (candidate.factType !== "preference") {
        throw new Error("preference_set: only allowed for factType=preference");
      }

      return prisma.l2MemoryFact.upsert({
        where: {
          userId_factType_tag_memoryOrigin: {
            userId: args.userId,
            factType: candidate.factType,
            tag: candidate.tag,
            memoryOrigin: "learner",
          },
        },
        create: {
          userId: args.userId,
          factType: candidate.factType,
          tag: candidate.tag,
          label: candidate.value,
          value: candidate.value,
          confidence: PREFERENCE_SET_CONFIDENCE,
          evidenceCount: mergedClusters.length,
          status: "active",
          source: args.source,
          memoryOrigin: "learner",
          evidenceTraceIds: JSON.stringify(trustedEvidenceTraceIds),
          validationJson: writeDurableFactIntegrity(undefined, {
            ...integrity,
            promotionStatus: "trusted",
          }),
          lastEvidenceSummary: candidate.observedBehavior,
          lastSeenAt: now,
        },
        update: {
          value: candidate.value,
          confidence: PREFERENCE_SET_CONFIDENCE,
          evidenceCount: mergedClusters.length,
          status: "active",
          source: args.source,
          memoryOrigin: "learner",
          evidenceTraceIds: JSON.stringify(trustedEvidenceTraceIds),
          validationJson: writeDurableFactIntegrity(
            governedExisting ? existing?.validationJson : undefined,
            { ...integrity, promotionStatus: "trusted" },
          ),
          lastEvidenceSummary: candidate.observedBehavior,
          lastSeenAt: now,
        },
      });
    }
  }
}

function collapseReinforceClustersBySourceProblem(
  factType: string,
  evidenceKind: FactCandidate["evidenceKind"],
  clusters: DurableFactIntegrity["evidenceClusters"],
) {
  if (
    evidenceKind !== "reinforce" ||
    !["mistake", "weakness", "strength", "skill"].includes(factType)
  ) {
    return clusters;
  }

  const byProblem = new Map<string, (typeof clusters)[number]>();
  for (const cluster of clusters) {
    const key = cluster.problemId ?? `missing:${cluster.key}`;
    const existing = byProblem.get(key);
    byProblem.set(
      key,
      existing
        ? {
            ...existing,
            evidenceTraceIds: [
              ...new Set([
                ...existing.evidenceTraceIds,
                ...cluster.evidenceTraceIds,
              ]),
            ],
          }
        : cluster,
    );
  }
  return [...byProblem.values()];
}

function hasSufficientPromotionEvidence(
  factType: string,
  clusters: DurableFactIntegrity["evidenceClusters"],
  requiredClusterCount: number,
) {
  if (clusters.length < requiredClusterCount) return false;

  if (
    factType === "mistake" ||
    factType === "weakness" ||
    factType === "strength" ||
    factType === "skill"
  ) {
    // A different hash in the same chat is not proof of a recurring learner
    // mechanism: comments, formatting, or arbitrary edits can change it. Keep
    // same-problem recurrence pending; only cross-problem recurrence earns a
    // Coach-consumable long-term weakness/mistake.
    return (
      new Set(
        clusters.flatMap((cluster) =>
          cluster.problemId ? [cluster.problemId] : [],
        ),
      ).size >= 2
    );
  }

  return true;
}

function nextEvidenceSummary(
  candidate: FactCandidate,
  opts: { prefix?: string } = {},
) {
  return `${opts.prefix ?? ""}${candidate.observedBehavior}`;
}

function isPassedRunEvidence(event: { eventType: string; eventJson: string }) {
  if (
    event.eventType !== "run_evidence" &&
    event.eventType !== "mock_interview_run_evidence"
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(event.eventJson) as { status?: string };
    return payload.status === "passed_visible_tests";
  } catch {
    return false;
  }
}

async function reject(
  prisma: FactStorePrisma,
  args: ArbitrateFactCandidatesArgs,
  candidate: unknown,
  reason: string,
): Promise<RejectedCandidate> {
  await appendL1TraceEvent(prisma, {
    userId: args.userId,
    problemId: args.problemId,
    eventType: "fact_rejected",
    source: `fact_store:${args.source}`,
    content: reason,
    eventJson: { candidate, reason },
  });

  return { candidate, reason };
}

function clamp(value: number) {
  return Math.max(0, Math.min(0.99, value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function mapMemoryUpdateCandidateToFactCandidates(args: {
  candidate: MemoryUpdateCandidate;
  evidenceTraceIds: string[];
}): FactCandidate[] {
  return args.candidate.facts
    .filter(
      (fact) =>
        fact.factType.trim() &&
        fact.tag.trim() &&
        fact.label?.trim() &&
        fact.evidenceSummary?.trim(),
    )
    .map((fact) => ({
      factType: fact.factType.trim(),
      tag: fact.tag.trim(),
      value: fact.label!.trim(),
      evidenceKind: "reinforce" as const,
      observedBehavior: fact.evidenceSummary!.trim(),
      evidenceTraceIds: args.evidenceTraceIds,
    }));
}

export async function upsertStrategyCandidate(
  prisma: FactStorePrisma,
  args: { userId: string; problemId?: string } & StrategyProposal,
) {
  const tag = normalizeMemoryTag(args.tag);
  const result = await arbitrateFactCandidates(prisma, {
    userId: args.userId,
    problemId: args.problemId,
    source: "reflection",
    candidates: [
      {
        factType: "strategy",
        tag,
        value: JSON.stringify({
          hypothesis: args.hypothesis,
          expectedObservable: args.expectedObservable,
        }),
        evidenceKind: "reinforce",
        observedBehavior: args.hypothesis,
        evidenceTraceIds: args.evidenceTraceIds,
      },
    ],
  });
  const updated = result.updated[0];
  if (updated) return updated;
  throw new Error(
    `strategy candidate: ${result.rejected[0]?.reason ?? "not persisted"}`,
  );
}

export async function applyStrategyObservationUpdates(
  prisma: FactStorePrisma,
  args: {
    userId: string;
    observations: Map<string, StrategyValidation>;
    evidenceTraceIdsByTag?: ReadonlyMap<string, string[]>;
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  const updated: ExistingFact[] = [];
  const rejected: Array<{ tag: string; reason: string }> = [];

  for (const [rawTag, delta] of args.observations) {
    const tag = normalizeMemoryTag(rawTag);
    const evidenceTraceIds = args.evidenceTraceIdsByTag?.get(tag) ?? [];
    if (evidenceTraceIds.length === 0) {
      rejected.push({ tag, reason: "strategy_observation_missing_evidence" });
      continue;
    }

    const fact = await prisma.l2MemoryFact.findUnique({
      where: {
        userId_factType_tag_memoryOrigin: {
          userId: args.userId,
          factType: "strategy",
          tag,
          memoryOrigin: "learner",
        },
      },
    });
    if (!fact) continue;

    const existingIntegrity = readDurableFactIntegrity(fact.validationJson);
    if (fact.memoryOrigin !== "learner" || !existingIntegrity) {
      rejected.push({ tag, reason: "strategy_fact_not_trusted" });
      continue;
    }

    const candidate: FactCandidate = {
      factType: "strategy",
      tag,
      value: fact.value ?? fact.label ?? tag,
      evidenceKind: "reinforce",
      observedBehavior:
        fact.lastEvidenceSummary ??
        fact.label ??
        "This coaching strategy has learner-observable evidence.",
      evidenceTraceIds,
    };
    const eligibility = await evaluateDurableEligibility(prisma, {
      userId: args.userId,
      source: "reflection",
      candidate,
    });
    if (!eligibility.eligible) {
      rejected.push({ tag, reason: eligibility.reason });
      continue;
    }

    const clusters = mergeDurableEvidenceClusters(
      existingIntegrity.evidenceClusters,
      eligibility.evidenceClusters,
    );
    if (clusters.length === existingIntegrity.evidenceClusters.length) {
      rejected.push({ tag, reason: "duplicate_evidence_cluster" });
      continue;
    }

    const current = parseStrategyValidation(fact.validationJson);
    const merged: StrategyValidation = {
      // Reflection recomputes a bounded observation snapshot. Treating it as
      // an additive delta would amplify the same history on every run.
      applied: Math.max(current.applied, delta.applied),
      positive: Math.max(current.positive, delta.positive),
      negative: Math.max(current.negative, delta.negative),
      deterministicPositive: Math.max(
        current.deterministicPositive,
        delta.deterministicPositive,
      ),
    };
    const status = decideStrategyTransition({
      status: fact.status,
      validation: merged,
    });
    const integrity: DurableFactIntegrity = {
      ...existingIntegrity,
      promotionStatus: status === "validated" ? "trusted" : "pending",
      evidenceClusters: clusters,
    };
    const saved = await prisma.l2MemoryFact.update({
      where: { id: fact.id },
      data: {
        validationJson: writeDurableFactIntegrity(
          JSON.stringify(merged),
          integrity,
        ),
        status,
        memoryOrigin: "learner",
        evidenceCount: clusters.length,
        evidenceTraceIds: JSON.stringify(
          clusters.flatMap((cluster) => cluster.evidenceTraceIds),
        ),
        lastSeenAt: now,
      },
    });
    updated.push(saved);
  }

  const validated = await prisma.l2MemoryFact.findMany({
    where: { userId: args.userId, factType: "strategy", status: "validated" },
  });
  if (validated.length > ACTIVE_STRATEGY_CAP) {
    const ratio = (fact: (typeof validated)[number]) => {
      const validation = parseStrategyValidation(fact.validationJson);
      return (
        validation.positive /
        Math.max(1, validation.positive + validation.negative)
      );
    };
    const overflow = validated
      .sort((a, b) => ratio(b) - ratio(a))
      .slice(ACTIVE_STRATEGY_CAP);
    for (const fact of overflow) {
      const integrity = readDurableFactIntegrity(fact.validationJson);
      await prisma.l2MemoryFact.update({
        where: { id: fact.id },
        data: {
          status: "demoted",
          validationJson: integrity
            ? writeDurableFactIntegrity(fact.validationJson, {
                ...integrity,
                promotionStatus: "pending",
              })
            : fact.validationJson,
        },
      });
    }
  }

  return { updated, rejected };
}
