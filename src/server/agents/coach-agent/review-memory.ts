import { buildCoachMemoryContext } from "@/server/memory";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";

type ReviewMemoryArgs = {
  userId: string;
  problemId: string;
  problemTags: string[];
  queryText: string;
  code?: string;
  currentSignal?: {
    mechanism?: string;
    stuckLayer?: string;
    failedCaseSummary?: string;
  };
  profile: {
    strongPatterns: string[];
    weakPatterns: string[];
    outputPreferences: string[];
  };
} & Pick<
  Parameters<typeof buildCoachMemoryContext>[1],
  "ftsStore" | "traceContext"
>;

export async function loadReviewMemoryContext(
  prisma: Parameters<typeof buildCoachMemoryContext>[0],
  args: ReviewMemoryArgs,
): Promise<CoachMemoryBrief> {
  const assembly = await buildCoachMemoryContext(prisma, {
    userId: args.userId,
    problemId: args.problemId,
    problemTags: args.problemTags,
    queryText: args.queryText,
    entry: { kind: "review" },
    profile: args.profile,
    currentSignal: args.currentSignal,
    code: args.code,
    ftsStore: args.ftsStore,
    traceContext: args.traceContext,
  });
  return assembly.brief;
}

export function formatReviewMemorySection(memory: CoachMemoryBrief): string[] {
  const evidenceMemories = memory.teachableMemories.filter(
    (item) => item.applicability !== "teaching_style_only",
  );
  const styleMemories = memory.teachableMemories.filter(
    (item) => item.applicability === "teaching_style_only",
  );
  const cues = evidenceMemories
    .slice(0, 2)
    .map(
      (item) =>
        `- ${item.cue} (source: ${item.sourceLabel}; basis: ${item.learnerSignalBasis})`,
    );
  const styleCues = styleMemories
    .slice(0, 2)
    .map((item) => `- ${item.cue}`);
  const references = memory.domainReferences
    .slice(0, 1)
    .map(
      (reference) =>
        `- ${reference.title}: ${reference.content} (source: ${reference.sourceLabel})`,
    );
  const preferences = memory.outputPreferences
    .slice(0, 3)
    .map((preference) => `- ${preference}`);
  if (
    cues.length === 0 &&
    styleCues.length === 0 &&
    references.length === 0 &&
    preferences.length === 0 &&
    !memory.teachingStrategy
  ) {
    return [];
  }

  return [
    "",
    "[COACH MEMORY BRIEF — teaching personalization only; never current-code evidence]",
    ...section("Selected learner cues (max 2):", cues),
    ...section("Output preferences:", preferences),
    ...section(
      "Teaching-style signals (style only; must not be used as evidence about the current code):",
      styleCues,
    ),
    ...(memory.teachingStrategy
      ? ["Teaching strategy:", `- ${memory.teachingStrategy}`]
      : []),
    ...section("Retrieved domain reference:", references),
    "Do not expose internal ids, tags, scores, confidence, or retrieval status. Distinguish self-reported cues from earned evidence in any profile answer.",
  ];
}

function section(title: string, lines: string[]) {
  return lines.length > 0 ? [title, ...lines] : [];
}
