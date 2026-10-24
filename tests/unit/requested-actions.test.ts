import { describe, expect, it } from "vitest";
import { DURABLE_WRITE_TOOL_NAMES } from "@/server/tools/chat-tools/durable-write-types";
import {
  DURABLE_WRITE_REGISTRY,
  getDurableWriteDisplayName,
  normalizeActionText,
  resolvePendingConfirmation,
  resolveRequestedActions,
  splitRequestedActionClauses,
  type PendingRequestedAction,
  type RequestedAction,
} from "@/server/tools/chat-tools/requested-actions";

function decisions(message: string) {
  return resolveRequestedActions(message).map(({ toolName, decision }) => ({
    toolName,
    decision,
  }));
}

function pending(actions: RequestedAction[]): PendingRequestedAction[] {
  return actions.map(({ toolName, order, evidence }) => ({
    toolName,
    order,
    evidence,
  }));
}

describe("requested durable actions", () => {
  it("keeps the registry exhaustive and owns durable display names", () => {
    expect(Object.keys(DURABLE_WRITE_REGISTRY).sort()).toEqual(
      [...DURABLE_WRITE_TOOL_NAMES].sort(),
    );
    expect(getDurableWriteDisplayName("note_memory", "zh")).toBe("长期偏好");
    expect(getDurableWriteDisplayName("save_knowledge_note", "en")).toBe(
      "Knowledge Handbook",
    );
    expect(getDurableWriteDisplayName("save_mistake_book_entry", "zh")).toBe(
      "错题本",
    );
  });

  it("normalizes full-width aliases while preserving original source offsets", () => {
    const original = "前缀 Ｋｎｏｗｌｅｄｇｅ－Ｂｏｏｋ 后缀";
    const view = normalizeActionText(original);

    expect(view.normalized).toBe("前缀 knowledge-book 后缀");
    expect(view.compact).toBe("前缀knowledgebook后缀");
    const compactStart = view.compact.indexOf("knowledgebook");
    const sourceStart = view.compactToOriginal[compactStart]?.start;
    const sourceEnd = view.compactToOriginal[compactStart + 12]?.end;
    expect(original.slice(sourceStart, sourceEnd)).toBe(
      "Ｋｎｏｗｌｅｄｇｅ－Ｂｏｏｋ",
    );
  });

  it("splits clauses without losing their original positions", () => {
    const message = "  请保存错题本。也把它放进 knowledge book，最后解释一下  ";
    const clauses = splitRequestedActionClauses(message);

    expect(clauses.map((clause) => clause.text)).toEqual([
      "请保存错题本",
      "也把它放进 knowledge book",
      "最后解释一下",
    ]);
    for (const clause of clauses) {
      expect(message.slice(clause.start, clause.end)).toBe(clause.text);
    }
  });

  it("grants both durable tools in the incident message in source order", () => {
    const message =
      "请你帮我把这个“向零截断”放进 mistakebook 做成笔记。也把 Python 里 int(num2 / num1) 这个向零截断语法记录进 knowledge book。";
    const result = resolveRequestedActions(message);

    expect(
      result.map(({ toolName, decision }) => ({ toolName, decision })),
    ).toEqual([
      { toolName: "save_mistake_book_entry", decision: "granted" },
      { toolName: "save_knowledge_note", decision: "granted" },
    ]);
    expect(result[0].order).toBeLessThan(result[1].order);
    expect(result[0].evidence[0]).toMatchObject({
      matchedTarget: "mistakebook",
      matchedAction: "放进",
      exclusionId: null,
    });
    expect(result[1].evidence[0]).toMatchObject({
      matchedTarget: "knowledge book",
      matchedAction: "记录",
      exclusionId: null,
    });
  });

  it.each([
    ["帮我把这个添加到 knowledge book 里", "save_knowledge_note"],
    ["也把这个语法记录进知识手册", "save_knowledge_note"],
    ["这个也存一下手册吧", "save_knowledge_note"],
    ["能不能帮我存进错题本？", "save_mistake_book_entry"],
    ["请把刚才这个错误收进错题本", "save_mistake_book_entry"],
    ["请把刚才这个错误收入错题本", "save_mistake_book_entry"],
    ["请把这个 deque 用法收进 knowledge book", "save_knowledge_note"],
    ["请把这个 deque 用法收入knowledge book", "save_knowledge_note"],
  ] as const)("recognizes explicit request: %s", (message, toolName) => {
    expect(decisions(message)).toEqual([{ toolName, decision: "granted" }]);
  });

  it("grants the reported mistake-book request including its self-check clause", () => {
    expect(
      decisions(
        "请把刚才这个 connect[cur] 的 KeyError 错误收进错题本，并加一个自测问题。",
      ),
    ).toEqual([
      { toolName: "save_mistake_book_entry", decision: "granted" },
    ]);
  });

  it("does not treat ordinary income wording as a durable write", () => {
    expect(
      resolveRequestedActions("请解释一下 knowledge book 的收入来源"),
    ).toMatchObject([
      {
        toolName: "save_knowledge_note",
        decision: "denied",
        evidence: [{ matchedAction: null, exclusionId: "E6" }],
      },
    ]);
  });

  it("binds local negation to one target without suppressing another", () => {
    expect(decisions("不要存错题本，但保存到 knowledge book")).toEqual([
      { toolName: "save_mistake_book_entry", decision: "denied" },
      { toolName: "save_knowledge_note", decision: "granted" },
    ]);
    expect(decisions("不要存错题本并保存到 knowledge book")).toEqual([
      { toolName: "save_mistake_book_entry", decision: "denied" },
      { toolName: "save_knowledge_note", decision: "granted" },
    ]);
  });

  it.each([
    ["如果我让你保存到 knowledge book 会怎样", "E2"],
    ["解释一下 knowledge book 是什么", "E6"],
    ["保存到知识手册有什么用", "E6"],
    ["为什么要把它存进错题本", "E6"],
    ["你会自动保存到 knowledge book 吗", "E6"],
    ["我以为你会保存到知识手册", "E7"],
    ["我之前把这题存进错题本了吗", "E3"],
    ["错题本里有几道题", "E4"],
    ["看看我的错题本", "E5"],
  ] as const)("denies excluded discussion: %s", (message, exclusionId) => {
    const result = resolveRequestedActions(message);
    expect(result).toHaveLength(1);
    expect(result[0].decision).toBe("denied");
    expect(result[0].evidence[0].exclusionId).toBe(exclusionId);
  });

  it("records a high-confidence implicit future preference", () => {
    const result = resolveRequestedActions("以后别给我完整解法");

    expect(result).toMatchObject([
      {
        toolName: "note_memory",
        decision: "granted",
        evidence: [
          {
            matchedTarget: null,
            requestPatternId: "implicit_preference",
            exclusionId: null,
          },
        ],
      },
    ]);
  });

  it.each([
    "以后先给我一个下一步，解释短点。",
    "之后我英文问的话，标题也用英文就行。",
    "我更吃手动走例子那种，别一上来贴代码。",
  ])("grants a natural but explicit learner preference: %s", (message) => {
    expect(decisions(message)).toEqual([
      { toolName: "note_memory", decision: "granted" },
    ]);
  });

  it.each([
    "heapq 这个最大堆写法我老忘，放复习里吧。",
    "deque 队列最小模板也给我留到手册里。",
    "C++ 最小堆声明老错，这个以后也放手册。",
    "滑窗那个 left 只往前的模板，我想之后复习能看到。",
  ])("grants an explicit natural handbook save: %s", (message) => {
    expect(decisions(message)).toEqual([
      { toolName: "save_knowledge_note", decision: "granted" },
    ]);
  });

  it.each([
    ["如果以后别给我完整解，会怎样", "E2"],
    ["我以为你说过以后都用 Python", "E7"],
  ] as const)(
    "does not turn a hypothetical or reported preference into a write: %s",
    (message, exclusionId) => {
      const result = resolveRequestedActions(message);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        toolName: "note_memory",
        decision: "denied",
        evidence: [{ exclusionId }],
      });
    },
  );

  it("treats a first-person completed write as history, not a new command", () => {
    expect(decisions("我把这个保存到知识手册了")).toEqual([
      { toolName: "save_knowledge_note", decision: "denied" },
    ]);
  });

  it("keeps target-only and non-imperative write statements conservative", () => {
    expect(decisions("这个知识点挺重要的，手册里好像没有")).toEqual([
      { toolName: "save_knowledge_note", decision: "needs_confirmation" },
    ]);
    expect(decisions("这个语法值得保存到知识手册")).toEqual([
      { toolName: "save_knowledge_note", decision: "needs_confirmation" },
    ]);
    expect(resolveRequestedActions("这题太难了，先解释一下算法")).toEqual([]);
  });

  it("turns conflicting clauses for the same tool into confirmation", () => {
    const result = resolveRequestedActions(
      "不要保存到知识手册。也把这个新语法保存到知识手册。",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      toolName: "save_knowledge_note",
      decision: "needs_confirmation",
    });
    expect(result[0].evidence).toHaveLength(2);
    expect(result[0].evidence.map((item) => item.exclusionId)).toEqual([
      "E1",
      null,
    ]);
  });

  it("recognizes normalized alias variants without corrupting evidence", () => {
    const result = resolveRequestedActions(
      "请把这条添加到 Ｋｎｏｗｌｅｄｇｅ－Ｂｏｏｋ 里",
    );

    expect(result).toMatchObject([
      {
        toolName: "save_knowledge_note",
        decision: "granted",
        evidence: [
          {
            matchedTarget: "Ｋｎｏｗｌｅｄｇｅ－Ｂｏｏｋ",
            matchedAction: "添加",
          },
        ],
      },
    ]);
  });

  it("ignores action-like strings inside fenced Markdown code", () => {
    const message = [
      "The examples are:",
      "```text",
      "run current code",
      "save to knowledge book",
      "```",
      "Explain why they are different.",
    ].join("\n");

    expect(resolveRequestedActions(message)).toEqual([]);
  });

  it("ignores action-like strings inside inline Markdown code", () => {
    expect(
      resolveRequestedActions(
        "Compare `run current code` with `save to knowledge book`.",
      ),
    ).toEqual([]);
  });

  it("keeps real prose immediately before and after fenced code in source order", () => {
    const message = [
      "Please save this to the mistake book.",
      "```text",
      "run current code",
      "save to knowledge book",
      "```",
      "Please save this to the knowledge book.",
    ].join("\n");
    const result = resolveRequestedActions(message);

    expect(
      result.map(({ toolName, decision }) => ({ toolName, decision })),
    ).toEqual([
      { toolName: "save_mistake_book_entry", decision: "granted" },
      { toolName: "save_knowledge_note", decision: "granted" },
    ]);
    expect(result[0].order).toBe(message.indexOf("save"));
    expect(result[1].order).toBe(message.lastIndexOf("save"));
    expect(result[0].evidence[0].clause).toBe(
      "Please save this to the mistake book.",
    );
    expect(result[1].evidence[0].clause).toBe(
      "Please save this to the knowledge book.",
    );
  });

  it("keeps a real prose request around inline code at its exact source offset", () => {
    const message =
      "Please save `run current code` to the knowledge book, then explain it.";
    const result = resolveRequestedActions(message);

    expect(result).toMatchObject([
      {
        toolName: "save_knowledge_note",
        decision: "granted",
        order: message.indexOf("save"),
        evidence: [
          {
            clause: message.slice(0, message.indexOf(",")),
            matchedTarget: "knowledge book",
            matchedAction: "save",
          },
        ],
      },
    ]);
  });
});

