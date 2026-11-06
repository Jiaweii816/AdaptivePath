import { describe, expect, it } from "vitest";
import { findAnswerLeaks } from "@/features/adaptivepath/coach/answer-leak-guard";
import { draftState } from "@/features/adaptivepath/coach/draft-state";
import { listQuestions } from "@/features/adaptivepath/question-bank";
import {
  appendPrompt, focusedReference, suggestPrompts, MAX_PROMPTS,
  type PromptState, type ReferenceRef,
} from "@/features/adaptivepath/practice/suggested-prompts";

const INCOMPLETE_DOMINANCE = "b2e-12-2-concept-06";
const INTEGRATED = ["b2e-12-2-concept-02", "b2e-12-2-concept-03", "b2e-12-2-concept-04"];
const REFERENCE: ReferenceRef = { chunkId: "b2e-12-2-p01-c05", number: 2, printedPage: 316 };
const state = (overrides: Partial<PromptState>): PromptState =>
  ({ phase: "current_question", draftState: "empty", conceptIds: [INCOMPLETE_DOMINANCE], reference: null, ...overrides });
const ids = (s: PromptState) => suggestPrompts(s).map((p) => p.id);

describe("suggestPrompts", () => {
  it("offers a concept explanation and a starting hint before an option is chosen", () => {
    expect(suggestPrompts(state({}))).toEqual([
      { id: "explain_concept", text: "Explain Incomplete dominance" },
      { id: "start_hint", text: "Give me a hint to start" },
    ]);
  });

  it("offers a pre-commit check once an option is chosen without reasoning", () => {
    expect(ids(state({ draftState: "option_only" }))).toEqual(["explain_concept", "pre_commit_check"]);
  });

  it("leads with a reasoning check once reasoning is written", () => {
    expect(ids(state({ draftState: "reasoning" }))).toEqual(["check_reasoning", "explain_concept"]);
  });

  it("offers an attempt review after submission whatever the draft", () => {
    expect(ids(state({ phase: "submitted_attempt", draftState: "reasoning" }))).toEqual(["review_attempt", "explain_concept"]);
  });

  it("asks how the ideas connect on an integrated question", () => {
    expect(suggestPrompts(state({ conceptIds: INTEGRATED }))[0]).toEqual({ id: "connect_concepts", text: "How do the ideas in this question connect?" });
  });

  it("adds the focused reference as the third prompt", () => {
    const prompts = suggestPrompts(state({ reference: REFERENCE }));
    expect(prompts).toHaveLength(MAX_PROMPTS);
    expect(prompts[2]).toEqual({ id: "explain_reference", text: "Explain Reference 2 (p. 316)" });
  });

  it("never depends on which option is selected, so no prompt leaks an answer", () => {
    const leaks = listQuestions().flatMap((question) => (["empty", "option_only", "reasoning"] as const).flatMap((draft) =>
      (["current_question", "submitted_attempt"] as const).flatMap((phase) =>
        suggestPrompts(state({ phase, draftState: draft, conceptIds: question.conceptIds, reference: REFERENCE }))
          .flatMap((p) => findAnswerLeaks(p.text, { correctOption: question.correctAnswer, options: question.options, quotedSpans: [] })))));
    expect(leaks).toEqual([]);
  });
});

describe("draftState", () => {
  it("is client-safe and classifies drafts", () => {
    expect(draftState(null)).toBe("empty");
    expect(draftState({ selectedOption: "B", reasoning: "  " })).toBe("option_only");
    expect(draftState({ selectedOption: null, reasoning: "because" })).toBe("reasoning");
  });
});

describe("appendPrompt", () => {
  it("fills an empty box with the prompt", () => {
    expect(appendPrompt("", "Check my reasoning")).toBe("Check my reasoning");
  });

  it("keeps what the student typed and appends after one space", () => {
    expect(appendPrompt("I think it is 1:2:1.", "Check my reasoning")).toBe("I think it is 1:2:1. Check my reasoning");
    expect(appendPrompt("I think ", "Check my reasoning")).toBe("I think Check my reasoning");
  });
});

describe("focusedReference", () => {
  const QUESTION_CHUNKS = ["b2e-12-2-p01-c04", "b2e-12-2-p01-c05"];
  const base = { open: true, liveModel: true, reviewing: false, highlight: null, questionChunkIds: QUESTION_CHUNKS, focusedChunkId: null };

  it("is absent while the reference is closed or the tutor is offline", () => {
    expect(focusedReference({ ...base, open: false })).toBeNull();
    expect(focusedReference({ ...base, liveModel: false })).toBeNull();
  });

  it("defaults to Reference 1, like the viewer", () => {
    expect(focusedReference(base)).toEqual({ chunkId: "b2e-12-2-p01-c04", number: 1, printedPage: 316 });
  });

  it("follows the reference the student located last", () => {
    expect(focusedReference({ ...base, focusedChunkId: "b2e-12-2-p01-c05" })).toEqual(REFERENCE);
  });

  it("numbers a coach-cited passage within what the viewer shows", () => {
    expect(focusedReference({ ...base, highlight: ["b2e-12-2-p01-c05"] })).toEqual({ ...REFERENCE, number: 1 });
  });

  it("in review appears only for a passage the coach cited", () => {
    expect(focusedReference({ ...base, reviewing: true })).toBeNull();
    expect(focusedReference({ ...base, reviewing: true, highlight: ["b2e-12-2-p01-c05"] })?.chunkId).toBe("b2e-12-2-p01-c05");
  });
});
