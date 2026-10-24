import { describe, expect, it } from "vitest";
import {
  applyCoachReplyGuards,
  findForbiddenCopy,
} from "@/server/agents/coach-agent/coach-reply-contract";

const freeFormZh = [
  "你把进位算了两遍。",
  "走一遍最小用例:第 3 位多出一个 3。",
  "最小改法:循环里只算一次 total,改完重跑同一组可见测试。",
].join("\n");

const zhSafetyTemplate =
  "我不能仅凭当前描述判断这份代码已经官方通过。我的判断会优先基于本地运行证据和明确的远程 LeetCode 运行/评测结果。当这些工具不可用时，我可以用 DeepSeek 做静态推理辅助判断。若你想最终确认，请点击左侧 LeetCode 官方链接自行提交校验。";

describe("applyCoachReplyGuards", () => {
  it("keeps a clean free-form reply and reports no warnings", () => {
    const result = applyCoachReplyGuards(freeFormZh, { responseLanguage: "zh" });

    expect(result.reply).toBe(freeFormZh);
    expect(result.formatWarnings).toEqual([]);
    expect(result.safetyReplaced).toBe(false);
  });

  it("accepts a short reply with no fixed sections", () => {
    const result = applyCoachReplyGuards("两行回复,没有分段。", {
      responseLanguage: "zh",
    });

    expect(result.safetyReplaced).toBe(false);
    expect(result.formatWarnings).toEqual([]);
  });

  it("warns on an over-length reply", () => {
    const result = applyCoachReplyGuards("水".repeat(2000), {
      responseLanguage: "zh",
    });

    expect(result.safetyReplaced).toBe(false);
    expect(result.formatWarnings.length).toBeGreaterThan(0);
  });

  it("does not treat safe negated official-success wording as forbidden copy", () => {
    const safeZh =
      "我不能确认 AC，也不能确认 Accepted；这里只能基于可见运行证据回答。";
    const safeEn =
      "I cannot confirm Accepted, and I can't say this is guaranteed AC without official evidence.";

    expect(findForbiddenCopy(safeZh)).toEqual([]);
    expect(findForbiddenCopy(safeEn)).toEqual([]);
    expect(findForbiddenCopy(zhSafetyTemplate)).toEqual([]);
    expect(findForbiddenCopy("确认是否真正通过后，再记录自评。")).toEqual(
      [],
    );
    expect(findForbiddenCopy("官方通过后回 Today 记录自评。")).toEqual([]);
    expect(
      applyCoachReplyGuards(safeZh, { responseLanguage: "zh" }),
    ).toMatchObject({
      reply: safeZh,
      safetyReplaced: false,
      formatWarnings: [],
    });
  });

  it("still catches positive official-success promises", () => {
    expect(findForbiddenCopy("这份代码已经 LeetCode Accepted。").length).toBeGreaterThan(
      0,
    );
    expect(findForbiddenCopy("All hidden tests passed.").length).toBeGreaterThan(
      0,
    );
    expect(findForbiddenCopy("This is guaranteed AC.").length).toBeGreaterThan(
      0,
    );
    expect(
      findForbiddenCopy("I cannot confirm Accepted. This is LeetCode Accepted.")
        .length,
    ).toBeGreaterThan(0);
    expect(
      findForbiddenCopy("I cannot confirm Accepted, but this is LeetCode Accepted.")
        .length,
    ).toBeGreaterThan(0);
  });

  it("replaces a reply that violates the safety boundary", () => {
    const forbidden = `${freeFormZh}\n你已经 passed all hidden tests,guaranteed accepted。`;
    const result = applyCoachReplyGuards(forbidden, {
      responseLanguage: "zh",
    });

    expect(result.safetyReplaced).toBe(true);
    expect(result.reply).not.toContain("guaranteed");
    expect(findForbiddenCopy(result.reply)).toEqual([]);
  });

  it("uses non-failure safety copy for passed-run forbidden replies", () => {
    const forbidden =
      "这次本地可见测试通过,但草稿误写成 guaranteed accepted。";
    const result = applyCoachReplyGuards(forbidden, {
      responseLanguage: "zh",
      runStatus: "passed_visible_tests",
    });

    expect(result.safetyReplaced).toBe(true);
    expect(result.reply).toBe(zhSafetyTemplate);
    expect(result.reply).not.toContain("失败");
    expect(result.reply).not.toContain("不匹配");
    expect(result.reply).not.toContain("mismatch");
    expect(findForbiddenCopy(result.reply)).toEqual([]);
  });
});
