/**
 * Rebuild the compact, answer-free viewer index after changing PDF ingestion.
 * Run from the repository root: npx tsx scripts/build-biology-textbook-locations.ts
 * Legacy references are matched by preserved source text AND printed page,
 * never by ordinal chunk numbers or guessed page coordinates.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEXTBOOK_CHUNKS } from "../src/features/adaptivepath/textbook-chunks";
import chunks from "../src/features/adaptivepath/data/biology-12-2/chunks.json";
import source from "../src/features/adaptivepath/data/biology-12-2/source.json";

// PDF line wrapping, superscript footnote markers and punctuation can differ
// between the old supplied transcription and native extraction of the same page.
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
const legacy: Record<string, string[]> = {};
for (const old of TEXTBOOK_CHUNKS) {
  const text = normalize(old.original);
  const matches = chunks.filter(chunk => {
    if (chunk.printed_page !== old.page || chunk.kind === "heading") return false;
    const native = normalize(chunk.raw_text);
    return text.includes(native) || native.includes(text);
  });
  if (!matches.length) throw new Error(`No native PDF location for ${old.id}; review the extraction before publishing.`);
  legacy[old.id] = matches.map(chunk => chunk.id);
}
const data = {
  legacy_reference_ids: legacy,
  chunks: chunks.map(({ id, page, printed_page, bbox, subsection }) => ({ id, page, printed_page, bbox, subsection })),
  pages: source.pages.map(({ page, printed_page, width_pixels, height_pixels }) => ({ page, printed_page, width_pixels, height_pixels })),
};
writeFileSync(join(process.cwd(), "src/features/adaptivepath/textbook-locations.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`Mapped ${Object.keys(legacy).length} legacy chunks to ${chunks.length} native PDF locations.`);
