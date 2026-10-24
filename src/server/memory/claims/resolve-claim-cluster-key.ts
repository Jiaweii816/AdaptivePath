import { createHash } from "node:crypto";
import {
  HISTORICAL_RAW_MECHANISM_MAP,
  getCanonicalMechanism,
  resolveCanonicalMechanismSignal,
} from "@/server/problems/hot150-taxonomy";
import {
  canonicalizeConcept,
  extractKnownConcepts,
} from "@/server/memory/retrieval/concepts";
import type { MemoryClaimScope } from "./open-world-claim-contract";

const CLUSTER_KEY_VERSION = "claim:v2";
const SEMANTIC_HASH_LENGTH = 16;
const NEGATIVE_LEARNING_CLAIMS = new Set([
  "weakness",
  "mistake",
  "knowledge_state",
  "learning_trajectory",
  "unresolved_confusion",
]);
const POSITIVE_LEARNING_CLAIMS = new Set([
  "strength",
  "skill",
  "knowledge_state",
  "learning_trajectory",
]);
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "this",
  "that",
  "with",
  "as",
  "at",
  "by",
  "learner",
  "user",
  "they",
  "their",
  "them",
]);

export type ClaimClusterKeyResolution = {
  clusterKey: string;
  tier: "canonical" | "concept" | "semantic";
  mechanismKey?: string;
};

export type ClaimClusterKeyInput = {
  claimType: string;
  polarity: string;
  scope: MemoryClaimScope;
  claimText: string;
  mechanismKeys: string[];
};

export function resolveClaimClusterKey(
  input: ClaimClusterKeyInput,
): ClaimClusterKeyResolution {
  const canonical = resolveCanonicalKey(input.mechanismKeys);
  if (canonical) return buildResolution(input, canonical, "canonical");

  const concept = resolveConceptKey(input);
  if (concept) return buildResolution(input, concept, "concept");

  return buildResolution(input, `~sem:${semanticHash(input.claimText)}`, "semantic");
}

export function claimFamilyOf(factType: string, polarity: string) {
  if (factType === "preference" || factType === "strategy") return factType;
  if (polarity === "positive" && POSITIVE_LEARNING_CLAIMS.has(factType)) {
    return "capability_positive";
  }
  if (polarity === "negative" && NEGATIVE_LEARNING_CLAIMS.has(factType)) {
    return "capability_negative";
  }
  return `${polarity}:${factType}`;
}

function buildResolution(
  input: ClaimClusterKeyInput,
  key: string,
  tier: ClaimClusterKeyResolution["tier"],
): ClaimClusterKeyResolution {
  const family = claimFamilyOf(input.claimType, input.polarity);
  return {
    clusterKey: [
      CLUSTER_KEY_VERSION,
      family,
      input.polarity,
      key,
      input.scope.level,
    ].join(":"),
    tier,
    mechanismKey: tier === "semantic" ? undefined : key,
  };
}

function resolveCanonicalKey(mechanismKeys: string[]) {
  for (const raw of mechanismKeys) {
    const normalized = canonicalizeConcept(raw);
    if (getCanonicalMechanism(normalized)) return normalized;
    const mapped = HISTORICAL_RAW_MECHANISM_MAP[normalized];
    if (mapped?.decision === "canonical") return mapped.key;
  }
  return undefined;
}

function resolveConceptKey(input: ClaimClusterKeyInput) {
  const sources = [...input.scope.topicHints, input.claimText];
  for (const source of sources) {
    const canonical = resolveCanonicalMechanismSignal({
      rawTag: source,
      problemTags: [],
    });
    if (canonical.decision === "canonical") return canonical.key;
    const [concept] = extractKnownConcepts(source);
    if (concept) return concept;
  }
  return undefined;
}

function semanticHash(claimText: string) {
  const tokens = [
    ...new Set(
      canonicalizeConcept(claimText)
        .split("_")
        .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
    ),
  ].sort();
  return createHash("sha256")
    .update(tokens.join(" "))
    .digest("hex")
    .slice(0, SEMANTIC_HASH_LENGTH);
}
