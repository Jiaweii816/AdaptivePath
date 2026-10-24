import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
 resolve: { alias: { "@": fileURLToPath(new URL("../../../src", import.meta.url)) } },
 test: { include: ["backend/bff/tests/**/*.test.ts", "tests/unit/review-stream.test.ts"], environment: "node", testTimeout: 60000, hookTimeout: 60000 },
});
