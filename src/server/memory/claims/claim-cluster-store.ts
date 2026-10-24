import type { Prisma } from "@prisma/client";
import {
  claimFamilyOf,
  resolveClaimClusterKey,
} from "./resolve-claim-cluster-key";
import {
  hash,
  inferPolarity,
  parseScope,
  parseStringArray,
} from "./claim-ledger-utils";

export async function createOpenWorldClaimCluster(
  tx: Prisma.TransactionClient,
  observation: {
    userId: string;
    problemId: string | null;
    claimType: string;
    claimText: string;
    polarity: string;
    scopeJson: string;
    mechanismKeysJson: string;
    source: string;
    claimFingerprint: string;
  },
) {
  const resolution = resolveClaimClusterKey({
    claimType: observation.claimType,
    polarity: observation.polarity,
    scope: parseScope(observation.scopeJson),
    claimText: observation.claimText,
    mechanismKeys: parseStringArray(observation.mechanismKeysJson),
  });
  const existing = await tx.l2MemoryFact.findUnique({
    where: {
      userId_clusterKey_memoryOrigin: {
        userId: observation.userId,
        clusterKey: resolution.clusterKey,
        memoryOrigin: "learner",
      },
    },
  });
  if (existing) return existing;

  const bridged = resolution.mechanismKey
    ? await findLegacyMechanismFact(tx, {
        userId: observation.userId,
        mechanismKey: resolution.mechanismKey,
        polarity: observation.polarity,
        claimType: observation.claimType,
      })
    : null;
  if (bridged) {
    return tx.l2MemoryFact.update({
      where: { id: bridged.id },
      data: {
        clusterKey: resolution.clusterKey,
        claimText: bridged.claimText ?? bridged.label ?? observation.claimText,
        polarity: observation.polarity,
        scopeJson: observation.scopeJson,
        mechanismKeysJson: JSON.stringify([resolution.mechanismKey]),
        integrityVersion: 2,
      },
    });
  }

  return tx.l2MemoryFact.create({
    data: {
      userId: observation.userId,
      problemId: observation.problemId,
      factType: observation.claimType,
      // v2 identity is (userId, clusterKey, memoryOrigin), but the legacy
      // (userId, factType, tag, memoryOrigin) unique index still applies. Two
      // claims sharing a mechanism but differing in polarity or scope level get
      // distinct clusterKeys, so a mechanism-named tag would collide on that
      // legacy index. Deriving the tag from the clusterKey keeps both unique.
      // The v1 bridge above is unaffected: it looks up canonical tags on
      // existing integrityVersion=1 rows, not on rows created here.
      tag: `claim_${hash(resolution.clusterKey).slice(0, 24)}`,
      label: observation.claimText,
      value: observation.claimText,
      confidence: 0.5,
      evidenceCount: 0,
      lastEvidenceSummary: observation.claimText,
      status: "candidate",
      source: "memory_agent_claim",
      memoryOrigin: "learner",
      evidenceTraceIds: "[]",
      clusterKey: resolution.clusterKey,
      claimText: observation.claimText,
      polarity: observation.polarity,
      scopeJson: observation.scopeJson,
      mechanismKeysJson: JSON.stringify(
        resolution.mechanismKey ? [resolution.mechanismKey] : [],
      ),
      integrityVersion: 2,
    },
  });
}

async function findLegacyMechanismFact(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    mechanismKey: string;
    polarity: string;
    claimType: string;
  },
) {
  const candidates = await tx.l2MemoryFact.findMany({
    where: {
      userId: args.userId,
      memoryOrigin: "learner",
      tag: args.mechanismKey,
      integrityVersion: 1,
    },
  });
  const family = claimFamilyOf(args.claimType, args.polarity);
  return (
    candidates.find(
      (fact) =>
        claimFamilyOf(
          fact.factType,
          fact.polarity ?? inferPolarity(fact.factType),
        ) === family,
    ) ?? null
  );
}
