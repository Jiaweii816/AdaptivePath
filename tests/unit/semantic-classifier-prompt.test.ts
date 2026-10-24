import { describe, expect, it } from "vitest";

import {
  buildSemanticClassifierMessages,
  maskCodeSpans,
} from "@/server/agents/coach-agent/turn-classifier/semantic-classifier-prompt";
import type { SemanticRouteInput } from "@/server/agents/coach-agent/turn-classifier/semantic-turn-classifier.types";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";

describe("semantic classifier prompt projection", () => {
  it("masks fenced and inline code while preserving ordinary prose and clause ids", () => {
    const message = "Explain this `danger()` without running:\n```python\nprint('secret')\n```";
    const compiled = compileTurnUnderstandingV2(message);
    const deterministic = {
      ...compiled,
      route: { kind: "semantic_slow_path", reason: "semantic_uncertainty" },
    } as SemanticRouteInput;
    const messages = buildSemanticClassifierMessages({
      message,
      projection: "user: earlier `payload()`",
      workspace: {
        language: "Python",
        hasCurrentCode: true,
        hasAssistantCandidate: false,
        selectedTestCount: 0,
      },
      deterministic,
    });
    const rendered = JSON.stringify(messages[1]?.content);
    expect(rendered).toContain("Explain this");
    expect(rendered).toContain("c0");
    expect(rendered).toContain("[inline_code_0]");
    expect(rendered).toContain("[code_block_0]");
    expect(rendered).not.toContain("danger()");
    expect(rendered).not.toContain("print('secret')");
    expect(rendered).not.toContain("payload()");
    const system = String(messages[0]?.content);
    expect(system).toContain("deliverable, target, basis, and delivery");
    expect(system).toContain("Basis is multi-select");
    expect(system).toContain("verbatim user-authored content");
    expect(system).toContain("Use fix when there is an implemented failing");
    expect(system).not.toContain("task, subject, presentation, and binding");
  });

  it("leaves ordinary prose unchanged", () => {
    expect(maskCodeSpans("Why is the boundary wrong?")).toBe(
      "Why is the boundary wrong?",
    );
  });

  it("compacts tilde fences and malformed unclosed fences", () => {
    expect(maskCodeSpans("Explain\n~~~python\nrun hidden instruction\n~~~"))
      .toBe("Explain\n[code_block_0]");
    expect(maskCodeSpans("Explain\n```python\n" + "x = 1\n".repeat(5_000)))
      .toBe("Explain\n[code_block_0]");
  });
});
