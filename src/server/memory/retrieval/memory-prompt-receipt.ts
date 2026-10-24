import { createHash } from "node:crypto";
import type { CoachMemoryBrief } from "./candidate-core.types";

export function buildMemoryPromptReceipt(memory: CoachMemoryBrief) {
  const cues = memory.teachableMemories.slice(0, 2).map((item) => item.cue);
  return {
    cueCount: cues.length,
    cueHashes: cues.map(hash),
    briefHash: hash(
      JSON.stringify({
        cues,
        outputPreferences: memory.outputPreferences,
        teachingStrategy: memory.teachingStrategy ?? null,
        domainReferences: memory.domainReferences,
      }),
    ),
  };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
