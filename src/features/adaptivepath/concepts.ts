/** Client-safe sub-topic catalog for OpenStax Biology 2e §12.2 (no answers). */
import rawConcepts from "./data/biology-12-2/concepts.json";

export const BIOLOGY_SECTION_ID = "12.2";

export type Concept = Readonly<{
  id: string;
  slug: string;
  name: string;
  nameZh: string;
  learningObjective: string;
  prerequisiteIds: readonly string[];
  chunkIds: readonly string[];
}>;

export const CONCEPTS: readonly Concept[] = Object.freeze(
  rawConcepts
    .map((c) => Object.freeze({
      id: c.id,
      slug: c.slug,
      name: c.name,
      nameZh: c.name_zh,
      learningObjective: c.learning_objective,
      prerequisiteIds: Object.freeze([...c.prerequisite_ids]),
      chunkIds: Object.freeze([...c.chunk_ids]),
    }))
    .sort((a, b) => a.id.localeCompare(b.id)),
);

export function getConcept(id: string): Concept {
  const concept = CONCEPTS.find((c) => c.id === id);
  if (!concept) throw new Error(`Unknown biology concept: ${id}`);
  return concept;
}
