import { pathToFileURL } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import {
  assertLocalDatabaseProfileEnvironment,
} from "../src/server/db/sqlite-path";
import { seedDatabase, type LocalSeedProfile } from "./seed";

const tryProfile: LocalSeedProfile = {
  handle: "try",
  displayName: "Try Development",
  interviewGoal: "general_practice",
  preferredLanguages: ["Python"],
  strongPatterns: ["Array traversal"],
  weakPatterns: ["Binary Search boundaries", "Graph traversal"],
  explanationStyle: ["Short, step-by-step answer", "Concrete example first"],
  outputPreferences: ["Pseudocode before full code", "Python preferred"],
};

export async function seedTryDatabase(prisma: PrismaClient) {
  await seedDatabase(prisma, { profile: tryProfile });

  const [tryUser, irisUser] = await Promise.all([
    prisma.user.findUnique({ where: { handle: tryProfile.handle } }),
    prisma.user.findUnique({ where: { handle: "Iris904" } }),
  ]);
  if (!tryUser?.id) throw new Error("Try seed did not create the try user.");
  if (irisUser) throw new Error("Try database must not contain Iris904.");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the try seed.");
  assertLocalDatabaseProfileEnvironment({ configuredDatabaseUrl: databaseUrl });
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });
  try {
    await seedTryDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
