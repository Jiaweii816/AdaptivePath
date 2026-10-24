import { createHash } from "node:crypto";

/**
 * Version the source-owned retrieval prose separately from a rebuildable FTS
 * document. Bumping this forces the migration worker to revisit only stale
 * rows, and makes an interrupted batch safe to resume.
 */
export const RETRIEVAL_TEXT_VERSION = 1;

export type RetrievalTextLayer = "episode" | "l2_fact" | "l3_synthesis";

export type RetrievalTextSource = {
  layer: RetrievalTextLayer;
  sourceId: string;
  sourceText: string[];
  representativeEvidence?: string[];
};

export function retrievalTextInputHash(source: RetrievalTextSource) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        layer: source.layer,
        sourceId: source.sourceId,
        sourceText: compact(source.sourceText),
        representativeEvidence: compact(source.representativeEvidence ?? []),
      }),
    )
    .digest("hex");
}

/**
 * A no-network fallback for tests and an explicit emergency migration mode.
 * It does not infer a taxonomy or add a diagnosis: it merely turns owned
 * source fields into grammatical, source-attributed text.
 */
export function deterministicRetrievalText(source: RetrievalTextSource) {
  const sourceText = compact(source.sourceText);
  const evidence = compact(source.representativeEvidence ?? []);
  const prefix =
    source.layer === "episode"
      ? "A past learning episode:"
      : source.layer === "l2_fact"
        ? "A learner pattern supported by past evidence:"
        : "A cross-problem coaching synthesis:";
  return [prefix, ...sourceText, ...(evidence.length ? ["Supporting examples:", ...evidence] : [])]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRetrievalTextPrompt(source: RetrievalTextSource) {
  const layerGuidance =
    source.layer === "episode"
      ? "Write one concrete past learning experience. Preserve the problem, observed outcome, and lesson if they are in the source."
      : source.layer === "l2_fact"
        ? "Write one cumulative learner pattern. Ground it in the supplied representative episodes; do not turn a one-off event into a repeated habit."
        : "Write one cross-problem coaching guidance statement. Do not describe it as a concrete past event and do not add claims beyond the cited L2 patterns.";
  return [
    "You rewrite PatternCoach memory into one retrieval-friendly natural-language experience card.",
    "Return JSON only: {\"retrievalText\": \"...\"}.",
    layerGuidance,
    "Use only facts present below. Do not invent a test result, code behavior, frequency, diagnosis, or learner preference.",
    "Do not emit database ids, internal pipeline names, snake_case tags, taxonomy labels, or a solution. Keep the source language when practical.",
    "The text must make the searchable mechanism and teaching value explicit in plain language, not merely list a title and algorithm name.",
    "",
    "SOURCE MEMORY:",
    ...compact(source.sourceText).map((line) => `- ${line}`),
    ...(source.representativeEvidence?.length
      ? ["REPRESENTATIVE EVIDENCE:", ...compact(source.representativeEvidence).map((line) => `- ${line}`)]
      : []),
  ].join("\n");
}

export function validateRetrievalText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 24 || text.length > 1_800) return undefined;
  if (/\b(structured json|pipeline|memoryretrievaldocument)\b/i.test(text)) return undefined;
  if (/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i.test(text)) return undefined;
  return text;
}

function compact(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}
