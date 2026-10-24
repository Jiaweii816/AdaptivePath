import { algorithmHints } from "@/server/tools/chat-tools/algorithm-hints";
import { apiReferenceKb } from "@/server/tools/chat-tools/api-reference-kb";

export type KbDocument = {
  refId: string;
  source: "algorithm_hint" | "api_reference";
  title: string;
  content: string;
};

let cachedDocuments: KbDocument[] | undefined;
let cachedById: Map<string, KbDocument> | undefined;

export function buildKbDocuments(): KbDocument[] {
  if (cachedDocuments) {
    return cachedDocuments;
  }

  const hintDocuments = Object.values(algorithmHints).flatMap((hintSet) =>
    hintSet.levels.map((level, index) => ({
      refId: `kb:hint:${hintSet.problemSlug}:${index + 1}`,
      source: "algorithm_hint" as const,
      title: `${hintSet.title} - ${level.heading}`,
      content: [
        hintSet.title,
        hintSet.problemSlug,
        level.heading,
        level.content,
      ].join(" "),
    })),
  );

  const apiDocuments = apiReferenceKb.map((entry) => ({
    refId: `kb:api:${entry.language}:${entry.topic}`,
    source: "api_reference" as const,
    title: `${entry.language} ${entry.topic}`,
    content: [
      entry.language,
      entry.topic,
      entry.summary,
      ...entry.commonUses,
      ...entry.pitfalls,
      ...entry.examples,
    ].join(" "),
  }));

  cachedDocuments = [...hintDocuments, ...apiDocuments];
  return cachedDocuments;
}

export function getKbDocumentById(refId: string): KbDocument | undefined {
  if (!cachedById) {
    cachedById = new Map(buildKbDocuments().map((doc) => [doc.refId, doc]));
  }

  return cachedById.get(refId);
}
