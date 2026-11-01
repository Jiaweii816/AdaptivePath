/**
 * Per-question help usage (reference opened, tutor asked) and coach messages.
 * The attempt condition is computed only from these server records.
 */
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { BIOLOGY_DOMAIN } from "./memory-records";
import type { LearnerScope } from "./memory-store";

export type AccessKind = "biology_reference_access" | "biology_guided_assistance";
export type TutorMessage = Readonly<{ role: "student" | "tutor"; content: string }>;
export type QuestionActivity = Readonly<{ tutorUsed: boolean; referenceUsed: boolean; messages: readonly TutorMessage[] }>;
export type ThreadPhase = "current_question" | "submitted_attempt";

const accessJson = z.object({ domain: z.literal(BIOLOGY_DOMAIN), questionId: z.string() });
/** Messages written before phases existed carry no `phase`; they belong to the current-question thread. */
const baseMeta = z.object({
  domain: z.literal(BIOLOGY_DOMAIN),
  questionId: z.string(),
  phase: z.enum(["current_question", "submitted_attempt"]).default("current_question"),
});
const userMetaSchema = baseMeta.extend({
  type: z.literal("biology_tutor_user"),
  attemptId: z.string().optional(),
  intents: z.array(z.string()).optional(),
  affect: z.string().optional(),
  draftSnapshot: z.object({ selectedOption: z.string().nullable(), reasoning: z.string(), hash: z.string() }).optional(),
});
const assistantMetaSchema = baseMeta.extend({
  type: z.literal("biology_tutor_assistant"),
  tool: z.string().optional(),
  policyId: z.string().optional(),
  hintStep: z.number().nullable().optional(),
  tools: z.array(z.object({ name: z.string(), origin: z.enum(["policy", "model"]) })).optional(),
  citedChunkIds: z.array(z.string()).optional(),
  quotedSpans: z.array(z.string()).optional(),
  memorySignals: z.record(z.string(), z.unknown()).optional(),
  diagnosisCache: z.object({ hash: z.string(), probeStep: z.string(), studentSpan: z.string().nullable() }).optional(),
  traceRunId: z.string().optional(),
});
const messageMetaSchema = z.discriminatedUnion("type", [userMetaSchema, assistantMetaSchema]);

export type UserMeta = z.infer<typeof userMetaSchema>;
export type AssistantMeta = z.infer<typeof assistantMetaSchema>;
export type UserMetaInput = Omit<z.input<typeof userMetaSchema>, "domain" | "type" | "questionId" | "phase">;
export type AssistantMetaInput = Omit<z.input<typeof assistantMetaSchema>, "domain" | "type" | "questionId" | "phase">;
export type CoachThread = Readonly<{ messages: readonly TutorMessage[]; userMetas: readonly UserMeta[]; assistantMetas: readonly AssistantMeta[] }>;
const ACCESS_KINDS: readonly AccessKind[] = ["biology_reference_access", "biology_guided_assistance"];

export async function recordAccess(db: PrismaClient, input: Readonly<{ scope: LearnerScope; questionId: string; kind: AccessKind }>) {
  const { scope, questionId, kind } = input;
  await db.$transaction(async (tx) => {
    const prior = await tx.l1MemoryEvent.findMany({
      where: { userId: scope.userId, memoryOrigin: scope.memoryOrigin, chatSessionId: scope.chatSessionId, eventType: kind },
      select: { eventJson: true },
    });
    if (prior.some((p) => accessJson.parse(JSON.parse(p.eventJson)).questionId === questionId)) return;
    await tx.l1MemoryEvent.create({
      data: {
        userId: scope.userId, problemId: scope.problemId, chatSessionId: scope.chatSessionId, memoryOrigin: scope.memoryOrigin,
        eventType: kind, source: "adaptivepath_biology", eventJson: JSON.stringify({ domain: BIOLOGY_DOMAIN, questionId }),
      },
    });
  });
}

export async function loadCoachThread(db: PrismaClient, input: Readonly<{ scope: LearnerScope; questionId: string; phase: ThreadPhase }>): Promise<CoachThread> {
  const rows = await db.chatMessage.findMany({ where: { sessionId: input.scope.chatSessionId }, orderBy: { sequence: "asc" } });
  const thread = rows.flatMap((m) => {
    const meta = messageMetaSchema.parse(JSON.parse(m.metadataJson));
    return meta.questionId === input.questionId && meta.phase === input.phase ? [{ content: m.contentMarkdown, meta }] : [];
  });
  return {
    messages: thread.map((t) => ({ role: t.meta.type === "biology_tutor_user" ? "student" as const : "tutor" as const, content: t.content })),
    userMetas: thread.flatMap((t) => (t.meta.type === "biology_tutor_user" ? [t.meta] : [])),
    assistantMetas: thread.flatMap((t) => (t.meta.type === "biology_tutor_assistant" ? [t.meta] : [])),
  };
}

export async function loadQuestionActivity(db: PrismaClient, input: Readonly<{ scope: LearnerScope; questionId: string }>): Promise<QuestionActivity> {
  const { scope, questionId } = input;
  const [events, thread] = await Promise.all([
    db.l1MemoryEvent.findMany({
      where: { userId: scope.userId, memoryOrigin: scope.memoryOrigin, chatSessionId: scope.chatSessionId, eventType: { in: [...ACCESS_KINDS] } },
      select: { eventType: true, eventJson: true },
    }),
    loadCoachThread(db, { scope, questionId, phase: "current_question" }),
  ]);
  const used = (kind: AccessKind) =>
    events.some((e) => e.eventType === kind && accessJson.parse(JSON.parse(e.eventJson)).questionId === questionId);
  return { tutorUsed: used("biology_guided_assistance"), referenceUsed: used("biology_reference_access"), messages: thread.messages };
}

type ExchangeInput = Readonly<{
  scope: LearnerScope; questionId: string; phase: ThreadPhase; userText: string; reply: string;
  userMeta?: UserMetaInput; assistantMeta?: AssistantMetaInput;
}>;

export async function appendTutorExchange(db: PrismaClient, input: ExchangeInput) {
  const { scope, questionId, phase } = input;
  const meta = (type: string, extra: object = {}) => JSON.stringify({ domain: BIOLOGY_DOMAIN, type, questionId, phase, ...extra });
  await db.$transaction(async (tx) => {
    const latest = await tx.chatMessage.findFirst({ where: { sessionId: scope.chatSessionId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    const next = (latest?.sequence ?? 0) + 1;
    await tx.chatMessage.create({
      data: { sessionId: scope.chatSessionId, sequence: next, role: "user", contentMarkdown: input.userText, memoryOrigin: scope.memoryOrigin, metadataJson: meta("biology_tutor_user", input.userMeta) },
    });
    await tx.chatMessage.create({
      data: { sessionId: scope.chatSessionId, sequence: next + 1, role: "assistant", contentMarkdown: input.reply, memoryOrigin: scope.memoryOrigin, metadataJson: meta("biology_tutor_assistant", input.assistantMeta) },
    });
  });
}
