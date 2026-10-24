import type {
  CoachMemoryBrief,
  TeachableMemory,
} from "@/server/memory/retrieval/candidate-core.types";

export type ReviewClientTeachableMemory = {
  sourceLabel: string;
  learnerSignalBasis: TeachableMemory["learnerSignalBasis"];
  applicability: TeachableMemory["applicability"];
};

export type ReviewClientMemoryBrief = {
  teachableMemories: ReviewClientTeachableMemory[];
};

export function projectReviewMemoryBriefForClient(
  memory: CoachMemoryBrief,
): ReviewClientMemoryBrief {
  return {
    teachableMemories: memory.teachableMemories
      .filter((item) => item.applicability !== "teaching_style_only")
      .map((item) => ({
        sourceLabel: item.sourceLabel,
        learnerSignalBasis: item.learnerSignalBasis,
        applicability: item.applicability,
      })),
  };
}
