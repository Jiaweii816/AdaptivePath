/** Maps Biology API failures to explicit HTTP responses; unknown errors are logged by the caller. */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { resolveLocalUserHandle } from "@/features/onboarding/profile-defaults";
import { BiologyLearnerNotFoundError } from "./learner";
import { LiveTutorError } from "./tutor-provider";

export { LiveTutorError };

const CLIENT_ERRORS = /not the current activity|Invalid answer option|explain your reasoning/;
const TABLE_MISSING = "P2021";
const MIGRATE_COMMANDS: Readonly<Record<string, string>> = {
  try: "npm run db:migrate:try",
  guest: "npm run db:migrate:guest",
};
type Env = Readonly<Record<string, string | undefined>>;
export type BiologyErrorResponse = Readonly<{ status: number; body: Readonly<{ error: string; details?: unknown }> }>;

function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === TABLE_MISSING;
}

export function biologyErrorResponse(error: unknown, env: Env = process.env): BiologyErrorResponse {
  if (error instanceof BiologyLearnerNotFoundError) return { status: 503, body: { error: error.message } };
  if (isMissingTable(error)) {
    const command = MIGRATE_COMMANDS[resolveLocalUserHandle(env)] ?? "prisma migrate deploy for this profile";
    return { status: 503, body: { error: `This database has not been migrated for Biology memory. Run: ${command}` } };
  }
  if (error instanceof z.ZodError) return { status: 400, body: { error: "Invalid request", details: error.flatten() } };
  if (error instanceof LiveTutorError) return { status: 502, body: { error: error.message } };
  if (error instanceof Error && CLIENT_ERRORS.test(error.message)) return { status: 400, body: { error: error.message } };
  return { status: 500, body: { error: "Unable to complete request" } };
}
