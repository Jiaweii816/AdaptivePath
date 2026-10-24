import { createHash } from "node:crypto";
import type { L2MemoryFact, Prisma } from "@prisma/client";
import {
  memoryClaimScopeSchema,
  type MemoryClaimObservationInput,
  type MemoryClaimRelation,
  type MemoryClaimScope,
} from "./open-world-claim-contract";
import { claimFamilyOf } from "./resolve-claim-cluster-key";

export const NEGATIVE_LEARNING_CLAIMS = new Set([
  "weakness",
  "mistake",
  "unresolved_confusion",
]);

export function fingerprintClaim(input: MemoryClaimObservationInput) {
  return hash(
    JSON.stringify({
      claimType: input.claimType,
      claimText: normalizeText(input.claimText),
      polarity: input.polarity,
      scope: {
        ...input.scope,
        problemIds: [...input.scope.problemIds].sort(),
        topicHints: [...input.scope.topicHints].map(normalizeText).sort(),
      },
    }),
  );
}

export function relationGuardReason(
  observation: {
    userId: string;
    memoryOrigin: string;
    claimType: string;
    polarity: string;
    scopeJson: string;
  },
  target: L2MemoryFact,
  relation: MemoryClaimRelation,
) {
  if (target.userId !== observation.userId) return "claim_relation_owner_mismatch";
  if (target.memoryOrigin !== "learner" || observation.memoryOrigin !== "learner") {
    return "claim_relation_requires_learner_origin";
  }
  if (["equivalent", "reinforces"].includes(relation)) {
    if ((target.polarity ?? inferPolarity(target.factType)) !== observation.polarity) {
      return "claim_relation_polarity_mismatch";
    }
    if (
      claimFamilyOf(
        target.factType,
        target.polarity ?? inferPolarity(target.factType),
      ) !== claimFamilyOf(observation.claimType, observation.polarity)
    ) {
      return "claim_relation_type_family_mismatch";
    }
  }
  if (
    relation === "contradicts" &&
    semanticCapabilityFamily(target.factType) !==
      semanticCapabilityFamily(observation.claimType)
  ) {
    return "claim_relation_type_family_mismatch";
  }
  if (["equivalent", "reinforces", "contradicts"].includes(relation)) {
    const sourceScope = parseScope(observation.scopeJson);
    const targetScope = parseScope(target.scopeJson);
    if (hasProblemScopeMismatch(sourceScope, targetScope)) {
      return "claim_relation_problem_scope_mismatch";
    }
  }
  return undefined;
}

export async function verifyEvidenceTraceOwnership(
  tx: Prisma.TransactionClient,
  args: { userId: string; traceIds: string[] },
) {
  const events = await tx.l1MemoryEvent.findMany({
    where: { id: { in: args.traceIds } },
    select: { id: true, userId: true, memoryOrigin: true },
  });
  if (events.length !== args.traceIds.length) {
    throw new Error("claim_evidence_trace_not_found");
  }
  if (events.some((event) => event.userId !== args.userId)) {
    throw new Error("claim_evidence_owner_mismatch");
  }
  if (events.some((event) => event.memoryOrigin !== "learner")) {
    throw new Error("claim_evidence_requires_learner_origin");
  }
}

export function inferPolarity(factType: string) {
  if (["strength", "skill"].includes(factType)) return "positive";
  if (NEGATIVE_LEARNING_CLAIMS.has(factType)) return "negative";
  return "neutral";
}

export function parseScope(value: string): MemoryClaimScope {
  try {
    const parsed = memoryClaimScopeSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // Legacy facts have no typed scope. Keep them linkable without inventing a
    // canonical mechanism or a problem-level hard filter.
  }
  return { level: "mechanism", problemIds: [], topicHints: [] };
}

export function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function semanticCapabilityFamily(factType: string) {
  if (factType === "preference" || factType === "strategy") return factType;
  if (
    [
      "strength",
      "skill",
      "weakness",
      "mistake",
      "unresolved_confusion",
      "knowledge_state",
      "learning_trajectory",
    ].includes(factType)
  ) {
    return "capability";
  }
  return factType;
}

function hasProblemScopeMismatch(
  sourceScope: MemoryClaimScope,
  targetScope: MemoryClaimScope,
) {
  return (
    sourceScope.level === "problem" &&
    targetScope.level === "problem" &&
    sourceScope.problemIds.length > 0 &&
    targetScope.problemIds.length > 0 &&
    !sourceScope.problemIds.some((id) => targetScope.problemIds.includes(id))
  );
}
