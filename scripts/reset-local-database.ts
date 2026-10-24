import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  databaseUrlForLocalProfile,
  LOCAL_DATABASE_PROFILE_ENV,
  resolveLocalDatabaseProfile,
} from "../src/server/db/sqlite-path";

type ResetProfile = "guest" | "try";

const profiles: Record<ResetProfile, {
  seedScript: string;
}> = {
  guest: {
    seedScript: "prisma/seed-guest.ts",
  },
  try: {
    seedScript: "prisma/seed-try.ts",
  },
};

function selectedProfile(value: string | undefined): ResetProfile {
  if (value === "guest" || value === "try") return value;
  throw new Error("Usage: tsx scripts/reset-local-database.ts <guest|try>");
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function main() {
  const profileName = selectedProfile(process.argv[2]);
  const profile = resolveLocalDatabaseProfile(profileName);
  const databasePath = resolve(profile.databasePath);
  if (!databasePath.startsWith("/home/iris/patterncoach-data/")) {
    throw new Error(`Reset target is outside the approved data root: ${databasePath}`);
  }

  await mkdir(dirname(databasePath), { recursive: true });
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    await rm(path, { force: true });
  }

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrlForLocalProfile(profileName),
    PATTERNCOACH_LOCAL_USER_HANDLE: profile.handle,
    PATTERNCOACH_MEMORY_ORIGIN: profile.memoryOrigin,
    [LOCAL_DATABASE_PROFILE_ENV]: profile.name,
  };
  const prismaBin = resolve("node_modules/.bin/prisma");
  const tsxBin = resolve("node_modules/.bin/tsx");

  try {
    await run(prismaBin, ["migrate", "deploy"], env);
  } catch (error) {
    console.warn("Prisma schema engine did not start cleanly; retrying once with engine diagnostics enabled.");
    await run(prismaBin, ["migrate", "deploy"], {
      ...env,
      RUST_BACKTRACE: "1",
      RUST_LOG: "debug",
    }).catch(() => {
      throw error;
    });
  }
  await run(tsxBin, [profiles[profileName].seedScript], env);
  console.log(`${profileName} database reset complete: ${databasePath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
