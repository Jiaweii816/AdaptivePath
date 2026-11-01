/**
 * Deterministic lexical retrieval over the §12.2 textbook chunks (BM25).
 * Server-only: the chunk text is injected into the coach, never the answers.
 */
import sourceChunks from "../data/biology-12-2/chunks.json";
import index from "../data/biology-12-2/retrieval-index.json";

export const TEXTBOOK_TOP_K = 3;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const GENOTYPE_LENGTH = 2;

export type TextbookPassage = Readonly<{ chunkId: string; subsection: string; printedPage: number; text: string }>;
export type ScoredPassage = TextbookPassage & Readonly<{ score: number }>;
type IndexedChunk = Readonly<{ passage: TextbookPassage; terms: ReadonlyMap<string, number>; length: number }>;

/** Genotype symbols (AA, Aa, aa, Rr…) carry meaning in their case; other words are lowercased. */
function normalizeToken(token: string): string {
  const isGenotype = token.length === GENOTYPE_LENGTH && /^[A-Za-z]+$/.test(token) && token[0].toLowerCase() === token[1].toLowerCase();
  return isGenotype ? token : token.toLowerCase();
}

export function tokenize(text: string): string[] {
  return (text.match(/[A-Za-z0-9]+/g) ?? []).map(normalizeToken);
}

function termCounts(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

const PASSAGES: ReadonlyMap<string, TextbookPassage> = new Map(sourceChunks.map((c) => [c.id, Object.freeze({
  chunkId: c.id, subsection: c.subsection, printedPage: c.printed_page, text: c.normalized_text,
})]));

const SEARCHABLE: readonly IndexedChunk[] = Object.freeze(sourceChunks
  .filter((c) => c.kind !== "heading")
  .map((c) => {
    const tokens = tokenize(c.normalized_text);
    return { passage: PASSAGES.get(c.id)!, terms: termCounts(tokens), length: tokens.length };
  }));
const AVERAGE_LENGTH = SEARCHABLE.reduce((sum, c) => sum + c.length, 0) / SEARCHABLE.length;
const DOCUMENT_FREQUENCY = termCounts(SEARCHABLE.flatMap((c) => [...c.terms.keys()]));
const CONCEPT_CHUNKS = index.concept_to_chunk_ids as Readonly<Record<string, readonly string[]>>;

function inverseFrequency(term: string): number {
  const df = DOCUMENT_FREQUENCY.get(term) ?? 0;
  return Math.log(1 + (SEARCHABLE.length - df + 0.5) / (df + 0.5));
}

function bm25(chunk: IndexedChunk, queryTerms: readonly string[]): number {
  return queryTerms.reduce((score, term) => {
    const tf = chunk.terms.get(term) ?? 0;
    if (tf === 0) return score;
    const norm = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.length / AVERAGE_LENGTH));
    return score + inverseFrequency(term) * ((tf * (BM25_K1 + 1)) / norm);
  }, 0);
}

function candidatesFor(conceptIds: readonly string[] | undefined): readonly IndexedChunk[] {
  if (!conceptIds?.length) return SEARCHABLE;
  const allowed = new Set(conceptIds.flatMap((id) => {
    const ids = CONCEPT_CHUNKS[id];
    if (!ids) throw new Error(`Unknown concept ${id}`);
    return ids;
  }));
  return SEARCHABLE.filter((c) => allowed.has(c.passage.chunkId));
}

/** With a concept filter every candidate is relevant by construction, so zero-score chunks still fill k. */
export function searchTextbook(input: Readonly<{ query: string; conceptIds?: readonly string[] }>, k = TEXTBOOK_TOP_K): ScoredPassage[] {
  const queryTerms = [...new Set(tokenize(input.query))];
  const filtered = Boolean(input.conceptIds?.length);
  return candidatesFor(input.conceptIds)
    .map((chunk) => ({ ...chunk.passage, score: bm25(chunk, queryTerms) }))
    .filter((p) => filtered || p.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .slice(0, k);
}

export function getPassages(chunkIds: readonly string[]): TextbookPassage[] {
  return chunkIds.map((id) => {
    const passage = PASSAGES.get(id);
    if (!passage) throw new Error(`Unknown textbook chunk ${id}`);
    return passage;
  });
}
