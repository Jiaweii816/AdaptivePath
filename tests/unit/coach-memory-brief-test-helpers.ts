import type {
  CoachMemoryBrief,
  TeachableMemory,
} from "@/server/memory/retrieval/candidate-core.types";

export function teachableMemory(
  overrides: Partial<TeachableMemory> = {},
): TeachableMemory {
  return {
    kind: "successful_transfer",
    cue: "Used a running carry successfully on Add Binary.",
    sourceLabel: "Add Binary review",
    learnerSignalBasis: "earned_evidence",
    applicability: "related_pattern",
    whyRelevant: "Internal ranking explanation that must stay out of prompts.",
    evidenceRefs: ["internal-trace-ref"],
    ...overrides,
  };
}

export function coachMemoryBrief(
  overrides: Partial<CoachMemoryBrief> = {},
): CoachMemoryBrief {
  return {
    profileId: "test-profile",
    teachableMemories: [],
    outputPreferences: [],
    domainReferences: [],
    retrievalStatus: "full",
    ...overrides,
  };
}
