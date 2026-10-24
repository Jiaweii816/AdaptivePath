import { describe, expect, it } from "vitest";
import {
  buildManualProvenanceManifest,
  parseManualProvenanceReviewMarkdown,
} from "@/server/memory/replay/manual-provenance-review";

describe("manual provenance review", () => {
  it("parses human checkbox variants and problem-level batch decisions", () => {
    const decisions = parseManualProvenanceReviewMarkdown(`
## LC 1 · Two Sum

> batch
<!-- patterncoach-provenance-batch leetcodeNumber="1" classification="Development" clusterCount="2" -->

### 活动 1/2 · 2026-06-01 10:00
<!-- patterncoach-provenance-review reviewAttemptId="review-1" chatSessionId="session-1" currentOrigin="legacy_unknown" -->
- [ ] Learner
- [ ] Development
- [ ] Evaluation/Test
- [ ] Unsure

### 活动 2/2 · 2026-06-01 09:00
<!-- patterncoach-provenance-review reviewAttemptId="review-2" chatSessionId="session-1" currentOrigin="legacy_unknown" -->
- [ ] Learner
- [1] Development
- [ ] Evaluation/Test
- [ ] Unsure

## LC 101 · Symmetric Tree

### 活动 1/1 · 2026-06-02 10:00
<!-- patterncoach-provenance-review reviewAttemptId="review-3" chatSessionId="session-2" currentOrigin="legacy_unknown" -->
- [ 1] Learner
- [ ] Development
- [ ] Evaluation/Test
- [ ] Unsure
`);

    expect(decisions.map((decision) => decision.classification)).toEqual([
      "development",
      "development",
      "learner",
    ]);
    expect(decisions.map((decision) => decision.decisionSource)).toEqual([
      "problem_batch",
      "problem_batch",
      "activity_checkbox",
    ]);
  });

  it("fails closed for an unclassified activity", () => {
    expect(() =>
      parseManualProvenanceReviewMarkdown(`
## LC 2 · Add Two Numbers
### 活动 1/1 · 2026-06-01 10:00
<!-- patterncoach-provenance-review reviewAttemptId="review-1" chatSessionId="session-1" currentOrigin="legacy_unknown" -->
- [ ] Learner
- [ ] Development
- [ ] Evaluation/Test
- [ ] Unsure
`),
    ).toThrow("must have exactly one classification");
  });

  it("builds a deterministic decision fingerprint", () => {
    const markdown = `
## LC 101 · Symmetric Tree
### 活动 1/1 · 2026-06-02 10:00
<!-- patterncoach-provenance-review reviewAttemptId="review-3" chatSessionId="session-2" currentOrigin="legacy_unknown" -->
- [1] Learner
- [ ] Development
- [ ] Evaluation/Test
- [ ] Unsure
`;
    const first = buildManualProvenanceManifest({
      learnerHandle: "try",
      markdown,
      generatedAt: new Date("2026-07-20T00:00:00.000Z"),
    });
    const second = buildManualProvenanceManifest({
      learnerHandle: "try",
      markdown,
      generatedAt: new Date("2026-07-21T00:00:00.000Z"),
    });

    expect(first.counts).toEqual({
      total: 1,
      learner: 1,
      development: 0,
      evaluation: 0,
      test: 0,
      unsure: 0,
    });
    expect(first.decisionFingerprint).toBe(second.decisionFingerprint);
  });
});
