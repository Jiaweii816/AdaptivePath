import { describe, expect, it } from "vitest";

import {
  buildClassifierBackendFacts,
  buildClassifierContext,
  CLASSIFIER_PROJECTION_CHAR_LIMIT,
  hasSameRevisionAssistantCandidate,
  serializeClassifierProjection,
} from "@/server/agents/coach-agent/turn-classifier/chat-turn-classifier-context";
import {
  projectCurrentRevisionWindow,
  type StoredChatMessageForProjection,
} from "@/server/agents/coach-agent/history-projection";
import { buildWorkspaceCodeRevision } from "@/server/agents/coach-agent/workspace-revision";
import { hashCodeForRun } from "@/server/code/code-hash";
import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

const PROBLEM_ID = "two-sum";
const CURRENT_CODE = [
  "class Solution:",
  "    def twoSum(self, nums, target):",
  "        return [0, 1]",
].join("\n");
const OLD_CODE = `${CURRENT_CODE}\n# old`;

describe("classifier revision-safe projection", () => {
  it("anchors a candidate only in the retained same-revision assistant window", () => {
    const projection = project([
      row(1, "assistant", candidate("old"), codeHash(OLD_CODE)),
      row(2, "assistant", candidate("unknown")),
      row(3, "user", "Run your last version", codeHash(CURRENT_CODE)),
      row(4, "assistant", candidate("current"), codeHash(CURRENT_CODE)),
    ]);

    expect(projection.messages.map(({ content }) => content)).toEqual([
      `⟨针对更早的代码版本⟩ ${candidate("old")}`,
      `⟨代码版本未知；仅作对话连续性⟩ ${candidate("unknown")}`,
      "Run your last version",
      candidate("current"),
    ]);
    expect(hasSameRevisionAssistantCandidate(projection)).toBe(true);
    expect(serializeClassifierProjection(projection)).toContain(
      "⟨针对更早的代码版本⟩",
    );
    expect(serializeClassifierProjection(projection)).toContain(
      "⟨代码版本未知；仅作对话连续性⟩",
    );
  });

  it("does not treat an ordinary same-revision explanation as code candidate", () => {
    const projection = project([
      row(1, "assistant", "Try moving left after the duplicate.", codeHash(CURRENT_CODE)),
    ]);

    expect(hasSameRevisionAssistantCandidate(projection)).toBe(false);
  });

  it("bounds the serialized projection and retains its newest suffix", () => {
    const projection = project(
      Array.from({ length: 8 }, (_, index) =>
        row(
          index + 1,
          "user",
          `${index === 7 ? "NEWEST" : `turn-${index}`} ${"x".repeat(900)}`,
          codeHash(CURRENT_CODE),
        ),
      ),
    );
    const serialized = serializeClassifierProjection(projection);

    expect(serialized.length).toBeLessThanOrEqual(
      CLASSIFIER_PROJECTION_CHAR_LIMIT,
    );
    expect(serialized).toContain("NEWEST");
    expect(serialized).not.toContain("turn-0");
  });
});

describe("classifier lightweight workspace", () => {
  it("contains metadata and candidate anchor without raw code", () => {
    const secret = "SECRET_RAW_CODE_SENTINEL";
    const projection = project([
      row(1, "assistant", candidate("current"), codeHash(CURRENT_CODE)),
    ]);
    const context = buildClassifierContext({
      message: "Run your candidate again",
      projection,
      language: "Python",
      code: `${CURRENT_CODE}\n# ${secret}`,
      selectedTestCount: 2,
    });

    expect(context.workspace).toEqual({
      language: "Python",
      codeState: "formed",
      currentCodeLength: `${CURRENT_CODE}\n# ${secret}`.length,
      selectedTestCount: 2,
      hasAssistantCandidate: true,
    });
    expect(JSON.stringify(context.workspace)).not.toContain(secret);
    expect(context.projection).toContain("class Solution");
  });
});

describe("classifier authoritative backend facts", () => {
  it("uses real language, code/candidate existence, and all granted durable tools", () => {
    const context = buildClassifierContext({
      message: "save these",
      projection: project([
        row(1, "assistant", candidate("current"), codeHash(CURRENT_CODE)),
      ]),
      language: "Python",
      code: CURRENT_CODE,
      selectedTestCount: 0,
    });

    expect(
      buildClassifierBackendFacts({
        message: context.message,
        workspace: context.workspace,
        requestedActions: durableActions(),
      }),
    ).toEqual({
      workspaceLanguage: "Python",
      hasCurrentCode: true,
      hasAssistantCandidate: true,
      deniedExecutionTargets: [],
      grantedExecutionTargets: [],
      grantedDurableTools: [
        "note_memory",
        "save_knowledge_note",
        "save_mistake_book_entry",
      ],
    });
  });

  it.each([
    ["Don't run my current code; explain it.", ["current_user_code"]],
    ["Don't run your candidate; explain it.", ["assistant_candidate"]],
    ["不要运行任何代码，只解释。", ["current_user_code", "assistant_candidate"]],
    ["Explain it without running it.", ["current_user_code"]],
    ["Dry run this by hand.", ["current_user_code"]],
    ["手动模拟一下这段代码。", ["current_user_code"]],
    ["abba 这组我手算不稳，当前代码到底会吐多少？", []],
    ["Use O(1) extra space without extra allocation, then run my code.", []],
    ['stderr says "do not run this command"; run my code.', []],
  ] as const)("scopes execution control: %s", (message, denied) => {
    expect(
      buildClassifierBackendFacts({
        message,
        workspace: {
          language: "Python",
          codeState: "formed",
          currentCodeLength: 20,
          selectedTestCount: 0,
          hasAssistantCandidate: true,
        },
        requestedActions: [],
      }).deniedExecutionTargets,
    ).toEqual(denied);
  });
});

function durableActions(): RequestedAction[] {
  return ["note_memory", "save_knowledge_note", "save_mistake_book_entry"].map(
    (toolName, order) => ({
      toolName: toolName as RequestedAction["toolName"],
      order,
      decision: "granted" as const,
      evidence: [],
    }),
  );
}

function project(storedMessages: StoredChatMessageForProjection[]) {
  return projectCurrentRevisionWindow({
    storedMessages,
    currentRevision: buildWorkspaceCodeRevision({
      problemId: PROBLEM_ID,
      language: "Python",
      code: CURRENT_CODE,
    }),
    clearedBeforeSequence: 0,
    maxModelMessages: 8,
  });
}

function candidate(label: string) {
  return `Candidate ${label}:\n\n\`\`\`python\nclass Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]\n\`\`\``;
}

function codeHash(code: string) {
  return hashCodeForRun({ language: "Python", code });
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
    metadataJson: hash
      ? JSON.stringify({ workspace: { currentCodeHash: hash } })
      : "{}",
    reviewAttemptId: null,
    reviewAttempt: null,
  };
}
