import { describe, expect, it } from "vitest";
import { irisHandle } from "@/features/onboarding/profile-defaults";
import { loadNotebookData } from "@/features/notebook/notebook-data";
import { createMemoryTestDb } from "./memory-test-helpers";

const json = (value: unknown) => JSON.stringify(value);

describe("loadNotebookData", () => {
  it("returns grouped problem cards and resolved cards without requiring a goal", async () => {
    const db = await createMemoryTestDb();

    try {
      const user = await db.prisma.user.upsert({
        where: { handle: irisHandle },
        update: {},
        create: { handle: irisHandle },
      });
      const problem = await db.prisma.problem.create({
        data: {
          slug: "longest-substring-without-repeating-characters",
          title: "Longest Substring",
          difficulty: "Medium",
          tags: json(["sliding-window"]),
          statementMarkdown: "Find the longest substring.",
          methodName: "lengthOfLongestSubstring",
        },
      });
      const chatSession = await db.prisma.chatSession.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          title: problem.title,
          memoryOrigin: "test",
        },
      });
      const reviewAttempt = await db.prisma.reviewAttempt.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          chatSessionId: chatSession.id,
          memoryOrigin: "test",
          language: "Python",
          codeSnapshot: "class Solution: pass",
        },
      });
      await db.prisma.runEvidence.create({
        data: {
          reviewAttemptId: reviewAttempt.id,
          memoryOrigin: "test",
          source: "review",
          status: "failed",
          passedCount: 0,
          failedCount: 1,
        },
      });
      await db.prisma.diagnosisResult.create({
        data: {
          reviewAttemptId: reviewAttempt.id,
          mistakeTags: json(["sliding_window_shrink_condition"]),
          skillTags: json(["sliding-window"]),
          userIssueSummary: "while 内忘记移除窗口字符。",
          coachSummary: "移动 left 时同步删除旧字符。",
          selfCheckQuestion: "窗口内出现重复字符时集合怎么更新？",
          selfCheckAnswer: "移动 left 时同步从集合里删除旧字符。",
        },
      });
      await db.prisma.problemHistory.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          reviewAttemptId: reviewAttempt.id,
          chatSessionId: chatSession.id,
          memoryOrigin: "test",
          language: "Python",
          problemTags: problem.tags,
          runStatus: "failed",
          userIssueSummary: "while 内忘记移除窗口字符。",
          coachSummary: "移动 left 时同步删除旧字符。",
        },
      });

      const data = await loadNotebookData(db.prisma);

      expect(data.groups).toHaveLength(1);
      expect(data.groups[0]?.tag).toBe("sliding-window");
      expect(data.groups[0]?.cards[0]?.slug).toBe(
        "longest-substring-without-repeating-characters",
      );
      expect(data.resolved).toEqual([]);
      expect(data.markdown).toContain("待攻克 1 · 已攻克 0");
    } finally {
      await db.cleanup();
    }
  });

  it("merges manual mistake-book entries with automatic review cards and prefers manual content", async () => {
    const db = await createMemoryTestDb();

    try {
      const user = await db.prisma.user.upsert({
        where: { handle: irisHandle },
        update: {},
        create: { handle: irisHandle },
      });
      const problem = await db.prisma.problem.create({
        data: {
          slug: "container-with-most-water",
          title: "Container With Most Water",
          difficulty: "Medium",
          tags: json(["two-pointers"]),
          statementMarkdown: "Find max area.",
          methodName: "maxArea",
        },
      });
      const chatSession = await db.prisma.chatSession.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          title: problem.title,
          memoryOrigin: "test",
        },
      });
      const reviewAttempt = await db.prisma.reviewAttempt.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          chatSessionId: chatSession.id,
          memoryOrigin: "test",
          language: "Python",
          codeSnapshot: "class Solution: pass",
        },
      });
      await db.prisma.runEvidence.create({
        data: {
          reviewAttemptId: reviewAttempt.id,
          memoryOrigin: "test",
          source: "review",
          status: "failed",
          passedCount: 0,
          failedCount: 1,
        },
      });
      await db.prisma.diagnosisResult.create({
        data: {
          reviewAttemptId: reviewAttempt.id,
          mistakeTags: json(["two_pointer_move_rule"]),
          skillTags: json(["two-pointers"]),
          userIssueSummary: "自动诊断：移动了较高的一侧。",
          coachSummary: "面积由较矮柱决定。",
          selfCheckQuestion: "自动问题",
          selfCheckAnswer: "自动答案",
        },
      });
      await db.prisma.problemHistory.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          reviewAttemptId: reviewAttempt.id,
          chatSessionId: chatSession.id,
          memoryOrigin: "test",
          language: "Python",
          problemTags: problem.tags,
          runStatus: "failed",
          userIssueSummary: "自动诊断：移动了较高的一侧。",
          coachSummary: "面积由较矮柱决定。",
        },
      });
      await db.prisma.mistakeBookEntry.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          chatSessionId: chatSession.id,
          title: "双指针核心理解",
          guideMarkdown: "左右边界中，**谁更矮，水就从谁那边漏出去**。",
          selfCheckQuestion: "为什么只移动较矮的一侧？",
          selfCheckAnswer: "较矮柱限制当前面积，移动较高柱不会提升当前宽度下的上限。",
          tags: json(["two_pointers"]),
        },
      });

      const data = await loadNotebookData(db.prisma);
      const cards = data.groups.flatMap((group) => group.cards);

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        slug: "container-with-most-water",
        trapSummary: "双指针核心理解",
        hasFlashcard: true,
        flashcard: {
          question: "为什么只移动较矮的一侧？",
        },
      });
      expect(cards[0]?.manualEntry?.guideMarkdown).toContain("谁更矮");
      expect(data.markdown).toContain("#### 题目指南");
      expect(data.markdown).toContain("- 复习重点：双指针核心理解");
    } finally {
      await db.cleanup();
    }
  });
});
