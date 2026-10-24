import type { Prisma } from "@prisma/client";
import { readDurableFactIntegrity } from "@/server/memory/integrity/memory-integrity-policy";
import {
  NEGATIVE_LEARNING_CLAIMS,
  inferPolarity,
  parseRecord,
  parseScope,
  parseStringArray,
  uniqueStrings,
} from "./claim-ledger-utils";

export async function recomputeOpenWorldClaimCluster(
  tx: Prisma.TransactionClient,
  factId: string,
) {
  const fact = await tx.l2MemoryFact.findUnique({ where: { id: factId } });
  if (!fact) throw new Error("claim_cluster_not_found");
  const contributions = await tx.memoryEvidenceContribution.findMany({
    where: {
      targetClusterFactId: factId,
      memoryOrigin: "learner",
      countsAsIndependent: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const prior =
    readDurableFactIntegrity(fact.validationJson)?.evidenceClusters ?? [];
  const contributionActivities = new Set(
    contributions.map((item) => item.activityClusterId),
  );
  const priorIndependent = prior.filter(
    (cluster) => !contributionActivities.has(cluster.key),
  );
  const supportActivities = activitySet(contributions, "support");
  const contradictActivities = activitySet(contributions, "contradict");
  const supportCount =
    supportActivities.size + priorSupportCount(priorIndependent);
  const contradictCount = contradictActivities.size;
  const scope = parseScope(fact.scopeJson);
  const status = resolveStatus({
    factType: fact.factType,
    supportCount,
    contradictCount,
    crossProblemSatisfied:
      scope.level !== "cross_problem" ||
      distinctProblemCount(priorIndependent, contributions) >= 2,
    explicitPreference:
      fact.factType === "preference" &&
      contributions.some(
        (item) =>
          item.evidenceRole === "learner_statement" &&
          item.authority === "explicit",
      ),
  });
  const independentActivityIds = new Set([
    ...priorIndependent.map((item) => item.key),
    ...contributions.map((item) => item.activityClusterId),
  ]);
  const mechanismKeys = parseStringArray(fact.mechanismKeysJson);
  const clusterKey = fact.clusterKey ?? `legacy:${fact.factType}:${fact.tag}`;
  const claimText = fact.claimText ?? fact.value ?? fact.label ?? fact.tag;
  const polarity = fact.polarity ?? inferPolarity(fact.factType);

  return tx.l2MemoryFact.update({
    where: { id: fact.id },
    data: {
      clusterKey,
      claimText,
      polarity,
      confidence: deterministicConfidence({
        status,
        supportCount,
        contradictCount,
        explicitPreference: fact.factType === "preference",
      }),
      evidenceCount: independentActivityIds.size,
      status,
      source: "memory_agent_claim",
      memoryOrigin: "learner",
      evidenceTraceIds: JSON.stringify(
        uniqueStrings(
          contributions.flatMap((item) =>
            parseStringArray(item.evidenceTraceIds),
          ),
        ),
      ),
      validationJson: validationJson({
        factValidationJson: fact.validationJson,
        clusterKey,
        claimText,
        polarity,
        scope,
        mechanismKeys,
        status,
        independentActivityIds,
        supportActivities,
        contradictActivities,
        contributions,
        priorIndependent,
      }),
      integrityVersion: 2,
      contradictionSummary:
        contradictCount > 0
          ? `${contradictCount} independent activity or activities supplied contrary evidence.`
          : null,
      lastSeenAt: new Date(),
    },
  });
}

function validationJson(args: {
  factValidationJson: string;
  clusterKey: string;
  claimText: string;
  polarity: string;
  scope: ReturnType<typeof parseScope>;
  mechanismKeys: string[];
  status: string;
  independentActivityIds: Set<string>;
  supportActivities: Set<string>;
  contradictActivities: Set<string>;
  contributions: Awaited<
    ReturnType<Prisma.TransactionClient["memoryEvidenceContribution"]["findMany"]>
  >;
  priorIndependent: NonNullable<
    ReturnType<typeof readDurableFactIntegrity>
  >["evidenceClusters"];
}) {
  const trusted = ["active", "improving"].includes(args.status);
  return JSON.stringify({
    ...parseRecord(args.factValidationJson),
    integrity: {
      version: 1,
      origin: "learner",
      subject: isExplicitPreference(args.contributions)
        ? "user_explicit"
        : "learner_behavior",
      mechanism: args.mechanismKeys[0] ?? args.clusterKey,
      humanLabel: args.claimText,
      portability: "portable",
      promotionStatus: trusted ? "trusted" : "pending",
      evidenceClusters: evidenceClusters(
        args.priorIndependent,
        args.contributions,
      ),
    },
    claimIntegrity: {
      version: 2,
      origin: "learner",
      clusterKey: args.clusterKey,
      claimText: args.claimText,
      polarity: args.polarity,
      scope: args.scope,
      mechanismKeys: args.mechanismKeys,
      promotionStatus: trusted ? "trusted" : "pending",
      independentActivityIds: [...args.independentActivityIds],
      supportActivityIds: [...args.supportActivities],
      contradictActivityIds: [...args.contradictActivities],
      contributionIds: args.contributions.map((item) => item.id),
    },
  });
}

function resolveStatus(args: {
  factType: string;
  supportCount: number;
  contradictCount: number;
  crossProblemSatisfied: boolean;
  explicitPreference: boolean;
}) {
  if (args.explicitPreference) return "active";
  const isNegative = NEGATIVE_LEARNING_CLAIMS.has(args.factType);
  if (isNegative && args.contradictCount >= 2) return "resolved";
  if (isNegative && args.contradictCount >= 1 && args.supportCount >= 1) {
    return "improving";
  }
  if (!isNegative && args.contradictCount >= 1) return "contradicted";
  if (args.supportCount >= 2 && args.crossProblemSatisfied) return "active";
  return "candidate";
}

function deterministicConfidence(args: {
  status: string;
  supportCount: number;
  contradictCount: number;
  explicitPreference: boolean;
}) {
  if (args.explicitPreference) return 0.9;
  if (args.status === "resolved") return 0.75;
  if (args.status === "improving") return 0.62;
  if (args.status === "contradicted") return 0.3;
  if (args.status === "active") {
    return Math.min(0.9, 0.58 + 0.08 * Math.max(0, args.supportCount - 2));
  }
  return Math.max(0.3, 0.5 - 0.08 * args.contradictCount);
}

function evidenceClusters(
  priorIndependent: NonNullable<
    ReturnType<typeof readDurableFactIntegrity>
  >["evidenceClusters"],
  contributions: Awaited<
    ReturnType<Prisma.TransactionClient["memoryEvidenceContribution"]["findMany"]>
  >,
) {
  return [
    ...priorIndependent,
    ...[...new Set(contributions.map((item) => item.activityClusterId))].map(
      (activityClusterId) => {
        const grouped = contributions.filter(
          (item) => item.activityClusterId === activityClusterId,
        );
        const first = grouped[0];
        return {
          key: activityClusterId,
          problemId: first.problemId,
          reviewAttemptId: first.reviewAttemptId,
          revisionKey: first.revisionKey,
          transition: grouped.some((item) => item.transition === "contradict")
            ? "contradict"
            : "reinforce",
          evidenceTraceIds: uniqueStrings(
            grouped.flatMap((item) => parseStringArray(item.evidenceTraceIds)),
          ),
        };
      },
    ),
  ];
}

function activitySet(
  contributions: Awaited<
    ReturnType<Prisma.TransactionClient["memoryEvidenceContribution"]["findMany"]>
  >,
  transition: string,
) {
  return new Set(
    contributions
      .filter((item) => item.transition === transition)
      .map((item) => item.activityClusterId),
  );
}

function priorSupportCount(
  priorIndependent: NonNullable<
    ReturnType<typeof readDurableFactIntegrity>
  >["evidenceClusters"],
) {
  return new Set(
    priorIndependent
      .filter((item) => item.transition === "reinforce")
      .map((item) => item.key),
  ).size;
}

function distinctProblemCount(
  priorIndependent: NonNullable<
    ReturnType<typeof readDurableFactIntegrity>
  >["evidenceClusters"],
  contributions: Awaited<
    ReturnType<Prisma.TransactionClient["memoryEvidenceContribution"]["findMany"]>
  >,
) {
  return new Set([
    ...priorIndependent.flatMap((item) =>
      item.problemId ? [item.problemId] : [],
    ),
    ...contributions.flatMap((item) => (item.problemId ? [item.problemId] : [])),
  ]).size;
}

function isExplicitPreference(
  contributions: Awaited<
    ReturnType<Prisma.TransactionClient["memoryEvidenceContribution"]["findMany"]>
  >,
) {
  return contributions.some(
    (item) =>
      item.evidenceRole === "learner_statement" && item.authority === "explicit",
  );
}
