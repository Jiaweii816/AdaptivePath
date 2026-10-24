import { describe, expect, it, vi } from "vitest";
import {
  searchInterviewVariantCandidatesChatTool,
} from "@/server/tools/chat-tools/search-interview-variant-candidates-tool";

const context = {
  problem: { title: "Two Sum", slug: "two-sum", leetcodeNumber: 1 },
  problemTags: ["Hashmap"],
  learnerWeaknessCues: ["状态同步", "删除边界"],
};

describe("search_interview_variant_candidates", () => {
  it("degrades safely when Tavily is not configured", async () => {
    const fetcher = vi.fn();
    const result = await searchInterviewVariantCandidatesChatTool({}, context, {
      apiKey: "",
      fetcher,
      now: new Date("2026-08-20T12:00:00.000Z"),
    });

    expect(result.status).toBe("disabled");
    expect(result.candidates).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses a title-first 15-result search without leaking weakness cues", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "A hash-map interview follow-up",
              url: "https://example.com/interview/two-sum",
              content: "A useful Two Sum variant with a sorted input.",
              score: 0.82,
            },
            {
              title: "Ignored",
              url: "javascript:alert(1)",
              content: "unsafe URL",
            },
            {
              title: "Duplicate URL",
              url: "https://example.com/interview/two-sum",
              content: "This should not create another candidate.",
            },
            {
              title: "3Sum interview variant",
              url: "https://example.net/three-sum",
              content: "A Two Sum follow-up that should remain excluded as Hot-150.",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await searchInterviewVariantCandidatesChatTool(
      { company: "Stripe", focus: "sorted input" },
      context,
      {
        apiKey: "test-key",
        fetcher,
        now: new Date("2026-08-20T12:00:00.000Z"),
      },
    );

    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request.start_date).toBe("2024-08-20");
    expect(request.max_results).toBe(15);
    expect(request.query).toContain('"Two Sum"');
    expect(request.query).toContain('"LC 1"');
    expect(request).not.toHaveProperty("end_date");
    expect(JSON.stringify(request)).not.toContain("状态同步");
    expect(JSON.stringify(request)).not.toContain("删除边界");
    expect(result.status).toBe("success");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      sourceHost: "example.com",
      relevanceScore: 0.82,
    });
    expect(result.candidates[0]?.matchedSignals).toEqual(
      expect.arrayContaining(["active title", "variation cue"]),
    );
    expect(result.weaknessCues).toEqual(["状态同步", "删除边界"]);
  });

  it("falls back to the active mechanism only when title retrieval is unhelpful", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Two Sum - LeetCode",
                url: "https://leetcode.com/problems/two-sum/",
                content: "The original Hot-150 problem.",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Configurable pair lookup interview variant",
                url: "https://example.org/pair-lookup",
                content:
                  "This hash map follow-up changes the lookup constraint and asks for a trade-off.",
                score: 0.71,
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await searchInterviewVariantCandidatesChatTool({}, context, {
      apiKey: "test-key",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(first.query).toContain('"Two Sum"');
    expect(second.query).not.toContain("Two Sum");
    expect(second.query).toMatch(/hashmap/i);
    expect(result.retrievalStage).toBe("mechanism_fallback");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.snippet.length).toBeLessThanOrEqual(220);
  });

  it("projects at most three compact candidates into the tool result", async () => {
    const results = Array.from({ length: 4 }, (_, index) => ({
      title: `External interview follow-up ${index + 1}`,
      url: `https://example${index}.org/variant`,
      content: `Two Sum variant ${"with a changed constraint ".repeat(30)}`,
      score: 0.9 - index / 100,
    }));
    const result = await searchInterviewVariantCandidatesChatTool({}, context, {
      apiKey: "test-key",
      fetcher: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results }), { status: 200 }),
      ),
    });

    expect(result.retrievalStage).toBe("exact_title");
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((candidate) => candidate.title.length <= 140)).toBe(true);
    expect(result.candidates.every((candidate) => candidate.snippet.length <= 220)).toBe(true);
    expect(result.candidates.every((candidate) => candidate.url.length <= 512)).toBe(true);
  });

  it("maps provider throttling and quota statuses without throwing", async () => {
    for (const [httpStatus, expected] of [
      [429, "rate_limited"],
      [432, "quota_exceeded"],
    ] as const) {
      const result = await searchInterviewVariantCandidatesChatTool({}, context, {
        apiKey: "test-key",
        fetcher: vi.fn().mockResolvedValue(new Response("{}", { status: httpStatus })),
      });
      expect(result.status).toBe(expected);
      expect(result.candidates).toEqual([]);
    }
  });
});
