import { describe, expect, it } from "vitest";
import {
  buildWorkspaceCodeRevision,
  resolveStoredMessageRevision,
} from "@/server/agents/coach-agent/workspace-revision";
import {
  projectCurrentRevisionWindow,
  type StoredChatMessageForProjection,
} from "@/server/agents/coach-agent/history-projection";
import { hashCodeForRun } from "@/server/code/code-hash";

const PROBLEM_ID = "group-anagrams";
const OLD_CODE = "class Solution:\n    def groupAnagrams(self, strs):";
const CURRENT_CODE = [
  "class Solution:",
  "    def groupAnagrams(self, strs):",
  "        groups = {}",
  "        for s in strs:",
  "            counts = [0] * 26",
  "            for ch in s:",
  "                counts[ord(ch) - ord('a')] += 1",
  "            groups[tuple(counts)].append(s)",
  "        return list(groups.values())",
].join("\n");

describe("workspace revision resolution", () => {
  it("builds the current revision from problem, language, and exact code", () => {
    expect(
      buildWorkspaceCodeRevision({
        problemId: PROBLEM_ID,
        language: "Python",
        code: CURRENT_CODE,
      }),
    ).toEqual({
      problemId: PROBLEM_ID,
      codeHash: hashCodeForRun({ language: "Python", code: CURRENT_CODE }),
    });
  });

  it("uses workspace.currentCodeHash before the review snapshot fallback", () => {
    const metadataHash = hashCodeForRun({
      language: "Python",
      code: CURRENT_CODE,
    });

    expect(
      resolveStoredMessageRevision({
        problemId: PROBLEM_ID,
        metadataJson: workspaceMetadata(metadataHash),
        reviewAttempt: { language: "Python", codeSnapshot: OLD_CODE },
      }),
    ).toEqual({ problemId: PROBLEM_ID, codeHash: metadataHash });
  });

  it("derives legacy review revisions from language and codeSnapshot", () => {
    expect(
      resolveStoredMessageRevision({
        problemId: PROBLEM_ID,
        metadataJson: JSON.stringify({ type: "review_reply" }),
        reviewAttempt: { language: "Python", codeSnapshot: CURRENT_CODE },
      }),
    ).toEqual(
      buildWorkspaceCodeRevision({
        problemId: PROBLEM_ID,
        language: "Python",
        code: CURRENT_CODE,
      }),
    );
  });
});

