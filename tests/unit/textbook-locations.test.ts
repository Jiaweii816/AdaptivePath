import { describe, expect, it } from "vitest";
import { BIOLOGY_QUESTIONS, TEXTBOOK_CHUNKS } from "../../src/features/adaptivepath/content";
import sourceChunks from "../../src/features/adaptivepath/data/biology-12-2/chunks.json";
import locations from "../../src/features/adaptivepath/textbook-locations.json";

describe("textbook page coordinates", () => {
  it("maps every active question reference to the actual PDF chunk and printed page", () => {
    const mapping = locations.legacy_reference_ids as Record<string, string[]>;
    for (const question of BIOLOGY_QUESTIONS) for (const id of question.referenceIds) {
      expect(mapping[id]?.length, id).toBeGreaterThan(0);
      const legacy = TEXTBOOK_CHUNKS.find(chunk => chunk.id === id)!;
      for (const mapped of mapping[id]) {
        const source = sourceChunks.find(chunk => chunk.id === mapped)!;
        expect(source.printed_page).toBe(legacy.page);
        const normalize = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
        const a = normalize(legacy.original), b = normalize(source.raw_text);
        expect(a.includes(b) || b.includes(a), `${id} -> ${mapped}`).toBe(true);
      }
    }
  });
  it("uses unchanged source geometry, rather than guessed paragraph positions", () => {
    for (const location of locations.chunks) {
      const source = sourceChunks.find(chunk => chunk.id === location.id)!;
      expect(location.bbox).toEqual(source.bbox);
      expect(location.page).toBe(source.page);
      const page = locations.pages[location.page - 1];
      expect(location.bbox[2]).toBeLessThanOrEqual(page.width_pixels);
      expect(location.bbox[3]).toBeLessThanOrEqual(page.height_pixels);
    }
  });
});
