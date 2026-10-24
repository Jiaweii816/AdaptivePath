import { defineConfig } from "prisma/config";
import { DEFAULT_DATABASE_URL } from "./src/server/db/sqlite-path";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "node node_modules/.bin/tsx prisma/seed.ts",
  },
});
