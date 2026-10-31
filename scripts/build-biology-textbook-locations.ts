/**
 * Rebuild the compact, answer-free viewer index after changing PDF ingestion.
 * Run from the repository root: npx tsx scripts/build-biology-textbook-locations.ts
 * Locations come straight from the ingested chunks; nothing is guessed.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import chunks from "../src/features/adaptivepath/data/biology-12-2/chunks.json";
import source from "../src/features/adaptivepath/data/biology-12-2/source.json";

const data = {
  chunks: chunks.map(({ id, page, printed_page, bbox, subsection }) => ({ id, page, printed_page, bbox, subsection })),
  pages: source.pages.map(({ page, printed_page, width_pixels, height_pixels }) => ({ page, printed_page, width_pixels, height_pixels })),
};
writeFileSync(join(process.cwd(), "src/features/adaptivepath/textbook-locations.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`Wrote ${chunks.length} native PDF locations.`);
