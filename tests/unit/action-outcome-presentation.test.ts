import { describe, expect, it } from "vitest";
import {
  appendActionOutcomeMarkdown,
  replaceConflictingDurableOutcomeClaims,
} from "@/server/tools/chat-tools/action-outcome-presentation";

describe("backend-owned action outcome presentation", () => {
  const outcomes = [
    {
      toolName: "save_mistake_book_entry" as const,
      displayName: "错题本",
      status: "completed" as const,
      message: "错题本：已保存「RPN」",
      recordId: "entry-1",
    },
  ];

  it("appends the authoritative backend block", () => {
    expect(
      appendActionOutcomeMarkdown({
        markdown: "这里是教学正文。",
        outcomes,
        locale: "zh",
      }),
    ).toBe("这里是教学正文。\n\n### 操作结果\n\n- 错题本：已保存「RPN」");
  });

  it("replaces an LLM-owned durable status claim before appending outcomes", () => {
    const guarded = replaceConflictingDurableOutcomeClaims(
      "已经保存到错题本。",
      outcomes,
      "zh",
    );

    expect(guarded.replaced).toBe(true);
    expect(guarded.markdown).not.toContain("已经保存到错题本");
  });

  it("does not replace ordinary teaching text", () => {
    expect(
      replaceConflictingDurableOutcomeClaims(
        "Python 的 int(a / b) 会向零截断。",
        outcomes,
        "zh",
      ),
    ).toEqual({
      markdown: "Python 的 int(a / b) 会向零截断。",
      replaced: false,
    });
  });

  it("hides an unverified handbook success claim when no write ran", () => {
    const guarded = replaceConflictingDurableOutcomeClaims(
      "The tuple note was saved to your knowledge book.",
      [],
      "en",
    );

    expect(guarded.replaced).toBe(true);
    expect(guarded.markdown).toContain("no matching successful result");
  });

  it("hides the Chinese promise shape from the reported incident", () => {
    const guarded = replaceConflictingDurableOutcomeClaims(
      "好，我解释 tuple，然后帮你存到知识本里。",
      [],
      "zh",
    );

    expect(guarded.replaced).toBe(true);
    expect(guarded.markdown).toContain("后端没有对应的成功结果");
  });

  it("keeps an honest handbook failure statement when no write ran", () => {
    expect(
      replaceConflictingDurableOutcomeClaims(
        "The tuple note was not saved to your knowledge book.",
        [],
        "en",
      ),
    ).toEqual({
      markdown: "The tuple note was not saved to your knowledge book.",
      replaced: false,
    });
  });
});
