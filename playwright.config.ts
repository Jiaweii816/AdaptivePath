import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { defineConfig, devices } from "@playwright/test";
import { seedDatabase } from "./prisma/seed";
import {
  createIsolatedTestDatabase,
  removeIsolatedTestDatabase,
  snapshotWorkspaceDevDatabase,
} from "./tests/support/isolated-database";

const inheritedDirectory = process.env.PATTERNCOACH_E2E_DB_DIR;
const isolatedDb = inheritedDirectory
  ? {
      directory: inheritedDirectory,
      databasePath: join(inheritedDirectory, "test.db"),
      databaseUrl: `file:${join(inheritedDirectory, "test.db")}`,
    }
  : createIsolatedTestDatabase("patterncoach-campaign-final-e2e");
const ownsIsolatedDatabase = !inheritedDirectory;
const e2eUserHandle = process.env.PATTERNCOACH_LOCAL_USER_HANDLE?.startsWith("e2e-")
  ? process.env.PATTERNCOACH_LOCAL_USER_HANDLE
  : `e2e-${randomUUID()}`;
const devDbSnapshot = snapshotWorkspaceDevDatabase();

process.env.DATABASE_URL = isolatedDb.databaseUrl;
process.env.PATTERNCOACH_MEMORY_ORIGIN = "test";
process.env.PATTERNCOACH_LOCAL_USER_HANDLE = e2eUserHandle;
process.env.CODE_RUNNER_PROVIDER = "mock";
process.env.PATTERNCOACH_E2E_DB_DIR = isolatedDb.directory;
process.env.PATTERNCOACH_E2E_DEV_DB_SNAPSHOT = JSON.stringify(devDbSnapshot);
if (ownsIsolatedDatabase) {
  process.once("exit", () => removeIsolatedTestDatabase(isolatedDb.directory));
}

if (ownsIsolatedDatabase) {
  const seedPrisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: isolatedDb.databaseUrl }),
  });
  await seedDatabase(seedPrisma);
  await seedPrisma.$disconnect();
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 60_000,
  // Monaco loads one browser worker bundle. The suite still stays serial, but
  // every invocation now owns a migrated temporary database and unique user.
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    // This assumes a normal Node.js install with npm available on PATH.
    // In this repo's earlier WSL shell, npm required a temporary PATH prefix.
    command: "npm run dev",
    url: "http://localhost:3000",
    env: {
      ...process.env,
      DATABASE_URL: isolatedDb.databaseUrl,
      PATTERNCOACH_MEMORY_ORIGIN: "test",
      PATTERNCOACH_LOCAL_USER_HANDLE: e2eUserHandle,
      CODE_RUNNER_PROVIDER: "mock",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
