/** Client-safe page locations of textbook chunks (no chunk text). */
import locations from "./textbook-locations.json";

export const TEXTBOOK_LOCATIONS = locations;

/** Page locations for a question's chunk ids, in reading order; unknown ids are an error. */
export function referenceLocations(chunkIds: readonly string[]) {
  const known = new Set(locations.chunks.map(chunk => chunk.id));
  const missing = chunkIds.filter(id => !known.has(id));
  if (missing.length) throw new Error(`Unknown textbook chunk ids: ${missing.join(", ")}`);
  const ids = new Set(chunkIds);
  return locations.chunks.filter(chunk => ids.has(chunk.id));
}
