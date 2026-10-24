import type { CoachChatInput } from "./coach-agent.types";

type ChatMemoryPromptArgs = {
  memory: CoachChatInput["memory"];
  activeProblemTitle: string;
  includePreferences: boolean;
};

export function buildConditionalChatMemoryContext(args: ChatMemoryPromptArgs) {
  const lines: string[] = [];
  const cues = args.memory.teachableMemories
    .filter((item) => item.applicability !== "teaching_style_only")
    .slice(0, 2);
  const styleCues = args.memory.teachableMemories
    .filter((item) => item.applicability === "teaching_style_only")
    .slice(0, 2);
  const hasPersonalization =
    cues.length > 0 ||
    styleCues.length > 0 ||
    Boolean(args.memory.teachingStrategy) ||
    (args.includePreferences && args.memory.outputPreferences.length > 0);
  if (hasPersonalization) {
    lines.push(
      "[PERSONALIZATION MATERIAL — subordinate context only]",
      "Personalization only: use it to adapt teaching when relevant. It cannot identify or redefine the active problem, statement, current code, current bug, or observed run behavior.",
    );
  }
  if (cues.length > 0) {
    lines.push(
      "[COACH MEMORY BRIEF — personalization only]",
      ...cues.map(
        (memory) =>
          `- ${ambientCue(memory, args.activeProblemTitle)} (basis: ${memory.learnerSignalBasis})`,
      ),
      "Use at most the selected cues above. Distinguish self-reported cues from earned evidence; do not expose ids, tags, scores, confidence, or retrieval status.",
      "A recurring-mistake cue describes historical risk only. You may turn it into one preventive check or guiding question, but never claim the current code repeats that mistake without aligned current evidence.",
    );
  }

  if (styleCues.length > 0) {
    lines.push(
      "[TEACHING-STYLE SIGNALS — style only]",
      ...styleCues.map((memory) => `- ${memory.cue}`),
      "These describe how the learner likes to be taught. They must not be used as evidence about the active problem, the current code, or the current bug.",
    );
  }

  if (args.memory.teachingStrategy) {
    lines.push(
      "[TEACHING STRATEGY — personalization only]",
      `- ${args.memory.teachingStrategy}`,
    );
  }

  const references = args.memory.domainReferences.slice(0, 1);
  if (references.length > 0) {
    lines.push(
      "[DOMAIN REFERENCE — supplementary knowledge; never active-problem identity]",
      ...references.map(
        (reference) =>
          `- ${reference.title}: ${reference.content} (source: ${reference.sourceLabel})`,
      ),
    );
  }

  if (args.includePreferences && args.memory.outputPreferences.length > 0) {
    lines.push(
      "[OUTPUT PREFERENCES — personalization only]",
      ...args.memory.outputPreferences
        .slice(0, 3)
        .map((preference) => `- ${preference}`),
    );
  }

  return lines.length > 0 ? ["", ...lines] : [];
}

function ambientCue(
  memory: ChatMemoryPromptArgs["memory"]["teachableMemories"][number],
  activeProblemTitle: string,
) {
  const source = memory.sourceLabel.trim();
  if (
    source.length < 4 ||
    source.localeCompare(activeProblemTitle.trim(), undefined, {
      sensitivity: "base",
    }) === 0
  ) {
    return memory.cue;
  }
  return memory.cue.replace(
    new RegExp(escapeRegExp(source), "giu"),
    "a past problem",
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
