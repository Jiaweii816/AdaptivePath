import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_TEXT_VERSION,
  buildRetrievalTextPrompt,
  deterministicRetrievalText,
  retrievalTextInputHash,
  validateRetrievalText,
} from "@/server/memory/retrieval-text/retrieval-text";

describe("source-owned retrieval text", () => {
  const episode = {
    layer: "episode" as const,
    sourceId: "episode-a",
    sourceText: [
      "Problem: Search Insert Position.",
      "Summary: The final interval candidate was not checked.",
      "Outcome: failed.",
    ],
  };

  it("versions and hashes the actual source payload, rather than an FTS projection", () => {
    expect(RETRIEVAL_TEXT_VERSION).toBe(1);
    expect(retrievalTextInputHash(episode)).toMatch(/^[a-f0-9]{64}$/);
    expect(retrievalTextInputHash({ ...episode, sourceText: [...episode.sourceText, "A later correction passed."] }))
      .not.toBe(retrievalTextInputHash(episode));
  });

  it("gives a rewriter evidence-bound instructions and rejects internal labels", () => {
    const prompt = buildRetrievalTextPrompt(episode);
    expect(prompt).toContain("Use only facts present below");
    expect(prompt).toContain("final interval candidate");
    expect(validateRetrievalText("The learner should check the final candidate before returning from the search interval.")).toBeTruthy();
    expect(validateRetrievalText("Use binary_search_invariant after the structured JSON pipeline.")).toBeUndefined();
  });

  it("keeps deterministic fallback visibly source-attributed for isolated tests", () => {
    expect(deterministicRetrievalText(episode)).toContain("A past learning episode:");
    expect(deterministicRetrievalText(episode)).toContain("Search Insert Position");
  });
});
