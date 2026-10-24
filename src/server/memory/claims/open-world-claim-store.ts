import type { PrismaClient } from "@prisma/client";
import { resolveMemoryWritePolicy } from "@/server/memory/memory-origin";
import {
  memoryClaimMaterializationInputSchema,
  memoryClaimObservationInputSchema,
  type MemoryClaimObservationInput,
} from "./open-world-claim-contract";
import {
  fingerprintClaim,
  hash,
  relationGuardReason,
  uniqueStrings,
  verifyEvidenceTraceOwnership,
} from "./claim-ledger-utils";
import { createOpenWorldClaimCluster } from "./claim-cluster-store";
import { recomputeOpenWorldClaimCluster } from "./recompute-claim-cluster";

type ClaimLedgerPrisma = PrismaClient;

const NON_INDEPENDENT_EVIDENCE_ROLES = new Set(["assistant_context"]);

export async function upsertMemoryClaimObservation(
  prisma: ClaimLedgerPrisma,
  rawInput: MemoryClaimObservationInput,
) {
  assertLearnerWritePolicy();
  const input = memoryClaimObservationInputSchema.parse(rawInput);
  const cluster = await prisma.memoryActivityCluster.findUnique({
    where: { id: input.activityClusterId },
  });
  if (!cluster) throw new Error("claim_observation_activity_cluster_not_found");
  if (cluster.userId !== input.userId) {
    throw new Error("claim_observation_owner_mismatch");
  }
  if (cluster.memoryOrigin !== "learner") {
    throw new Error("claim_observation_requires_learner_activity");
  }
  if (input.problemId && cluster.problemId && input.problemId !== cluster.problemId) {
    throw new Error("claim_observation_problem_mismatch");
  }

  const claimFingerprint = fingerprintClaim(input);
  return prisma.memoryClaimObservation.upsert({
    where: {
      activityClusterId_claimFingerprint: {
        activityClusterId: input.activityClusterId,
        claimFingerprint,
      },
    },
    create: {
      userId: input.userId,
      activityClusterId: input.activityClusterId,
      problemId: input.problemId ?? cluster.problemId,
      episodeId: input.episodeId,
      claimType: input.claimType,
      claimText: input.claimText,
      polarity: input.polarity,
      scopeJson: JSON.stringify(input.scope),
      mechanismKeysJson: JSON.stringify(uniqueStrings(input.mechanismKeys)),
      source: input.source,
      memoryOrigin: "learner",
      status: "proposed",
      claimFingerprint,
      evidenceStrength: input.evidenceStrength,
    },
    update: {
      episodeId: input.episodeId,
      claimText: input.claimText,
      scopeJson: JSON.stringify(input.scope),
      mechanismKeysJson: JSON.stringify(uniqueStrings(input.mechanismKeys)),
      source: input.source,
      evidenceStrength: input.evidenceStrength,
    },
  });
}

export async function materializeMemoryClaimObservation(
  prisma: ClaimLedgerPrisma,
  rawInput: unknown,
) {
  assertLearnerWritePolicy();
  const input = memoryClaimMaterializationInputSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    const observation = await tx.memoryClaimObservation.findUnique({
      where: { id: input.observationId },
      include: { activityCluster: true },
    });
    if (!observation) throw new Error("claim_observation_not_found");
    if (
      observation.memoryOrigin !== "learner" ||
      observation.activityCluster.memoryOrigin !== "learner"
    ) {
      throw new Error("claim_materialization_requires_learner_origin");
    }

    await verifyEvidenceTraceOwnership(tx, {
      userId: observation.userId,
      traceIds: uniqueStrings(
        input.evidence.flatMap((item) => item.evidenceTraceIds),
      ),
    });

    const target = input.relation
      ? await tx.l2MemoryFact.findUnique({
          where: { id: input.relation.targetClusterFactId },
        })
      : null;
    if (input.relation && !target) {
      throw new Error("claim_relation_target_not_found");
    }

    const guardReason = target
      ? relationGuardReason(observation, target, input.relation!.relation)
      : undefined;
    const hasIndependentEvidence = input.evidence.some(
      (item) => !NON_INDEPENDENT_EVIDENCE_ROLES.has(item.evidenceRole),
    );
    const rejectionReason = guardReason ??
      (!hasIndependentEvidence ? "assistant_only_evidence" : undefined);

    if (target && input.relation) {
      await tx.memoryClaimRelation.upsert({
        where: {
          observationId_targetClusterFactId: {
            observationId: observation.id,
            targetClusterFactId: target.id,
          },
        },
        create: {
          observationId: observation.id,
          targetClusterFactId: target.id,
          relation: input.relation.relation,
          modelConfidence: input.relation.modelConfidence,
          rationale: input.relation.rationale,
          status: rejectionReason ? "rejected" : "accepted",
          guardReason: rejectionReason,
        },
        update: {
          relation: input.relation.relation,
          modelConfidence: input.relation.modelConfidence,
          rationale: input.relation.rationale,
          status: rejectionReason ? "rejected" : "accepted",
          guardReason: rejectionReason ?? null,
        },
      });
    }

    if (rejectionReason) {
      await tx.memoryClaimObservation.update({
        where: { id: observation.id },
        data: { status: "rejected" },
      });
      return { observationId: observation.id, fact: null, rejectionReason };
    }

    const relation = input.relation?.relation;
    const attachesToTarget = Boolean(
      target &&
        relation &&
        ["equivalent", "reinforces", "contradicts"].includes(relation),
    );
    const fact = attachesToTarget
      ? target!
      : await createOpenWorldClaimCluster(tx, observation);
    const transition = relation === "contradicts" ? "contradict" : "support";

    for (const evidence of input.evidence) {
      const countsAsIndependent = !NON_INDEPENDENT_EVIDENCE_ROLES.has(
        evidence.evidenceRole,
      );
      const contributionKey = hash(
        [
          "claim-evidence-v1",
          fact.id,
          observation.activityClusterId,
          observation.id,
          transition,
          evidence.evidenceRole,
          evidence.revisionKey,
        ].join("\u0000"),
      );
      await tx.memoryEvidenceContribution.upsert({
        where: { contributionKey },
        create: {
          observationId: observation.id,
          targetClusterFactId: fact.id,
          activityClusterId: observation.activityClusterId,
          problemId: observation.problemId,
          reviewAttemptId:
            evidence.reviewAttemptId ??
            observation.activityCluster.rootReviewAttemptId,
          contributionKey,
          evidenceRole: evidence.evidenceRole,
          transition,
          authority: evidence.authority,
          revisionKey: evidence.revisionKey,
          evidenceTraceIds: JSON.stringify(
            uniqueStrings(evidence.evidenceTraceIds),
          ),
          countsAsIndependent,
          memoryOrigin: "learner",
        },
        update: {
          authority: evidence.authority,
          evidenceTraceIds: JSON.stringify(
            uniqueStrings(evidence.evidenceTraceIds),
          ),
          countsAsIndependent,
        },
      });
    }

    await tx.memoryClaimObservation.update({
      where: { id: observation.id },
      data: { status: "accepted" },
    });
    const materialized = await recomputeOpenWorldClaimCluster(tx, fact.id);
    return { observationId: observation.id, fact: materialized };
  });
}

function assertLearnerWritePolicy() {
  const policy = resolveMemoryWritePolicy();
  if (!policy.durableWrites) {
    throw new Error(`open_world_claim_requires_learner_origin:${policy.origin}`);
  }
}
