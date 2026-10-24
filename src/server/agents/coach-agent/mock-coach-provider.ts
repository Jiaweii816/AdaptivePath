import type {
  CoachChatTurnResult,
  CoachProvider,
  CoachReviewInput,
} from "./coach-agent.types";
import { coachReviewResultSchema, type CoachReviewResult } from "@/types/coach";
import { assertCoachReplyContract } from "./coach-reply-contract";

export type MockCoachProviderOptions = {
  chatScript?: CoachChatTurnResult[];
  noToolReply?: string;
};

export function createMockCoachProvider(
  options: MockCoachProviderOptions = {},
): CoachProvider {
  let chatScriptIndex = 0;

  return {
    async review(input) {
      if (
        input.evidenceVerdict?.evidenceClass === "local_only" &&
        input.runResult.status === "passed_visible_tests"
      ) {
        return buildLocalPassedReviewResult(input);
      }

      const firstFailedCase = input.runResult.firstFailedCase;
      const isSearchInsert =
        input.problem.slug === "search-insert-position" &&
        input.memory.teachableMemories.some((memory) =>
          memory.cue.toLowerCase().includes("binary"),
        );
      const baseReply =
        input.responseLanguage === "en"
          ? buildEnglishReply(input)
          : buildChineseReply(input, isSearchInsert);
      const reply =
        input.evidenceVerdict?.evidenceClass === "local_only"
          ? `${baseReply}\n\n${input.responseLanguage === "en" ? "This diagnosis is limited to the selected local visible tests; it is not an official LeetCode verdict." : "上述诊断只针对所选本地可见测试，不是 LeetCode 官方判定。"}`
          : baseReply;
      assertCoachReplyContract(reply);

      return coachReviewResultSchema.parse({
        diagnosis: {
          problemSlug: input.problem.slug,
          runStatus: input.runResult.status,
          userIssueSummary: firstFailedCase
            ? `${firstFailedCase.label} expected ${JSON.stringify(firstFailedCase.expected)} but got ${JSON.stringify(firstFailedCase.actual)}.`
            : `Runner status is ${input.runResult.status}.`,
          coachSummary: isSearchInsert
            ? "Focus on the insertion boundary and return left."
            : "Use the first visible run result to make one small correction.",
          mistakeTags: isSearchInsert
            ? ["binary_search_boundary_mistake"]
            : [input.runResult.status],
          skillTags: input.problem.tags,
          selfCheck: firstFailedCase
            ? {
                question:
                  "二分查找插入位置时，遇到 target 落在两个数之间，最后应该返回哪个边界？",
                answer:
                  "把题目想成找第一个 >= target 的位置；收缩右边界后循环结束返回 left，不要返回偏右的 mid 或固定下标。",
              }
            : null,
          memoryUpdateCandidate: {
            facts: isSearchInsert
              ? [
                  {
                    factType: "mistake",
                    tag: "binary_search_boundary_mistake",
                    label: "Binary search boundary mistake",
                    confidence: 0.72,
                    evidenceSummary:
                      "Search Insert visible case points to a return/boundary issue.",
                  },
                ]
              : [],
            summary: "Mock coach generated deterministic review metadata.",
          },
        },
        coachReply: reply,
      });
    },
    async chat(input) {
      if (!input.tools || input.tools.length === 0) {
        return {
          type: "final",
          coachReply:
            options.noToolReply ??
            (input.responseLanguage === "en"
              ? "Tool use is disabled for this debug turn, so I will answer from the existing conversation and last visible run evidence."
              : "这次调试回合关闭了工具调用，我会只根据已有对话和上次可见运行结果回答。"),
        };
      }

      const scriptedStep = options.chatScript?.[chatScriptIndex];
      chatScriptIndex += 1;

      if (scriptedStep) {
        return scriptedStep;
      }

      return {
        type: "final",
        coachReply:
          input.responseLanguage === "en"
            ? "Keep this follow-up focused on the last visible run result, then make one small edit and review again."
            : "这次追问先围绕上一次可见运行结果来改一小步，改完再 Review。",
      };
    },
  };
}

