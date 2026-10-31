import { describe, expect, it } from "vitest";
import { listQuestions } from "../../src/features/adaptivepath/question-bank";
import sourceChunks from "../../src/features/adaptivepath/data/biology-12-2/chunks.json";
import locations from "../../src/features/adaptivepath/textbook-locations.json";

describe("textbook page coordinates", () => {
  it("locates every chunk referenced by the 320-question bank", () => {
    const located = new Set(locations.chunks.map(chunk => chunk.id));
    for (const question of listQuestions()) {
      expect(question.chunkIds.length, question.id).toBeGreaterThan(0);
      for (const id of question.chunkIds) expect(located.has(id), `${question.id} -> ${id}`).toBe(true);
    }
  });

  it("carries no legacy reference mapping", () => {
    expect(Object.keys(locations).sort()).toEqual(["chunks", "pages"]);
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
