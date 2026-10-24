import { describe, expect, it } from "vitest";

import { buildClassifierMessages } from "@/server/agents/coach-agent/turn-classifier/classifier-prompt";

const context = {
  message: "Have I made this mistake before?",
  projection: "user: I had an off-by-one bug",
  workspace: {
    language: "Python" as const,
    codeState: "formed" as const,
    currentCodeLength: 80,
    selectedTestCount: 2,
    hasAssistantCandidate: false,
  },
};

describe("turn classifier prompt", () => {
  it("constrains JSON, dependencies, Python scope, negation, and persistence", () => {
    const messages = buildClassifierMessages(context);
    const system = messages[0]?.content;
    const user = messages[1]?.content;

    expect(system).toEqual(expect.stringContaining("0..6"));
    expect(system).toEqual(expect.stringContaining("canonical id opN"));
    expect(system).toEqual(expect.stringContaining("Python-only"));
    expect(system).toEqual(expect.stringContaining("execution is negated"));
    expect(system).toEqual(expect.stringContaining("persist is only a proposal"));
    expect(system).toEqual(expect.stringContaining('"operations":[]'));
    expect(JSON.parse(String(user))).toEqual({
      revisionSafeProjection: context.projection,
      workspace: context.workspace,
      currentMessage: context.message,
    });
  });

  it("separates algorithm-mechanism questions from current-code diagnosis", () => {
    const system = systemPrompt();

    expect(system).toContain(
      "A mechanism, invariant, boundary, or why/why-not algorithm question is answer:concept",
    );
    expect(system).toContain(
      "diagnose only when the user asks what is wrong in their current code or approach",
    );
    expect(system).toContain(
      "单调栈里的元素一旦弹出，为什么不用放回去？",
    );
    expect(system).toContain(
      '"family":"answer","target":"concept","topic":"concept"',
    );
    expect(system).not.toContain(
      "重复字符都跑到窗口左边了，为什么不能还更新 left？",
    );
  });

  it("spells out validator-legal family, topic, and dependency shapes", () => {
    const system = systemPrompt();

    expect(system).toContain(
      "answer -> current_user_code | assistant_candidate | current_approach | active_problem | concept | contextual_referent | unspecified",
    );
    expect(system).toContain(
      "lookup_api -> api_object | knowledge_handbook",
    );
    expect(system).toContain(
      "topic is legal only on answer (concept|general) or lookup_api (api)",
    );
    expect(system).toContain(
      "dependsOn must be [] unless the operation's own source clause is explicitly introduced by then/然后/再",
    );
  });

  it("anchors active-problem hints without turning durable preferences into hints", () => {
    const system = systemPrompt();

    expect(system).toContain(
      "A small hint, next-step hint, clue, or no-answer request for the active problem is answer:active_problem with deliveryMode:hint",
    );
    expect(system).toContain(
      "A durable future no-full-solution preference is persist:preference with deliveryMode:direct",
    );
    expect(system).toContain(
      "合并区间这题先给我一个小提示，不要直接说完整做法。",
    );
    expect(system).toContain(
      '"family":"answer","target":"active_problem","dependsOn":[]',
    );
    expect(system).toContain('"deliveryMode":"hint"');
    expect(system).toContain(
      "以后教学时默认别直接贴最终解法，把这个偏好记住。",
    );
    expect(system).not.toContain("Two Sum 给点提示就好，别直接答案。");
    expect(system).not.toContain("Search Insert 我卡住了，给我一小步提示。");
  });
});

function systemPrompt() {
  return String(buildClassifierMessages(context)[0]?.content);
}
