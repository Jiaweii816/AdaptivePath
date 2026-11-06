/** The coach's final output: text plus the textbook chunks and student sentences it points at (spec §10.2). */
import { z } from "zod";
import { BiologyCoachError } from "./errors";

export const coachReplySchema = z.object({
  reply: z.string().trim().min(1),
  citedChunkIds: z.array(z.string()),
  quotedSpans: z.array(z.string().min(1)),
}).strict();
export type CoachReply = z.infer<typeof coachReplySchema>;

type ContractContext = Readonly<{ retrievedChunkIds: ReadonlySet<string>; reasoning: string; requireCitation: boolean }>;

const fail = (message: string, details?: unknown) => new BiologyCoachError("reply_contract", "coach", message, { details });

export function validateCoachReply(raw: unknown, ctx: ContractContext): CoachReply {
  const parsed = coachReplySchema.safeParse(raw);
  if (!parsed.success) throw fail("Coach reply does not match the reply contract", parsed.error.flatten());
  const reply = parsed.data;
  const unknownChunks = reply.citedChunkIds.filter((id) => !ctx.retrievedChunkIds.has(id));
  if (unknownChunks.length) throw fail("Coach cited textbook chunks it did not retrieve this turn", { unknownChunks });
  const foreignSpans = reply.quotedSpans.filter((span) => !ctx.reasoning.includes(span));
  if (foreignSpans.length) throw fail("Coach quoted text that is not in the student's reasoning", { foreignSpans });
  if (ctx.requireCitation && reply.citedChunkIds.length === 0) throw fail("Coach must cite at least one textbook chunk for this intent");
  return reply;
}
