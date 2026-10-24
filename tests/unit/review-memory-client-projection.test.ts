import { describe, expect, it } from "vitest";
import {
  projectReviewMemoryBriefForClient,
} from "@/server/agents/coach-agent/review-memory-client-projection";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";

describe("projectReviewMemoryBriefForClient", () => {
  it("projects only display-safe memory citation fields", () => {
    const projected = projectReviewMemoryBriefForClient({
      profileId: "profile-internal",
      retrievalStatus: "full",
      outputPreferences: ["concise"],
      domainReferences: [],
      teachableMemories: [
        {
          kind: "recurring_mistake",
          cue: "Do not leak this prompt cue.",
          sourceLabel: "Graph DFS visited-state recurrence",
          learnerSignalBasis: "earned_evidence",
          applicability: "exact_pattern",
          whyRelevant: "trace-only rationale",
          evidenceRefs: ["l1-event-internal"],
        },
        {
          kind: "learning_preference",
          cue: "Prefer concise explanations.",
          sourceLabel: "Concise explanation preference",
          learnerSignalBasis: "self_reported",
          applicability: "teaching_style_only",
          whyRelevant: "style-only rationale",
          evidenceRefs: ["l1-event-style"],
        },
      ],
    } satisfies CoachMemoryBrief);

    expect(Object.keys(projected)).toEqual(["teachableMemories"]);
    expect(projected.teachableMemories).toHaveLength(1);
    expect(Object.keys(projected.teachableMemories[0]!)).toEqual([
      "sourceLabel",
      "learnerSignalBasis",
      "applicability",
    ]);
    expect(projected.teachableMemories[0]).toEqual({
      sourceLabel: "Graph DFS visited-state recurrence",
      learnerSignalBasis: "earned_evidence",
      applicability: "exact_pattern",
    });
  });
});
