import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated Biology browser smoke. Unlike the legacy coding-interview E2E
 * configuration, it operates only against the disposable try profile already
 * migrated and seeded by the AdaptivePath CI job.
 */
export default defineConfig({
  testDir:"./e2e",
  testMatch:"adaptivepath.spec.ts",
  timeout:45_000,
  workers:1,
  use:{baseURL:"http://127.0.0.1:3000",trace:"retain-on-failure"},
  webServer:{
    command:"npm run dev:try",
    url:"http://127.0.0.1:3000",
    reuseExistingServer:false,
    timeout:120_000,
  },
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}],
});
