import { describe, expect, it } from "vitest";
import { findAnswerLeaks } from "@/features/adaptivepath/coach/answer-leak-guard";
import { diffDraft, draftHash, draftState } from "@/features/adaptivepath/coach/draft";
import { findMemoryDisclosures, isMemoryDisclosureGuardEnabled } from "@/features/adaptivepath/coach/memory-disclosure-guard";
import { validateCoachReply } from "@/features/adaptivepath/coach/reply-contract";
import { describeLevel } from "@/features/adaptivepath/coach/wording";

const OPTIONS = [{ id: "A", text: "3/4" }, { id: "B", text: "0" }, { id: "C", text: "1/8" }, { id: "D", text: "1/2" }];
const leaks = (reply: string, quotedSpans: string[] = [], correctOption = "C") => findAnswerLeaks(reply, { correctOption, options: OPTIONS, quotedSpans });
const PAST = "Each offspring is half dominant so I multiplied the halves together carefully";
const disclosures = (reply: string, quotedSpans: string[] = [], pastExcerpts: string[] = [PAST]) => findMemoryDisclosures(reply, { pastExcerpts, quotedSpans });

describe("draft", () => {
  it("diffDraft reports D→A and reasoning change; null without previous", () => {
    expect(diffDraft({ selectedOption: "D", reasoning: "x" }, { selectedOption: "A", reasoning: "y" })).toEqual({ optionChanged: { from: "D", to: "A" }, reasoningChanged: true });
    expect(diffDraft({ selectedOption: "D", reasoning: "x" }, { selectedOption: "D", reasoning: "x" })).toEqual({ optionChanged: null, reasoningChanged: false });
    expect(diffDraft(null, { selectedOption: "D", reasoning: "x" })).toBeNull();
  });
  it("draftState and draftHash", () => {
    expect(draftState(null)).toBe("empty");
    expect(draftState({ selectedOption: null, reasoning: "  " })).toBe("empty");
    expect(draftState({ selectedOption: "A", reasoning: "" })).toBe("option_only");
    expect(draftState({ selectedOption: null, reasoning: "because" })).toBe("reasoning");
    const d = { selectedOption: "A", reasoning: "r" };
    expect(draftHash("q1", d)).toBe(draftHash("q1", { ...d }));
    expect(draftHash("q1", d)).not.toBe(draftHash("q1", { ...d, reasoning: "r2" }));
  });
});

describe("reply contract", () => {
  const ctx = { retrievedChunkIds: new Set(["c1"]), reasoning: "I think half are dominant.", requireCitation: false };
  it("accepts a valid reply", () => {
    expect(validateCoachReply({ reply: "Hi", citedChunkIds: ["c1"], quotedSpans: ["half are dominant"] }, ctx).reply).toBe("Hi");
  });
  it("rejects cited chunk not retrieved", () => {
    expect(() => validateCoachReply({ reply: "Hi", citedChunkIds: ["c2"], quotedSpans: [] }, ctx)).toThrow(expect.objectContaining({ code: "reply_contract" }));
  });
  it("rejects quoted span not in reasoning", () => {
    expect(() => validateCoachReply({ reply: "Hi", citedChunkIds: [], quotedSpans: ["all are dominant"] }, ctx)).toThrow(expect.objectContaining({ code: "reply_contract" }));
  });
  it("requireCitation rejects empty citations; schema rejects extra keys", () => {
    expect(() => validateCoachReply({ reply: "Hi", citedChunkIds: [], quotedSpans: [] }, { ...ctx, requireCitation: true })).toThrow(expect.objectContaining({ code: "reply_contract" }));
    expect(() => validateCoachReply({ reply: "Hi", citedChunkIds: [], quotedSpans: [], extra: 1 }, ctx)).toThrow(expect.objectContaining({ code: "reply_contract" }));
  });
});

describe("answer leak guard", () => {
  it.each(["答案是 C", "我会选 C。", "C 是对的", "D 不对哦", "The answer is C.", "option C is correct", "B is wrong here", "the probability is 1/8.", "So it is 1/8"])("flags %s", (reply) => {
    expect(leaks(reply).length).toBeGreaterThan(0);
  });
  it.each(["你选了 D，说说为什么？", "each offspring is 1/2", "Think about 0.5 per offspring", "DNA 正确复制", "What does option D assume?", "你选 C 的理由是什么？"])("allows %s", (reply) => {
    expect(leaks(reply)).toEqual([]);
  });
  it("short correct text matches only as a whole token", () => {
    expect(leaks("Think about 0.5 per offspring", [], "B")).toEqual([]);
    expect(leaks("Expect 0 recessive offspring", [], "B").length).toBeGreaterThan(0);
  });
  it("allows the correct text inside a quoted student span", () => {
    expect(leaks("你写了“I got 1/8 overall”，哪一步最关键？", ["I got 1/8 overall"])).toEqual([]);
  });
});

describe("memory disclosure guard", () => {
  it.each([
    "你的测交是 Not yet。", "测交：Tutor 辅助", "you are at level 2", "现在是 L3", "这个概念你在独立档", "你的档位还不够",
    "your stability is high", "稳定度还低", "S = 70", "see b2e-12-2-q-c04-medium-01", "concept b2e-12-2-concept-04", "rule bio-l2-v1",
    "that was a counter_down", "根据你的记录，你需要练习", "your record shows a gap", "you previously answered B", "上次你写的是",
    "As you said before: each offspring is half dominant so I multiplied",
  ])("flags %s", (reply) => {
    expect(disclosures(reply).length).toBeGreaterThan(0);
  });
  it.each(["Three independent offspring", "Not yet sure? Try a Punnett square.", "单因子杂交比较扎实，测交还可以多练", "Support your claim with the textbook", "Look up the reference passage"])("allows %s", (reply) => {
    expect(disclosures(reply)).toEqual([]);
  });
  it("overlap from the current draft quote is exempt", () => {
    expect(disclosures(`You wrote “${PAST}”. Why multiply?`, [PAST])).toEqual([]);
  });
  it("empty past excerpts never match", () => {
    expect(disclosures("Any reply at all, long enough to overlap something.", [], ["", " "])).toEqual([]);
  });
  it("describeLevel output never matches", () => {
    for (const level of [0, 1, 2, 3, null] as const) expect(disclosures(`测交 ${describeLevel(level)}`, [], [])).toEqual([]);
  });
  it("guard switch off only for \"off\"", () => {
    expect(isMemoryDisclosureGuardEnabled({})).toBe(true);
    expect(isMemoryDisclosureGuardEnabled({ ADAPTIVEPATH_MEMORY_DISCLOSURE_GUARD: "0" })).toBe(true);
    expect(isMemoryDisclosureGuardEnabled({ ADAPTIVEPATH_MEMORY_DISCLOSURE_GUARD: "off" })).toBe(false);
  });
});
