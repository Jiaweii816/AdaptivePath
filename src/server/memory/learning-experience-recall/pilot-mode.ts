/**
 * Chat uses tool-driven learning-experience recall by default. Set the flag
 * to `0` to restore the legacy automatic Coach-memory assembly immediately.
 */
export function isLearningExperienceRecallPilotEnabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  const configured = env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT;
  if (configured !== undefined) return configured === "1";
  return true;
}

export const AUTOMATIC_MEMORY_ASSEMBLY_DISABLED_RECEIPT =
  "pilot_disabled_automatic_assembly" as const;
