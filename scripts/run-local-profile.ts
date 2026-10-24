import { spawn } from "node:child_process";
import {
  databaseUrlForLocalProfile,
  LOCAL_DATABASE_PROFILE_ENV,
  resolveLocalDatabaseProfile,
  type LocalDatabaseProfileName,
} from "../src/server/db/sqlite-path";

const profileName = process.argv[2];
const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv[separator + 1] : undefined;
const commandArgs = separator >= 0 ? process.argv.slice(separator + 2) : [];

if (!isProfileName(profileName) || !command) {
  console.error(
    "Usage: tsx scripts/run-local-profile.ts <iris|guest|try> -- <command> [...args]",
  );
  process.exit(1);
}

const profile = resolveLocalDatabaseProfile(profileName);
const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrlForLocalProfile(profileName),
    PATTERNCOACH_LOCAL_USER_HANDLE: profile.handle,
    PATTERNCOACH_MEMORY_ORIGIN: profile.memoryOrigin,
    [LOCAL_DATABASE_PROFILE_ENV]: profile.name,
  },
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.once("close", (code) => {
  process.exit(code ?? 1);
});

function isProfileName(value: string | undefined): value is LocalDatabaseProfileName {
  return value === "iris" || value === "guest" || value === "try";
}
