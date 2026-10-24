import {
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import {
  canonicalHot150ProblemTopics,
  getCanonicalMechanism,
} from "@/server/problems/hot150-taxonomy";

export type ProblemSearchMetadata = {
  title?: string | null;
  slug?: string | null;
  leetcodeNumber?: number | null;
  tags?: string | null;
  hot150Section?: string | null;
};

type FactSearchRow = {
  factType: string;
  tag: string;
  label?: string | null;
  value?: string | null;
  lastEvidenceSummary?: string | null;
  status: string;
  memoryOrigin?: string | null;
  validationJson?: string | null;
  integrityVersion?: number | null;
  claimText?: string | null;
  scopeJson?: string | null;
  mechanismKeysJson?: string | null;
};

type SynthesisSearchRow = {
  slot: string;
  text: string;
};

const NON_CONCEPT_COLLECTION_TAGS = new Set([
  "demo",
  "hot150",
  "hot_150",
  "interview_150",
  "showcase",
  "top_interview_150",
]);

export function factFtsContent(
  fact: FactSearchRow,
  problem?: ProblemSearchMetadata | null,
) {
  if (!isTrustedL2FactForConsumption(fact)) {
    return undefined;
  }

  const teachingText = uniqueReadableText([
    extractFactValueText(fact.value),
    fact.label,
    readDurableFactIntegrity(fact.validationJson)?.humanLabel,
    fact.lastEvidenceSummary,
    ...(fact.integrityVersion === 2
      ? synthesisFactSearchMetadata(fact).contentTerms
      : []),
  ]);
  if (teachingText.length === 0) {
    return undefined;
  }

  return [
    ...problemSearchLines(problem),
    humanFactKind(fact.factType),
    ...(fact.integrityVersion === 2
      ? []
      : [`Search mechanism: ${fact.tag.replaceAll("_", " ")}`]),
    ...teachingText,
  ].join("\n");
}

export function enrichEpisodeFtsContent(
  episodeContent: string,
  problem?: ProblemSearchMetadata | null,
) {
  return [...problemSearchLines(problem), episodeContent].join("\n");
}

export function synthesisFtsContent(
  slot: SynthesisSearchRow,
  citedFacts: FactSearchRow[],
) {
  const text = readableText(slot.text);
  if (!text || citedFacts.length === 0) return undefined;
  const semantics = citedFacts.flatMap((fact) =>
    synthesisFactSearchMetadata(fact).contentTerms,
  );
  const role = slot.slot.includes("weakness")
    ? "Cross-problem learner weakness"
    : slot.slot.includes("strength")
      ? "Cross-problem demonstrated strength"
      : "Cross-problem learner synthesis";
  return uniqueReadableText([role, text, ...semantics]).join("\n");
}

/**
 * Search metadata for one fact cited by L3. V2 claim-ledger rows are
 * open-world: their compatibility integrity uses an opaque claim cluster key,
 * which is identity/evidence metadata and must never become a mechanism alias.
 */
export function synthesisFactSearchMetadata(fact: FactSearchRow) {
  if (fact.integrityVersion === 2) {
    const scope = parseRecord(fact.scopeJson);
    const topicHints = readStringArray(scope.topicHints);
    const mechanismKeys = parseStringArray(fact.mechanismKeysJson);
    const mechanismTerms = mechanismKeys.flatMap(readableMechanismTerms);
    return {
      contentTerms: uniqueReadableText([
        fact.claimText,
        ...topicHints,
        ...mechanismTerms,
      ]),
      aliases: uniqueReadableText([...topicHints, ...mechanismTerms]),
      canonicalMechanisms: mechanismKeys,
    };
  }

  const mechanism = readDurableFactIntegrity(fact.validationJson)?.mechanism;
  if (!mechanism) {
    return { contentTerms: [], aliases: [], canonicalMechanisms: [] };
  }
  const terms = readableMechanismTerms(mechanism);
  return {
    contentTerms: terms,
    aliases: terms,
    canonicalMechanisms: [mechanism],
  };
}

export function problemHistoryFtsContent(
  history: {
    runStatus: string;
    userIssueSummary?: string | null;
    coachSummary?: string | null;
    memoryUpdateSummary?: string | null;
    nextRecommendation?: string | null;
    problemTags: string;
  },
  problem?: ProblemSearchMetadata | null,
) {
  const content = uniqueReadableText([
    `Past review ${history.runStatus}`,
    history.userIssueSummary,
    history.coachSummary,
    history.memoryUpdateSummary,
    history.nextRecommendation,
    ...parseTags(history.problemTags),
  ]);
  return content.length > 0
    ? [...problemSearchLines(problem), ...content].join("\n")
    : undefined;
}

export function readableFactTeachingText(fact: FactSearchRow) {
  return uniqueReadableText([
    extractFactValueText(fact.value),
    fact.label,
    readDurableFactIntegrity(fact.validationJson)?.humanLabel,
    fact.lastEvidenceSummary,
  ])[0];
}

function problemSearchLines(problem?: ProblemSearchMetadata | null) {
  if (!problem) return [];
  const identity = [
    problem.leetcodeNumber !== null && problem.leetcodeNumber !== undefined
      ? `LeetCode ${problem.leetcodeNumber}`
      : undefined,
    readableText(problem.title),
    readableText(problem.slug?.replaceAll("-", " ")),
  ].filter((value): value is string => Boolean(value));
  const concepts = canonicalHot150ProblemTopics(parseTags(problem.tags))
    .filter((concept) => !isCollectionSearchTag(concept))
    .map((concept) => readableText(concept.replaceAll("_", " ")));
  return uniqueReadableText([
    identity.join(" "),
    readableText(problem.hot150Section),
    ...concepts,
  ]);
}

export function isCollectionSearchTag(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return NON_CONCEPT_COLLECTION_TAGS.has(normalized);
}

function extractFactValueText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "string") return readableText(parsed);
    if (isRecord(parsed)) {
      for (const key of ["hypothesis", "text", "summary", "value"]) {
        const candidate = parsed[key];
        if (typeof candidate === "string") return readableText(candidate);
      }
    }
    return undefined;
  } catch {
    return readableText(text);
  }
}

function parseTags(tags: string | null | undefined) {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => readableText(tag.replaceAll("_", " ")))
      .filter((tag): tag is string => Boolean(tag));
  } catch {
    return [];
  }
}

function parseStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readableMechanismTerms(key: string) {
  const entry = getCanonicalMechanism(key);
  return entry
    ? uniqueReadableText([entry.key, entry.label.en, entry.label.zh, ...entry.aliases])
    : uniqueReadableText([key.replaceAll("_", " ")]);
}

function humanFactKind(factType: string) {
  const labels: Record<string, string> = {
    mistake: "Past mistake pattern",
    weakness: "Area still being strengthened",
    unresolved_confusion: "Unresolved confusion",
    strength: "Demonstrated strength",
    skill: "Demonstrated skill",
    strategy: "Validated teaching strategy",
    preference: "Learner preference",
  };
  return labels[factType] ?? "Learner memory";
}

function uniqueReadableText(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map(readableText)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function readableText(value: string | null | undefined) {
  const text = value
    ?.replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi, (token) =>
      token.replaceAll("_", " "),
    )
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length >= 3 ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
