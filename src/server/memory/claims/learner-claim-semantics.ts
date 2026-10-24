export type LearnerClaimFactLike = {
  factType: string;
  tag: string;
  label?: string | null;
  value?: string | null;
  claimText?: string | null;
  polarity?: string | null;
  scopeJson?: string | null;
  mechanismKeysJson?: string | null;
  integrityVersion?: number | null;
};

export type LearnerClaimPolarity = "positive" | "negative" | "neutral";

export type LearnerClaimSemantics = {
  version: "open_world_v2" | "legacy_v1";
  polarity: LearnerClaimPolarity;
  statement: string;
  topicHints: string[];
  mechanismKeys: string[];
  /** Soft projection terms only; consumers must not treat them as eligibility. */
  projectionTerms: string[];
  /** Human-facing grouping labels, ordered from most learner-specific to fallback. */
  displayTopics: string[];
};

/**
 * Unified interpretation for trusted learner facts. Trust/origin/status remain
 * caller-owned gates. This function only reads semantics and never requires a
 * canonical taxonomy match.
 */
export function readLearnerClaimSemantics(
  fact: LearnerClaimFactLike,
): LearnerClaimSemantics {
  const version =
    fact.integrityVersion === 2 || Boolean(fact.claimText?.trim())
      ? "open_world_v2"
      : "legacy_v1";
  const topicHints = readScopeTopicHints(fact.scopeJson);
  const mechanismKeys = parseStringArray(fact.mechanismKeysJson);
  const fallback = firstReadable([fact.label, fact.value, humanize(fact.tag)]);
  const statement =
    version === "open_world_v2"
      ? firstReadable([fact.claimText, fact.label, fact.value, humanize(fact.tag)])
      : fallback;
  const topicMetadata = uniqueReadable([
    ...topicHints,
    ...mechanismKeys.map(humanize),
    ...(version === "legacy_v1" ? [humanize(fact.tag)] : []),
  ]);
  const displayTopics = topicMetadata.length > 0 ? topicMetadata : [statement];
  const projectionTerms = uniqueReadable([
    ...topicHints,
    ...mechanismKeys,
    statement,
    ...(version === "legacy_v1" ? [fact.tag] : []),
  ]);

  return {
    version,
    polarity: resolvePolarity(fact),
    statement,
    topicHints,
    mechanismKeys,
    projectionTerms,
    displayTopics,
  };
}

function resolvePolarity(fact: LearnerClaimFactLike): LearnerClaimPolarity {
  if (
    fact.polarity === "positive" ||
    fact.polarity === "negative" ||
    fact.polarity === "neutral"
  ) {
    return fact.polarity;
  }
  if (fact.factType === "strength" || fact.factType === "skill") {
    return "positive";
  }
  if (
    fact.factType === "mistake" ||
    fact.factType === "weakness" ||
    fact.factType === "unresolved_confusion"
  ) {
    return "negative";
  }
  return "neutral";
}

function readScopeTopicHints(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return uniqueReadable(
      Array.isArray((parsed as Record<string, unknown>).topicHints)
        ? ((parsed as Record<string, unknown>).topicHints as unknown[]).filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    );
  } catch {
    return [];
  }
}

function parseStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? uniqueReadable(
          parsed.filter((item): item is string => typeof item === "string"),
        )
      : [];
  } catch {
    return [];
  }
}

function firstReadable(values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? "Learner pattern";
}

function uniqueReadable(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.replace(/\s+/g, " ").trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ").trim();
}
