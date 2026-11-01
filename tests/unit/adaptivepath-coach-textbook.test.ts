import { describe, expect, it } from "vitest";
import index from "@/features/adaptivepath/data/biology-12-2/retrieval-index.json";
import sourceChunks from "@/features/adaptivepath/data/biology-12-2/chunks.json";
import { getPassages, searchTextbook, TEXTBOOK_TOP_K, tokenize } from "@/features/adaptivepath/coach/textbook";
import { BiologyCoachError, coachErrorStatus } from "@/features/adaptivepath/coach/errors";

const TEST_CROSS = "b2e-12-2-concept-04";
const headingIds = new Set(sourceChunks.filter((c) => c.kind === "heading").map((c) => c.id));

describe("textbook search", () => {
  it("ranks the test-cross passage first for a test-cross query", () => {
    const [first] = searchTextbook({ query: "test cross homozygous recessive" });
    expect(first.chunkId).toBe("b2e-12-2-p04-c01");
    expect(first.subsection).toBe("The Test Cross Distinguishes the Dominant Phenotype");
    expect(first.score).toBeGreaterThan(0);
  });

  it("concept filter returns only concept chunks and fills k even at zero score", () => {
    const allowed = new Set(index.concept_to_chunk_ids[TEST_CROSS]);
    const results = searchTextbook({ query: "zzzz-no-such-word", conceptIds: [TEST_CROSS] });
    expect(results).toHaveLength(TEXTBOOK_TOP_K);
    expect(results.every((r) => allowed.has(r.chunkId))).toBe(true);
  });

  it("heading chunks are never returned", () => {
    const results = searchTextbook({ query: "Characteristics and Traits" }, 20);
    expect(results.some((r) => headingIds.has(r.chunkId))).toBe(false);
  });

  it("genotype tokens keep case", () => {
    expect(tokenize("The YY plant x yy Yy")).toEqual(["the", "YY", "plant", "x", "yy", "Yy"]);
  });

  it("getPassages returns passages in order and throws on unknown id", () => {
    expect(getPassages(["b2e-12-2-p04-c01"])[0]).toMatchObject({ chunkId: "b2e-12-2-p04-c01", printedPage: expect.any(Number) });
    expect(() => getPassages(["nope"])).toThrow("Unknown textbook chunk nope");
  });
});

describe("coach errors", () => {
  it("maps codes to HTTP status", () => {
    expect(coachErrorStatus("attempt_not_found")).toBe(404);
    expect(coachErrorStatus("review_requires_live")).toBe(400);
    expect(coachErrorStatus("answer_leak")).toBe(502);
    const error = new BiologyCoachError("llm_timeout", "classifier", "Classifier timed out");
    expect(error).toMatchObject({ code: "llm_timeout", node: "classifier", name: "BiologyCoachError" });
  });
});
