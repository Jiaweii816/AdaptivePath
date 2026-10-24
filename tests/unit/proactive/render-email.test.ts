import { describe, expect, it } from "vitest";
import { renderEmail } from "@/server/jobs/proactive/render-email";

describe("renderEmail", () => {
  it("renders an English template with LC numbers for weakness and practice problems", () => {
    const result = renderEmail({
      userId: "try",
      date: "2026-07-22",
      weaknesses: [
        {
          slotKey: "weakness_patterns",
          title: "Longest Substring Without Repeating Characters",
          summary: "The left pointer moved backward.",
          evidenceCount: 3,
          leetcodeNumber: 3,
        },
      ],
      recommended: [
        {
          problemId: "3",
          title: "Longest Substring Without Repeating Characters",
          reason: "Reinforce the sliding-window invariant.",
        },
      ],
    });

    expect(result.subject).toBe("PatternCoach Daily Review · 2026-07-22");
    expect(result.html).toContain("Recent Weakness Signals");
    expect(result.html).toContain(
      "LC 3 · Longest Substring Without Repeating Characters",
    );
    expect(result.html).toContain("Targeted Practice");
    expect(result.html).not.toContain("<!doctype html>");
    expect(result.text).toContain(
      "LC 3 · Longest Substring Without Repeating Characters",
    );
    expect(result.html).not.toMatch(/今日复习|薄弱模式|针对性练习/);
  });

  it("escapes every learner-controlled value in HTML", () => {
    const result = renderEmail({
      userId: "user",
      date: "2026-07-22",
      weaknesses: [
        {
          slotKey: "weakness",
          title: "<script>alert('x')</script>",
          summary: "A & B > C",
          evidenceCount: 1,
        },
      ],
      recommended: [
        {
          problemId: '3"><img src=x>',
          title: "<b>unsafe</b>",
          reason: 'because "quoted"',
        },
      ],
    });

    expect(result.html).not.toMatch(/<script>|<img|<b>unsafe/);
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("A &amp; B &gt; C");
    expect(result.html).toContain("&quot;");
    expect(result.html).toContain("&#39;");
  });

  it("omits empty sections when only one signal type is available", () => {
    const result = renderEmail({
      userId: "try",
      date: "2026-07-22",
      weaknesses: [],
      recommended: [
        { problemId: "1", title: "Two Sum", reason: "HashMap review" },
      ],
    });

    expect(result.html).not.toContain("Recent Weakness Signals");
    expect(result.html).toContain("Targeted Practice");
    expect(result.html).toContain("LC 1 · Two Sum");
  });
});
