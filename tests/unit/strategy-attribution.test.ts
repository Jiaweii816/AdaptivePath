import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runChatConsolidation } from "@/server/memory/consolidation/consolidate-chat";
import { consolidationOutputSchema } from "@/server/memory/memory.types";
import { createFtsStore } from "@/server/memory/store/fts-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

beforeAll(() => {
  process.env.CHAT_CONSOLIDATION_PROVIDER = "mock";
});

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("strategy planned/applied attribution", () => {
  it("emits strategy_applied only for planned strategies confirmed by consolidation, anchored to the assistant message", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);

    const oldAssistantMessage = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        memoryOrigin: "learner",
        contentMarkdown: "旧的一轮策略。",
        sequence: 0,
      },
    });
    const userMessage = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "user",
        memoryOrigin: "learner",
        contentMarkdown: "还是不懂",
        sequence: 1,
      },
    });
    const assistantMessage = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        memoryOrigin: "learner",
        contentMarkdown: "先说不变量。",
        sequence: 2,
      },
    });

    for (const message of [userMessage, assistantMessage]) {
      await db.prisma.l1MemoryEvent.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          chatSessionId: chatSession.id,
          eventType:
            message.role === "user" ? "chat_user_message" : "chat_reply",
          memoryOrigin: "learner",
          eventJson: JSON.stringify({ chatMessageId: message.id }),
          occurredAt: message.createdAt,
        },
      });
    }
    await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "strategy_planned",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({
          strategyTag: "invariant_first",
          assistantMessageId: assistantMessage.id,
        }),
        occurredAt: assistantMessage.createdAt,
      },
    });
    await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "strategy_planned",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({
          strategyTag: "old_strategy",
          assistantMessageId: oldAssistantMessage.id,
        }),
        occurredAt: oldAssistantMessage.createdAt,
      },
    });

    const fts = createFtsStore(db.dbPath);
    await runChatConsolidation(db.prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "salience_stuck",
      ftsStore: fts,
      provider: {
        name: "scripted",
        async consolidate(input) {
          expect(
            (
              input as {
                plannedStrategies?: Array<{
                  strategyTag: string;
                  assistantMessageId: string;
                }>;
              }
            ).plannedStrategies,
          ).toEqual([
            {
              strategyTag: "invariant_first",
              assistantMessageId: assistantMessage.id,
            },
          ]);
          return consolidationOutputSchema.parse({
            episodeSummary: {
              title: "t",
              summary: "s",
              outcome: "unresolved",
              tags: ["binary_search"],
              salience: 0.9,
            },
            strategiesApplied: [
              {
                strategyTag: "invariant_first",
                appliedAssistantMessageId: assistantMessage.id,
              },
              {
                strategyTag: "made_up_strategy",
                appliedAssistantMessageId: assistantMessage.id,
              },
              {
                strategyTag: "invariant_first",
                appliedAssistantMessageId: "wrong-message",
              },
              {
                strategyTag: "old_strategy",
                appliedAssistantMessageId: oldAssistantMessage.id,
              },
            ],
            newRollingSummary: "summary",
          });
        },
      },
    });

    const appliedEvents = await db.prisma.l1MemoryEvent.findMany({
      where: { eventType: "strategy_applied" },
    });
    expect(appliedEvents).toHaveLength(1);
    const payload = JSON.parse(appliedEvents[0].eventJson) as {
      strategyTag: string;
      appliedAssistantMessageId: string;
      assistantSequence: number;
    };
    expect(payload).toEqual({
      strategyTag: "invariant_first",
      appliedAssistantMessageId: assistantMessage.id,
      assistantSequence: assistantMessage.sequence,
    });
    expect(appliedEvents[0].occurredAt.getTime()).toBe(
      assistantMessage.createdAt.getTime(),
    );
    fts.close();
  });
});
