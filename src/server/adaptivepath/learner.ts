/**
 * The Biology learner is the process's local profile user (spec §4):
 * `npm run dev` → try (development), `npm run dev:guest` → guest (learner).
 * There is no per-browser identity and no automatic user creation.
 */
import type { PrismaClient } from "@prisma/client";
import { resolveLocalUserHandle } from "@/features/onboarding/profile-defaults";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import type { LearnerScope } from "./memory-store";

export const BIOLOGY_PROBLEM_SLUG = "adaptivepath-biology-2e-12-2";
const SETUP_COMMANDS: Readonly<Record<string, string>> = {
  try: "npm run db:try:reset",
  guest: "npm run db:guest:reset",
};

type Env = Readonly<Record<string, string | undefined>>;

export class BiologyLearnerNotFoundError extends Error {
  constructor(handle: string) {
    const command = SETUP_COMMANDS[handle] ?? "seed this local profile";
    super(`Local user "${handle}" not found in this database. Run: ${command}`);
    this.name = "BiologyLearnerNotFoundError";
  }
}

export async function resolveBiologyLearner(db: PrismaClient, env: Env = process.env): Promise<LearnerScope & { handle: string }> {
  const handle = resolveLocalUserHandle(env);
  const memoryOrigin = resolveMemoryOrigin(env);
  const user = await db.user.findUnique({ where: { handle } });
  if (!user) throw new BiologyLearnerNotFoundError(handle);
  const problem = await db.problem.upsert({
    where: { slug: BIOLOGY_PROBLEM_SLUG },
    update: {},
    create: {
      slug: BIOLOGY_PROBLEM_SLUG,
      title: "OpenStax Biology 2e — 12.2 Characteristics and Traits",
      statementMarkdown: "Biology 12.2 practice across 10 sub-topics.",
      tags: JSON.stringify(["biology", "mendelian_genetics", "section_12_2"]),
      methodName: "biology_reasoning",
      isDemoSupported: false,
      localRunStatus: "unsupported",
    },
  });
  const session = await db.chatSession.upsert({
    where: { userId_problemId_memoryOrigin: { userId: user.id, problemId: problem.id, memoryOrigin } },
    update: {},
    create: { userId: user.id, problemId: problem.id, memoryOrigin, title: "AdaptivePath Biology §12.2", isActive: true },
  });
  return { handle, userId: user.id, problemId: problem.id, chatSessionId: session.id, memoryOrigin };
}
