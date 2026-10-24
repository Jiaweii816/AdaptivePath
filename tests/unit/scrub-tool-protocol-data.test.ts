import { describe, expect, it } from "vitest";
import {
  redactTracePayloadFields,
  scrubToolProtocolData,
} from "@/server/llm/scrub-tool-protocol-data";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
} from "./memory-test-helpers";

describe("tool protocol data scrub", () => {
  it("quarantines only trace fields containing strong protocol output", () => {
    const result = redactTracePayloadFields({
      promptJson: JSON.stringify({ prompt: "ordinary" }),
      inputJson: null,
      outputJson:
        '{"content":"<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name=save_knowledge_note>"}',
      retrievalJson: null,
      stateDeltaJson: null,
      memoryDeltaJson: null,
      detailMetadataJson: null,
      stdout: "normal stdout",
      stderr: null,
    });

    expect(result.redactedFields).toEqual(["details.outputJson"]);
    expect(result.values.outputJson).not.toContain("invoke name");
    expect(result.values.promptJson).toBeUndefined();
    expect(result.leaks.outputJson).toMatchObject({
      sentinelIds: expect.arrayContaining(["dsml_tool_calls"]),
    });
  });

  it("scrubs ChatMessage idempotently while keeping old L1 content append-only", async () => {
    const db = await createMemoryTestDb();
    const leak =
      "< | | DSML | | tool_calls>< | | DSML | | invoke name=save_knowledge_note>";

    try {
      const fixture = await seedMinimalUserAndProblem(db.prisma);
      const message = await db.prisma.chatMessage.create({
        data: {
          sessionId: fixture.chatSession.id,
          role: "assistant",
          contentMarkdown: leak,
          sequence: 1,
        },
      });
      const oldL1 = await db.prisma.l1MemoryEvent.create({
        data: {
          userId: fixture.user.id,
          problemId: fixture.problem.id,
          chatSessionId: fixture.chatSession.id,
          eventType: "chat_reply",
          content: leak,
        },
      });

      await expect(scrubToolProtocolData(db.prisma)).resolves.toMatchObject({
        apply: false,
        scrubbedMessages: 1,
      });
      await expect(
        db.prisma.chatMessage.findUniqueOrThrow({ where: { id: message.id } }),
      ).resolves.toMatchObject({ contentMarkdown: leak });

      await expect(
        scrubToolProtocolData(db.prisma, { apply: true }),
      ).resolves.toMatchObject({ apply: true, scrubbedMessages: 1 });
      const scrubbed = await db.prisma.chatMessage.findUniqueOrThrow({
        where: { id: message.id },
      });
      expect(scrubbed.contentMarkdown).not.toContain("DSML");
      await expect(
        db.prisma.l1MemoryEvent.findUniqueOrThrow({ where: { id: oldL1.id } }),
      ).resolves.toMatchObject({ content: leak });
      await expect(
        db.prisma.l1MemoryEvent.count({
          where: {
            chatSessionId: fixture.chatSession.id,
            eventType: "reply_protocol_scrubbed",
          },
        }),
      ).resolves.toBe(1);

      await expect(
        scrubToolProtocolData(db.prisma, { apply: true }),
      ).resolves.toMatchObject({ scrubbedMessages: 0 });
      await expect(
        db.prisma.l1MemoryEvent.count({
          where: { eventType: "reply_protocol_scrubbed" },
        }),
      ).resolves.toBe(1);
    } finally {
      await db.cleanup();
    }
  });
});