describe("one-turn pending durable-action confirmation", () => {
  const knowledgePending = pending(
    resolveRequestedActions("这个知识点挺重要的，手册里好像没有"),
  );
  const twoPending = pending([
    ...resolveRequestedActions("错题本里好像没有"),
    ...resolveRequestedActions("手册里好像没有"),
  ]);

  it("promotes an exact short confirmation when only one action is pending", () => {
    expect(
      resolvePendingConfirmation({
        message: "好的。",
        pending: knowledgePending,
      }),
    ).toEqual({
      disposition: "confirmed",
      promotedTools: ["save_knowledge_note"],
      rejectedTools: [],
      unresolvedTools: [],
    });
  });

  it("does not apply an unqualified confirmation to multiple pending actions", () => {
    expect(
      resolvePendingConfirmation({ message: "好的", pending: twoPending }),
    ).toMatchObject({
      disposition: "ambiguous",
      promotedTools: [],
      unresolvedTools: ["save_mistake_book_entry", "save_knowledge_note"],
    });
  });

  it("promotes all pending actions only with an exact all-target confirmation", () => {
    expect(
      resolvePendingConfirmation({ message: "两个都要", pending: twoPending }),
    ).toMatchObject({
      disposition: "confirmed",
      promotedTools: ["save_mistake_book_entry", "save_knowledge_note"],
      unresolvedTools: [],
    });
  });

  it("does not treat a longer answer beginning with 好的 as confirmation", () => {
    expect(
      resolvePendingConfirmation({
        message: "好的，不过先解释一下",
        pending: knowledgePending,
      }),
    ).toEqual({
      disposition: "discarded",
      promotedTools: [],
      rejectedTools: [],
      unresolvedTools: [],
    });
  });

  it("lets an explicit target disambiguate and gives an explicit refusal precedence", () => {
    expect(
      resolvePendingConfirmation({
        message: "把知识手册那条保存吧",
        pending: twoPending,
      }),
    ).toMatchObject({
      disposition: "confirmed",
      promotedTools: ["save_knowledge_note"],
      unresolvedTools: ["save_mistake_book_entry"],
    });

    expect(
      resolvePendingConfirmation({ message: "算了", pending: twoPending }),
    ).toMatchObject({
      disposition: "rejected",
      rejectedTools: ["save_mistake_book_entry", "save_knowledge_note"],
      unresolvedTools: [],
    });
  });

  it("discards pending state on a topic change", () => {
    expect(
      resolvePendingConfirmation({
        message: "先讲讲栈为什么适合这道题",
        pending: knowledgePending,
      }),
    ).toMatchObject({
      disposition: "discarded",
      promotedTools: [],
      unresolvedTools: [],
    });
  });
});
