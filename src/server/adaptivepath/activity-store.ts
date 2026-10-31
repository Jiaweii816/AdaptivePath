/**
 * Per-question help usage (reference opened, tutor asked) and tutor messages.
 * The attempt condition is computed only from these server records.
 */
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { BIOLOGY_DOMAIN } from "./memory-records";
import type { LearnerScope } from "./memory-store";

export type AccessKind = "biology_reference_access" | "biology_guided_assistance";
export type TutorMessage = Readonly<{ role: "student" | "tutor"; content: string }>;
export type QuestionActivity = Readonly<{ tutorUsed: boolean; referenceUsed: boolean; messages: readonly TutorMessage[] }>;

const accessJson = z.object({ domain: z.literal(BIOLOGY_DOMAIN), questionId: z.string() });
const messageJson = z.object({
  domain: z.literal(BIOLOGY_DOMAIN),
  type: z.enum(["biology_tutor_user", "biology_tutor_assistant"]),
  questionId: z.string(),
});
const ACCESS_KINDS: readonly AccessKind[] = ["biology_reference_access", "biology_guided_assistance"];

function isBiologyMessage(json: string, questionId: string) {
  const parsed = messageJson.safeParse(JSON.parse(json));
  return parsed.success && parsed.data.questionId === questionId ? parsed.data : null;
}

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

export async function loadQuestionActivity(db: PrismaClient, input: Readonly<{ scope: LearnerScope; questionId: string }>): Promise<QuestionActivity> {
  const { scope, questionId } = input;
  const [events, messages] = await Promise.all([
    db.l1MemoryEvent.findMany({
      where: { userId: scope.userId, memoryOrigin: scope.memoryOrigin, chatSessionId: scope.chatSessionId, eventType: { in: [...ACCESS_KINDS] } },
      select: { eventType: true, eventJson: true },
    }),
    db.chatMessage.findMany({ where: { sessionId: scope.chatSessionId }, orderBy: { sequence: "asc" } }),
  ]);
  const used = (kind: AccessKind) =>
    events.some((e) => e.eventType === kind && accessJson.parse(JSON.parse(e.eventJson)).questionId === questionId);
  return {
    tutorUsed: used("biology_guided_assistance"),
    referenceUsed: used("biology_reference_access"),
    messages: messages.flatMap((m) => {
      const meta = isBiologyMessage(m.metadataJson, questionId);
      if (!meta) return [];
      return [{ role: meta.type === "biology_tutor_user" ? "student" as const : "tutor" as const, content: m.contentMarkdown }];
    }),
  };
}

export async function appendTutorExchange(
  db: PrismaClient,
  input: Readonly<{ scope: LearnerScope; questionId: string; userText: string; reply: string; tool: string }>,
) {
  const { scope, questionId } = input;
  await db.$transaction(async (tx) => {
    const latest = await tx.chatMessage.findFirst({ where: { sessionId: scope.chatSessionId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    const next = (latest?.sequence ?? 0) + 1;
    const meta = (type: string, extra: Record<string, string> = {}) => JSON.stringify({ domain: BIOLOGY_DOMAIN, type, questionId, ...extra });
    await tx.chatMessage.create({
      data: { sessionId: scope.chatSessionId, sequence: next, role: "user", contentMarkdown: input.userText, memoryOrigin: scope.memoryOrigin, metadataJson: meta("biology_tutor_user") },
    });
    await tx.chatMessage.create({
      data: { sessionId: scope.chatSessionId, sequence: next + 1, role: "assistant", contentMarkdown: input.reply, memoryOrigin: scope.memoryOrigin, metadataJson: meta("biology_tutor_assistant", { tool: input.tool }) },
    });
  });
}
