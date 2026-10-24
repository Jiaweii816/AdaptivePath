import type { MemoryUpdateCandidate } from "@/types/coach";
import { normalizeMemoryTag } from "@/server/memory/memory.types";

const ALLOWED_FACT_TYPES = new Set([
  "mistake",
  "weakness",
  "skill",
  "strength",
  "preference",
  "unresolved_confusion",
]);

const GENERIC_MOCK_INTERVIEW_TAGS = new Set([
  "boundary_cases",
  "code_quality",
  "complexity_reasoning",
  "debugging_without_evidence",
  "dry_run",
  "edge_case_reasoning",
  "explanation_clarity",
  "first_failed_case",
  "invariant_reasoning",
  "off_by_one",
]);

const MOCK_INTERVIEW_TAG_ALIASES: Record<string, string> = {
  communication: "explanation_clarity",
  debugging: "debugging_without_evidence",
  interview_communication: "explanation_clarity",
  interview_debugging: "debugging_without_evidence",
  interview_edge_cases: "edge_case_reasoning",
  mock_debugging: "debugging_without_evidence",
};

export function filterMockInterviewMemoryUpdateCandidate(args: {
  candidate: MemoryUpdateCandidate;
  problemSlug: string;
  problemTags: string[];
}): MemoryUpdateCandidate {
  const allowedTags = new Set([
    normalizeMemoryTag(args.problemSlug),
    ...args.problemTags.map(normalizeMemoryTag),
    ...GENERIC_MOCK_INTERVIEW_TAGS,
  ]);

  return {
    summary: args.candidate.summary,
    facts: args.candidate.facts.flatMap((fact) => {
      const factType = fact.factType.trim();

      if (!ALLOWED_FACT_TYPES.has(factType)) {
        return [];
      }

      const originalTag = normalizeMemoryTag(fact.tag);
      const tag = MOCK_INTERVIEW_TAG_ALIASES[originalTag] ?? originalTag;

      if (!allowedTags.has(tag) || isParallelInterviewTag(tag)) {
        return [];
      }

      return [
        {
          ...fact,
          factType,
          tag,
          label: fact.label ?? tag,
        },
      ];
    }),
  };
}

function isParallelInterviewTag(tag: string) {
  return (
    tag === "mock_interview" ||
    tag === "interview" ||
    tag.startsWith("mock_interview_") ||
    tag.startsWith("interview_")
  );
}