describe("projectCurrentRevisionWindow", () => {
  it("keeps stale user and assistant turns in the unified conversation with revision markers", () => {
    const oldHash = codeHash(OLD_CODE);
    const projection = project([
      row(1, "user", "你刚才说我是 IndentationError？", oldHash),
      row(2, "assistant", "是的，旧代码没有函数体。", oldHash),
    ]);

    expect(projection.messages).toEqual([
      {
        role: "user",
        content: "⟨针对更早的代码版本⟩ 你刚才说我是 IndentationError？",
      },
      {
        role: "assistant",
        content: "⟨针对更早的代码版本⟩ 是的，旧代码没有函数体。",
      },
    ]);
    expect(projection.decisions.every((item) => item.included)).toBe(true);
    expect(reasonCount(projection.decisions, "included_earlier_revision")).toBe(
      2,
    );
  });

  it("keeps a complete same-revision user and assistant pair", () => {
    const hash = codeHash(CURRENT_CODE);
    const projection = project([
      row(1, "user", "这样对吗？", hash),
      row(2, "assistant", "先看 KeyError。", hash),
    ]);

    expect(projection.messages).toEqual([
      { role: "user", content: "这样对吗？" },
      { role: "assistant", content: "先看 KeyError。" },
    ]);
  });

  it("keeps one chronological stream across code revisions", () => {
    const oldHash = codeHash(OLD_CODE);
    const currentHash = codeHash(CURRENT_CODE);
    const projection = project([
      row(1, "user", "告诉我该改哪里", oldHash),
      row(2, "assistant", "旧版本没有函数体", oldHash),
      row(3, "user", "这样改对吗？", currentHash),
      row(4, "assistant", "现在先处理 KeyError", currentHash),
    ]);

    expect(projection.messages).toEqual([
      { role: "user", content: "⟨针对更早的代码版本⟩ 告诉我该改哪里" },
      { role: "assistant", content: "⟨针对更早的代码版本⟩ 旧版本没有函数体" },
      { role: "user", content: "这样改对吗？" },
      { role: "assistant", content: "现在先处理 KeyError" },
    ]);
    expect(decision(projection.decisions, 1)?.reason).toBe(
      "included_earlier_revision",
    );
  });

  it("keeps legacy rows with an unknown-revision continuity marker", () => {
    const projection = project([
      row(1, "user", "这样对吗？"),
      row(2, "assistant", "无法确认属于哪份代码"),
    ]);

    expect(projection.messages).toEqual([
      { role: "user", content: "⟨代码版本未知；仅作对话连续性⟩ 这样对吗？" },
      {
        role: "assistant",
        content: "⟨代码版本未知；仅作对话连续性⟩ 无法确认属于哪份代码",
      },
    ]);
    expect(decision(projection.decisions, 2)?.reason).toBe(
      "included_unknown_revision",
    );
  });

  it("keeps legacy review replies when their ReviewAttempt snapshot matches", () => {
    const reviewRow = row(2, "assistant", "匹配当前代码的 Review");
    reviewRow.reviewAttemptId = "review-1";
    reviewRow.reviewAttempt = {
      language: "Python",
      codeSnapshot: CURRENT_CODE,
    };

    expect(project([reviewRow]).messages).toEqual([
      { role: "assistant", content: "匹配当前代码的 Review" },
    ]);
  });

  it("keeps the clear boundary stronger than a matching revision", () => {
    const hash = codeHash(CURRENT_CODE);
    const projection = projectCurrentRevisionWindow({
      storedMessages: [
        row(1, "user", "已清除的问题", hash),
        row(2, "assistant", "已清除的回答", hash),
        row(3, "user", "清除后的问题", hash),
      ],
      currentRevision: currentRevision(),
      clearedBeforeSequence: 2,
      maxModelMessages: 8,
    });

    expect(projection.messages).toEqual([
      { role: "user", content: "清除后的问题" },
    ]);
    expect(decision(projection.decisions, 2)?.reason).toBe(
      "excluded_before_clear_boundary",
    );
  });

  it("preserves history when the current revision is unknown", () => {
    const projection = projectCurrentRevisionWindow({
      storedMessages: [
        row(1, "user", "继续解释"),
        row(2, "assistant", "旧诊断", codeHash(OLD_CODE)),
      ],
      currentRevision: undefined,
      clearedBeforeSequence: 0,
      maxModelMessages: 8,
    });

    expect(projection.messages).toHaveLength(2);
    expect(decision(projection.decisions, 2)?.reason).toBe(
      "included_unknown_revision",
    );
  });

  it("applies one recent-eight budget across all revisions", () => {
    const oldHash = codeHash(OLD_CODE);
    const storedMessages = Array.from({ length: 10 }, (_, index) =>
      row(
        index + 1,
        index % 2 === 0 ? "user" : "assistant",
        `turn-${index + 1}`,
        oldHash,
      ),
    );
    const projection = projectCurrentRevisionWindow({
      storedMessages,
      currentRevision: currentRevision(),
      clearedBeforeSequence: 0,
      maxModelMessages: 8,
    });

    expect(projection.messages).toHaveLength(8);
    expect(projection.messages[0]?.content).toContain("turn-3");
    expect(projection.messages.at(-1)?.content).toContain("turn-10");
    expect(decision(projection.decisions, 1)?.reason).toBe(
      "excluded_model_history_budget",
    );
  });

  it("sanitizes retained assistant protocol text only after projection", () => {
    const hash = codeHash(CURRENT_CODE);
    const projection = project([
      row(1, "assistant", "answer <||DSML||tool_calls> secret", hash),
    ]);

    expect(projection.messages).toEqual([
      {
        role: "assistant",
        content: "[Tool protocol output removed by safety guard]",
      },
    ]);
  });

  it("sanitizes stale assistant protocol text before adding the revision marker", () => {
    const oldHash = codeHash(OLD_CODE);
    const projection = project([
      row(1, "assistant", "answer <||DSML||tool_calls> secret", oldHash),
    ]);

    expect(projection.messages).toEqual([
      {
        role: "assistant",
        content:
          "⟨针对更早的代码版本⟩ [Tool protocol output removed by safety guard]",
      },
    ]);
  });
});

function project(storedMessages: StoredChatMessageForProjection[]) {
  return projectCurrentRevisionWindow({
    storedMessages,
    currentRevision: currentRevision(),
    clearedBeforeSequence: 0,
    maxModelMessages: 8,
  });
}

function currentRevision() {
  return buildWorkspaceCodeRevision({
    problemId: PROBLEM_ID,
    language: "Python",
    code: CURRENT_CODE,
  });
}

function codeHash(code: string) {
  return hashCodeForRun({ language: "Python", code });
}

function workspaceMetadata(currentCodeHash: string) {
  return JSON.stringify({ workspace: { currentCodeHash } });
}

function row(
  sequence: number,
  role: "user" | "assistant",
  contentMarkdown: string,
  hash?: string,
): StoredChatMessageForProjection {
  return {
    id: `message-${sequence}`,
    sequence,
    role,
    contentMarkdown,
    metadataJson: hash ? workspaceMetadata(hash) : "{}",
    reviewAttemptId: null,
    reviewAttempt: null,
  };
}

function decision(
  decisions: ReturnType<typeof project>["decisions"],
  sequence: number,
) {
  return decisions.find((item) => item.sequence === sequence);
}

function reasonCount(
  decisions: ReturnType<typeof project>["decisions"],
  reason: ReturnType<typeof project>["decisions"][number]["reason"],
) {
  return decisions.filter((item) => item.reason === reason).length;
}
