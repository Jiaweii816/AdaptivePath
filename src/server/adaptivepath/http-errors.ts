/** Maps Biology API failures to explicit HTTP responses; unknown errors are logged by the caller. */
import { z } from "zod";
import { BiologyLearnerNotFoundError } from "./learner";
import { LiveTutorError } from "./tutor-provider";

export { LiveTutorError };

const CLIENT_ERRORS = /not the current activity|Invalid answer option|explain your reasoning/;
export type BiologyErrorResponse = Readonly<{ status: number; body: Readonly<{ error: string; details?: unknown }> }>;

export function biologyErrorResponse(error: unknown): BiologyErrorResponse {
  if (error instanceof BiologyLearnerNotFoundError) return { status: 503, body: { error: error.message } };
  if (error instanceof z.ZodError) return { status: 400, body: { error: "Invalid request", details: error.flatten() } };
  if (error instanceof LiveTutorError) return { status: 502, body: { error: error.message } };
  if (error instanceof Error && CLIENT_ERRORS.test(error.message)) return { status: 400, body: { error: error.message } };
  return { status: 500, body: { error: "Unable to complete request" } };
}
