import {
  assembleCoachMemory,
  type AssembleCoachMemoryArgs,
  type CoachMemoryAssembly,
} from "./assemble-coach-memory";

export type BuildCoachMemoryContextArgs = AssembleCoachMemoryArgs;
export type { CoachMemoryAssembly };

/**
 * The only learner-memory read facade used by Coach Review and Chat.
 * Source retrieval, normalization, selection, and trace assembly stay behind
 * this boundary; providers receive only `result.brief`.
 */
export async function buildCoachMemoryContext(
  prisma: Parameters<typeof assembleCoachMemory>[0],
  args: BuildCoachMemoryContextArgs,
): Promise<CoachMemoryAssembly> {
  return assembleCoachMemory(prisma, args);
}
