/**
 * Explicit offline Biology tutor (ADAPTIVEPATH_TUTOR_PROVIDER != "live"): template
 * replies chosen from L2, labelled "Offline rules" in the UI. The live coach agent
 * lives in ./biology/ and never falls back to this.
 */
import locations from "@/features/adaptivepath/textbook-locations.json";
import type { BankQuestion } from "@/features/adaptivepath/question-bank";
import { hintStep, type BiologyCoachTool } from "@/features/adaptivepath/memory/coach-policy";
import { offlineTutorReply } from "@/features/adaptivepath/memory/offline-hints";
import type { MasteryLevel } from "@/features/adaptivepath/memory/types";
import { selectBiologyCoachTool } from "@/features/adaptivepath/onboarding/coach-policy";
import type { BiologyOnboardingMetadata } from "@/features/adaptivepath/onboarding/types";

export type OfflineTurnInput = Readonly<{ question: BankQuestion; priorTutorTurns: number; levels: readonly (MasteryLevel | null)[]; onboarding?:BiologyOnboardingMetadata|null }>;
export type OfflineTurnResult = Readonly<{ reply: string; provider: "offline_rules"; tool: BiologyCoachTool }>;

/** Subsection titles only. */
function subsectionsFor(chunkIds: readonly string[]): string[] {
  const titles = chunkIds.map((id) => {
    const chunk = locations.chunks.find((c) => c.id === id);
    if (!chunk) throw new Error(`Unknown textbook chunk ${id}`);
    return chunk.subsection;
  });
  return [...new Set(titles)];
}

export function biologyOfflineReply(input: OfflineTurnInput): OfflineTurnResult {
  const tool = selectBiologyCoachTool(input.levels,input.question.conceptIds,input.onboarding??null);
  const reply = offlineTutorReply({
    tool, conceptIds: input.question.conceptIds, hintStep: hintStep(input.priorTutorTurns), subsections: subsectionsFor(input.question.chunkIds),
  });
  return { reply, provider: "offline_rules", tool };
}
