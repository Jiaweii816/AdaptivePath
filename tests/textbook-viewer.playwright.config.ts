import { defineConfig, devices } from "@playwright/test";

// Session fixtures avoid modifying a real learner database during viewer checks.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "adaptivepath-textbook-viewer.spec.ts",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: {
    cwd: process.cwd(),
    command: "npx next dev --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/api/adaptivepath/textbook/document",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
});
