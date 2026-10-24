import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import {
  createIsolatedTestDatabase,
  snapshotWorkspaceDevDatabase,
} from "./tests/support/isolated-database";

const isolatedDb = createIsolatedTestDatabase("patterncoach-campaign-final-vitest");
process.env.DATABASE_URL = isolatedDb.databaseUrl;
process.env.PATTERNCOACH_MEMORY_ORIGIN = "test";
// A developer's persisted Iris/guest/try launcher selection must never leak
// into this per-run temporary database.
delete process.env.PATTERNCOACH_DATABASE_PROFILE;
// Keep the broad legacy suite deterministic. Dedicated Pilot tests delete or
// override this value to prove the product's default-on and rollback contracts.
process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = "0";
// Automated traffic must never impersonate Iris904, even in an isolated DB.
// Fixtures that need a user use the same named development/test identity.
process.env.PATTERNCOACH_LOCAL_USER_HANDLE = "try";
process.env.PATTERNCOACH_UNIT_DB_DIR = isolatedDb.directory;
process.env.PATTERNCOACH_UNIT_DEV_DB_SNAPSHOT = JSON.stringify(
  snapshotWorkspaceDevDatabase(),
);

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: "./tests/unit/global-teardown.ts",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    testTimeout: 20_000,
    // Unit files deliberately swap process-wide DATABASE_URL and create then
    // remove isolated SQLite directories. Forked workers give each file an OS
    // process, so its env/module cache cannot race another test file's cleanup.
    pool: "forks",
    maxWorkers: 4,
  },
});
