import packageJson from "../../package.json";
import { describe, expect, it } from "vitest";

describe("PatternCoach scaffold package metadata", () => {
  it("keeps the project identity and baseline tooling scripts in place", () => {
    expect(packageJson.name).toBe("patterncoach-ai");
    expect(packageJson.private).toBe(true);

    expect(packageJson.scripts).toMatchObject({
      dev: "npm run dev:try",
      "dev:iris": "tsx scripts/run-local-profile.ts iris -- tsx scripts/dev-webui.ts",
      "dev:guest": "tsx scripts/run-local-profile.ts guest -- tsx scripts/dev-webui.ts",
      "dev:try": "tsx scripts/run-local-profile.ts try -- tsx scripts/dev-webui.ts",
      "db:migrate": "tsx scripts/run-local-profile.ts try -- prisma migrate dev",
      "db:push": "tsx scripts/run-local-profile.ts try -- prisma db push",
      "db:seed": "npm run db:seed:try",
      "db:seed:try": "tsx scripts/run-local-profile.ts try -- tsx prisma/seed-try.ts",
      "db:studio": "tsx scripts/run-local-profile.ts try -- prisma studio",
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      "test:unit": "vitest run",
      "test:e2e": "playwright test",
    });

    expect(packageJson.scripts.test).toContain("npm run lint");
    expect(packageJson.scripts.test).toContain("npm run typecheck");
    expect(packageJson.scripts.test).toContain("npm run test:unit");
    expect(packageJson.scripts.test).toContain("npm run test:e2e");
  });
});
