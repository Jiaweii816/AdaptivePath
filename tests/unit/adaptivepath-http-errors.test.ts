import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { BiologyCoachError } from "@/features/adaptivepath/coach/errors";
import { biologyErrorResponse } from "@/server/adaptivepath/http-errors";
import { BiologyLearnerNotFoundError } from "@/server/adaptivepath/learner";

describe("biology API error mapping", () => {
  it("maps a missing local user to 503 with the setup command", () => {
    expect(biologyErrorResponse(new BiologyLearnerNotFoundError("guest"))).toEqual({
      status: 503, body: { error: 'Local user "guest" not found in this database. Run: npm run db:migrate:guest && npx tsx scripts/run-local-profile.ts guest -- tsx prisma/seed-guest.ts' },
    });
  });

  it("maps missing Biology tables (unmigrated database) to 503 with the migrate command", () => {
    const missing = new Prisma.PrismaClientKnownRequestError("The table `main.BiologyMasteryJudgment` does not exist", { code: "P2021", clientVersion: "test" });
    expect(biologyErrorResponse(missing, { PATTERNCOACH_LOCAL_USER_HANDLE: "guest" })).toEqual({
      status: 503, body: { error: "This database has not been migrated for Biology memory. Run: npm run db:migrate:guest" },
    });
    expect(biologyErrorResponse(missing, { PATTERNCOACH_LOCAL_USER_HANDLE: "try" }).body.error).toContain("npm run db:migrate:try");
  });

  it("maps validation and activity errors to 400", () => {
    expect(biologyErrorResponse(new z.ZodError([])).status).toBe(400);
    for (const message of ["This is not the current activity", "Invalid answer option"]) {
      expect(biologyErrorResponse(new Error(message))).toEqual({ status: 400, body: { error: message } });
    }
  });

  it("maps coach failures to their status with code and node", () => {
    expect(biologyErrorResponse(new BiologyCoachError("answer_leak", "guard", "Coach reply contained answer information"))).toEqual({
      status: 502, body: { error: "Coach reply contained answer information", details: { code: "answer_leak", node: "guard" } },
    });
    expect(biologyErrorResponse(new BiologyCoachError("attempt_not_found", "request", "No such attempt")).status).toBe(404);
    expect(biologyErrorResponse(new BiologyCoachError("review_requires_live", "request", "Review needs the live coach")).status).toBe(400);
  });

  it("maps anything else to 500", () => {
    expect(biologyErrorResponse(new Error("boom"))).toEqual({ status: 500, body: { error: "Unable to complete request" } });
  });
});
