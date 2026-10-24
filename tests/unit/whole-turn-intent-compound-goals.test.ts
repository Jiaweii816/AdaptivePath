import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";

const WORKSPACE = {
  workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
} as const;

describe("compound goals in one clause", () => {
  const message = "推荐两道能让我理解二分边界为什么这么写的题";

  it("keeps both the recommendation and the explanation", () => {
    const requests = compileTurnUnderstandingV2(message, WORKSPACE).requests.filter(
      (request) => request.kind === "respond",
    );

    expect(requests.map((request) => request.deliverable)).toEqual([
      "understand",
      "recommend",
    ]);
  });

  it("orders the explanation before the recommendation it motivates", () => {
    const requests = compileTurnUnderstandingV2(message, WORKSPACE).requests;
    const recommend = requests.find(
      (request) => request.kind === "respond" && request.deliverable === "recommend",
    );

    expect(recommend?.dependsOn.length).toBeGreaterThan(0);
  });
});
