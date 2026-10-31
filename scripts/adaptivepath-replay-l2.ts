/**
 * Replays every Biology L2 judgment and ledger row of the local profile user
 * from L1 evidence under the active rule version, then writes a new L3 version.
 * Run through a profile: npm run adaptivepath:replay:try | adaptivepath:replay:guest
 */
import { pathToFileURL } from "node:url";
import { prisma } from "../src/server/db/prisma";
import { resolveLocalUserHandle } from "../src/features/onboarding/profile-defaults";
import { ACTIVE_RULE_VERSION, getRuleset } from "../src/features/adaptivepath/memory/rules";
import { QUESTION_LOOKUP } from "../src/features/adaptivepath/question-bank";
import { replayLearnerMemory } from "../src/server/adaptivepath/memory-store";
import { resolveMemoryOrigin } from "../src/server/memory/memory-origin";

async function main() {
  const handle = resolveLocalUserHandle();
  const user = await prisma.user.findUnique({ where: { handle } });
  if (!user) throw new Error(`Local user "${handle}" not found in ${process.env.DATABASE_URL ?? "default database"}.`);
  const scope = { userId: user.id, memoryOrigin: resolveMemoryOrigin() };
  const ctx = { rules: getRuleset(ACTIVE_RULE_VERSION), lookup: QUESTION_LOOKUP };
  const result = await replayLearnerMemory(prisma, { scope, ctx });
  console.log(`Replayed ${result.rowCount} ledger rows for ${handle} (${scope.memoryOrigin}) under ${ACTIVE_RULE_VERSION}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
