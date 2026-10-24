import { describe, expect, it } from "vitest";
import { buildNotebookMarkdown } from "@/features/notebook/notebook-markdown";
import type { NotebookProblemGroup } from "@/features/notebook/notebook-data";
import type { ReviewProblemCard } from "@/server/planner/review-focus/review-focus.types";

const GENERATED_AT = new Date("2026-06-26T12:00:00Z");

function card(overrides: Partial<ReviewProblemCard> = {}): ReviewProblemCard {
  return {
    problemId: "prob-3",
    slug: "longest-substring-without-repeating-characters",
    title: "Longest Substring Without Repeating Characters",
    difficulty: "Medium",
    leetcodeNumber: 3,
    planItemId: "plan-1",
    lastOutcome: "struggled",
    trapSummary: "滑动窗口收缩时忘记更新 left。",
    dueDate: "2026-06-26",
    priority: 0.9,
    primaryPatternTag: "sliding-window",
    hasFlashcard: true,
    flashcardStatus: "available",
    flashcard: {
      question: "重复字符出现时 left 怎么动？",
      answer: "同步删除窗口字符并右移 left，直到窗口无重复。",
    },
    ...overrides,
  };
}

describe("buildNotebookMarkdown", () => {
  it("exports problem cards grouped by pattern with review links and flashcards", () => {
    const groups: NotebookProblemGroup[] = [
      { tag: "sliding-window", cards: [card()] },
    ];
    const md = buildNotebookMarkdown({
      groups,
      resolved: [],
      generatedAt: GENERATED_AT,
    });

    expect(md).toContain("# 错题本");
    expect(md).toContain("待攻克 1 · 已攻克 0");
    expect(md).toContain("## sliding-window");
    expect(md).toContain(
      "### 3. Longest Substring Without Repeating Characters",
    );
    expect(md).toContain("- 常错点：滑动窗口收缩时忘记更新 left。");
    expect(md).toContain(
      "- Review：/workbench?problem=longest-substring-without-repeating-characters&planItemId=plan-1",
    );
    expect(md).toContain("- 自查问题：重复字符出现时 left 怎么动？");
    expect(md).toContain("- 自查答案：同步删除窗口字符并右移 left");
  });

  it("exports missing flashcard state without telling users to redo", () => {
    const md = buildNotebookMarkdown({
      groups: [
        {
          tag: "sliding-window",
          cards: [
            card({
              hasFlashcard: false,
              flashcardStatus: "can_generate",
              flashcard: null,
            }),
          ],
        },
      ],
      resolved: [],
      generatedAt: GENERATED_AT,
    });

    expect(md).toContain("- 自查卡：已有诊断，待补生成");
    expect(md).not.toContain("做一次 Review 后生成");
  });

  it("exports manual mistake-book guides before flashcard content", () => {
    const md = buildNotebookMarkdown({
      groups: [
        {
          tag: "two-pointers",
          cards: [
            card({
              trapSummary: "双指针核心理解",
              manualEntry: {
                id: "entry-1",
                title: "双指针核心理解",
                guideMarkdown: "谁更矮，水就从谁那边漏出去。",
                selfCheckQuestion: "为什么移动较矮的一侧？",
                selfCheckAnswer: "移动较矮的一侧才可能遇到更高边界。",
                saveCount: 2,
                lastSavedAt: "2026-06-26T12:00:00.000Z",
                tags: ["two_pointers"],
              },
              flashcard: {
                question: "为什么移动较矮的一侧？",
                answer: "移动较矮的一侧才可能遇到更高边界。",
              },
            }),
          ],
        },
      ],
      resolved: [],
      generatedAt: GENERATED_AT,
    });

    expect(md).toContain("- 手动收录：第 2 次");
    expect(md).toContain("#### 题目指南");
    expect(md).toContain("谁更矮，水就从谁那边漏出去。");
    expect(md).toContain("- 复习重点：双指针核心理解");
  });

  it("exports resolved problem cards as progress", () => {
    const md = buildNotebookMarkdown({
      groups: [],
      resolved: [card({ lastOutcome: "passed", planItemId: null })],
      generatedAt: GENERATED_AT,
    });

    expect(md).toContain("# 已攻克题目");
    expect(md).toContain(
      "- 3. Longest Substring Without Repeating Characters：滑动窗口收缩时忘记更新 left。",
    );
  });

  it("shows empty-state lines when there are no qualifying problems", () => {
    const md = buildNotebookMarkdown({
      groups: [],
      resolved: [],
      generatedAt: GENERATED_AT,
    });

    expect(md).toContain("_暂无待攻克题目。_");
    expect(md).toContain("_继续努力，攻克的题目会显示在这里。_");
  });
});
