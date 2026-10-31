import { describe, expect, it } from "vitest";
import { z } from "zod";
import { biologyErrorResponse, LiveTutorError } from "@/server/adaptivepath/http-errors";
import { BiologyLearnerNotFoundError } from "@/server/adaptivepath/learner";

describe("biology API error mapping", () => {
  it("maps a missing local user to 503 with the setup command", () => {
    expect(biologyErrorResponse(new BiologyLearnerNotFoundError("guest"))).toEqual({
      status: 503, body: { error: 'Local user "guest" not found in this database. Run: npm run db:guest:reset' },
    });
  });

  it("maps validation and activity errors to 400", () => {
    expect(biologyErrorResponse(new z.ZodError([])).status).toBe(400);
    for (const message of ["This is not the current activity", "Invalid answer option", "Please explain your reasoning (at least 12 characters)."]) {
      expect(biologyErrorResponse(new Error(message))).toEqual({ status: 400, body: { error: message } });
    }
  });

  it("maps live tutor failures to 502", () => {
    expect(biologyErrorResponse(new LiveTutorError(new Error("provider down")))).toEqual({
      status: 502, body: { error: "Live tutor failed: provider down" },
    });
  });

  it("maps anything else to 500", () => {
    expect(biologyErrorResponse(new Error("boom"))).toEqual({ status: 500, body: { error: "Unable to complete request" } });
  });
});
