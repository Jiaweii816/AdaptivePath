import { describe, expect, it } from "vitest";
import { classifyStrategistTodayScope } from "@/server/campaign/services/strategist-today-scope";

describe("Strategist deterministic Today scope", () => {
  it.each([
    "不要修改今天的任务，只调整明天以后",
    "保持 Today DailyTask 不变",
    "今天的任务不要替换",
    "只规划未来三天",
    "不修改今天，只做 What-if",
    "Do not change today's tasks; plan tomorrow and later",
  ])("allows a protective or future-route constraint: %s", (requestText) => {
    expect(classifyStrategistTodayScope(requestText)).toEqual({
      todayMutationRequested: false,
      todayTaskImmutable: true,
      scope: "future_route",
    });
  });

  it.each([
    "把今天的第一题换掉",
    "今天只做两题",
    "给今天再加一道题",
    "重新安排今天的任务",
    "Replace today's task",
    "Add another problem today",
  ])("rejects a real Today mutation: %s", (requestText) => {
    expect(classifyStrategistTodayScope(requestText)).toEqual({
      todayMutationRequested: true,
      todayTaskImmutable: true,
      scope: "unsupported_today_mutation",
    });
  });

  it("still rejects a mutation in a later clause after a protective clause", () => {
    expect(classifyStrategistTodayScope("不修改今天，但给今天再加一道题").todayMutationRequested).toBe(true);
  });
});
