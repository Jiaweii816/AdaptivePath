import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FlashcardAnswer,
  ReviewProblemCardView,
} from "@/features/review-problems/review-problem-card";
import type { ReviewProblemCard } from "@/server/planner/review-focus/review-focus.types";

describe("FlashcardAnswer", () => {
  it("renders fenced answer snippets as code blocks", () => {
    const html = renderToStaticMarkup(
      React.createElement(FlashcardAnswer, {
        answer:
          "用 dict 记最后出现位置，重复时 left 直接跳过。\n```py\nleft = last[c] + 1\n```",
      }),
    );

    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("left = last[c] + 1");
  });

  it("does not tell users to redo when a genuine diagnosis only needs card repair", () => {
    const card: ReviewProblemCard = {
      problemId: "prob-36",
      slug: "valid-sudoku",
      title: "Valid Sudoku",
      difficulty: "Medium",
      leetcodeNumber: 36,
      planItemId: null,
      lastOutcome: "failed",
      trapSummary: "代码只检查了3x3子格，没有检查行和列。",
      dueDate: null,
      priority: 0.8,
      primaryPatternTag: "matrix",
      hasFlashcard: false,
      flashcardStatus: "can_generate",
      flashcard: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(ReviewProblemCardView, { card }),
    );

    expect(html).toContain(
      "Diagnosis is available; flashcard generation is pending.",
    );
    expect(html).not.toContain("做一次 Review");
  });
});
