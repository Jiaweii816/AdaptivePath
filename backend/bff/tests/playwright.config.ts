import { defineConfig } from "@playwright/test";
export default defineConfig({
 testDir: ".", testMatch: "*.spec.ts", timeout: 60000, expect: {timeout: 15000},
 workers: 1, retries: 0, fullyParallel: false,
 use: {baseURL: process.env.ROUND1_BASE_URL ?? "http://127.0.0.1:8088", headless: true, actionTimeout: 15000},
 reporter: [["list"]], outputDir: "../../../test-results/round1",
 // External isolated stack only: never start the root dev-profile wrapper.
});
