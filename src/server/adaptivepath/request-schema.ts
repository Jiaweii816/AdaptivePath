/** Validates POST /api/adaptivepath bodies at the system boundary. */
import { z } from "zod";
import { PROMPT_IDS } from "@/features/adaptivepath/practice/suggested-prompts";

const MAX_EXPLANATION_CHARS = 4_000;
const MAX_MESSAGE_CHARS = 2_000;

const promptIds = z.array(z.enum(PROMPT_IDS)).refine((ids) => new Set(ids).size === ids.length, "promptIds must not repeat");

export const practiceRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit"), questionId: z.string().min(1), selectedOption: z.string().min(1),
    explanation: z.string().max(MAX_EXPLANATION_CHARS), attemptId: z.string().uuid(),
  }),
  z.object({ action: z.literal("reference"), questionId: z.string().min(1) }),
  z.object({
    action: z.literal("chat"),
    focus: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("current_question"), questionId: z.string().min(1) }),
      z.object({ kind: z.literal("submitted_attempt"), attemptId: z.string().min(1) }),
    ]),
    message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    draft: z.object({ selectedOption: z.enum(["A", "B", "C", "D"]).nullable(), reasoning: z.string().max(MAX_EXPLANATION_CHARS) }).optional(),
    /** Suggested prompts clicked into this message; empty when typed. */
    promptIds,
    /** Textbook chunk the student attached; its text is looked up on the server. */
    referenceChunkId: z.string().min(1).optional(),
  }),
]);