function buildLocalPassedReviewResult(input: CoachReviewInput): CoachReviewResult {
  const reply =
    input.responseLanguage === "en"
      ? buildEnglishExaminerReply(input)
      : buildChineseExaminerReply(input);
  assertCoachReplyContract(reply);

  return coachReviewResultSchema.parse({
    diagnosis: {
      problemSlug: input.problem.slug,
      runStatus: input.runResult.status,
      userIssueSummary:
        "The current revision passed the selected local visible tests.",
      coachSummary: "Local visible tests passed; official result remains unverified.",
      mistakeTags: [],
      skillTags: input.problem.tags,
      selfCheck: null,
      memoryUpdateCandidate: {
        facts: [],
        summary:
          "Local visible tests passed; no mistake candidate was emitted.",
      },
    },
    coachReply: reply,
  });
}

function examinerCounts(input: CoachReviewInput) {
  const total = input.runResult.passedCount + input.runResult.failedCount;
  return total > 0 ? `${input.runResult.passedCount}/${total}` : "visible tests";
}

function buildChineseExaminerReply(input: CoachReviewInput) {
  return `当前代码通过了所选本地可见测试（${examinerCounts(input)}）。这只说明这些可见用例通过，不是 LeetCode 官方判定，也不覆盖隐藏测试。下一步请补一个关键边界用例，或用官方评测确认。`;
}

function buildEnglishExaminerReply(input: CoachReviewInput) {
  return `The current revision passed the selected local visible tests (${examinerCounts(input)}). This only describes those visible cases; it is not an official LeetCode verdict and does not cover hidden tests. Next, add one meaningful boundary case or verify with the official judge.`;
}

function buildChineseReply(input: CoachReviewInput, isSearchInsert: boolean) {
  const firstFailedCase = input.runResult.firstFailedCase;
  const failedCaseText = firstFailedCase
    ? `这个可见用例没过:${firstFailedCase.label},预期 ${JSON.stringify(firstFailedCase.expected)},实际 ${JSON.stringify(firstFailedCase.actual)}。`
    : `这次运行状态是 ${input.runResult.status}。`;

  if (isSearchInsert) {
    return [
      `根因:你的二分边界更新偏右,返回值落到了 target 右侧,所以 ${failedCaseText}`,
      "走一遍 nums=[1,3,5,6]、target=2:答案应落在 1 后面(下标 1),但当前代码把位置推到了更右,说明循环结束时返回的下标取偏了。",
      "最小改法:把这题看成找第一个 `>= target` 的位置,遇到 `nums[mid] >= target` 时让右边界收到 `mid`,循环结束 `return left`,只改这一处再跑同一组可见测试。",
    ].join("\n");
  }

  return [
    `根因:第一个失败用例的 actual 和 expected 不一致。${failedCaseText}`,
    `走一遍这个用例,定位到产生第一个不匹配的那一步;先贴着你熟悉的 ${input.user.strongPatterns[0] ?? "当前思路"},不换成完整题解。`,
    "最小改法:只改导致这个用例不一致的那一行,改完再运行同一组可见测试。",
  ].join("\n");
}

function buildEnglishReply(input: CoachReviewInput) {
  const firstFailedCase = input.runResult.firstFailedCase;
  const failedCaseText = firstFailedCase
    ? `Visible case ${firstFailedCase.label} expected ${JSON.stringify(firstFailedCase.expected)} but got ${JSON.stringify(firstFailedCase.actual)}.`
    : `The runner status is ${input.runResult.status}.`;

  return [
    `Root cause: the first mismatch is concrete enough to fix. ${failedCaseText}`,
    `Walk that case to the first diverging step, staying close to your familiar ${input.user.strongPatterns[0] ?? "current"} approach instead of switching strategies.`,
    "Minimal fix: change only the line that creates this mismatch, then run the same visible tests again.",
  ].join("\n");
}
