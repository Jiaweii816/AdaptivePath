import type { PrismaClient } from "@prisma/client";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import {
  matchAssistedRepairChain,
  type AssistedRepairChain,
  type FailedPracticeRunCandidate,
  type RepairChatPair,
} from "@/server/memory/assisted-repair-chain";
import type { CodeRunnerLanguage } from "@/types/code-runner";
import type { EvidenceVerdict } from "@/types/evidence";

type AssistedRepairLookupPrisma = Pick<
  PrismaClient,
  "practiceRunLog" | "chatMessage" | "l1MemoryEvent"
>;

export async function loadReviewAssistedRepairChain(
  prisma: AssistedRepairLookupPrisma,
  args: {
    userId: string;
    problemId: string;
    chatSessionId: string;
    language: CodeRunnerLanguage;
    memoryOrigin: MemoryOrigin;
    passedAt: Date;
    passedStatus: string;
    passedCodeHash: string;
    passedExecutionFingerprint: string;
    passedSelectedTestCaseIds: string[];
    evidenceVerdict: EvidenceVerdict;
  },
): Promise<AssistedRepairChain | undefined> {
  if (args.passedStatus !== "passed_visible_tests") return undefined;

  const [runs, messages, traceEvents] = await Promise.all([
    prisma.practiceRunLog.findMany({
      where: {
        userId: args.userId,
        problemId: args.problemId,
        language: args.language,
        createdAt: { lt: args.passedAt },
        codeSnapshot: { not: null },
      },
      orderBy: [{ createdAt: "desc" }, { runOrdinal: "desc" }],
      take: 50,
    }),
    prisma.chatMessage.findMany({
      where: {
        sessionId: args.chatSessionId,
        memoryOrigin: args.memoryOrigin,
        role: { in: ["user", "assistant"] },
        createdAt: { lt: args.passedAt },
      },
      orderBy: { sequence: "asc" },
    }),
    prisma.l1MemoryEvent.findMany({
      where: {
        userId: args.userId,
        problemId: args.problemId,
        chatSessionId: args.chatSessionId,
        memoryOrigin: args.memoryOrigin,
        eventType: { in: ["chat_user_message", "chat_reply"] },
        occurredAt: { lt: args.passedAt },
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const failures = runs.map(
    (run): FailedPracticeRunCandidate => ({
      userId: args.userId,
      problemId: args.problemId,
      language: run.language,
      memoryOrigin: args.memoryOrigin,
      id: run.id,
      createdAt: run.createdAt,
      source: "practice_run",
      userTriggered: true,
      providerUsed: run.provider,
      status: run.status,
      codeHash: run.codeHash,
      executionFingerprint: run.executionFingerprint,
      selectedTestCaseIds: parseStringArray(run.selectedTestCaseIds),
      firstFailedCaseId: readFirstFailedCaseId(run.rawResultJson),
    }),
  );
  const traceByMessageId = new Map(
    traceEvents.flatMap((event) => {
      const messageId = readString(parseRecord(event.eventJson).chatMessageId);
      return messageId ? [[messageId, event] as const] : [];
    }),
  );
  const chatPairs = buildChatPairs(messages, traceByMessageId, args);

  return matchAssistedRepairChain({
    failedPracticeRuns: failures,
    chatPairs,
    passingRun: {
      userId: args.userId,
      problemId: args.problemId,
      language: args.language,
      memoryOrigin: args.memoryOrigin,
      endpoint: "review",
      userTriggered: true,
      createdAt: args.passedAt,
      status: args.passedStatus,
      codeHash: args.passedCodeHash,
      executionFingerprint: args.passedExecutionFingerprint,
      selectedTestCaseIds: args.passedSelectedTestCaseIds,
      evidenceScope: {
        evidenceClass: args.evidenceVerdict.evidenceClass,
        providerUsed: args.evidenceVerdict.providerUsed ?? null,
      },
    },
  });
}

function buildChatPairs(
  messages: Awaited<
    ReturnType<AssistedRepairLookupPrisma["chatMessage"]["findMany"]>
  >,
  traceByMessageId: Map<
    string,
    Awaited<
      ReturnType<AssistedRepairLookupPrisma["l1MemoryEvent"]["findMany"]>
    >[number]
  >,
  identity: {
    userId: string;
    problemId: string;
    language: CodeRunnerLanguage;
    memoryOrigin: MemoryOrigin;
    chatSessionId: string;
  },
) {
  const bySequence = new Map(messages.map((message) => [message.sequence, message]));
  return messages.flatMap((assistant): RepairChatPair[] => {
    if (assistant.role !== "assistant") return [];
    const user = bySequence.get(assistant.sequence - 1);
    if (!user || user.role !== "user") return [];
    const userMetadata = parseRecord(user.metadataJson);
    const assistantMetadata = parseRecord(assistant.metadataJson);
    if (
      userMetadata.type !== "chat_user_message" ||
      assistantMetadata.type !== "chat_reply"
    ) {
      return [];
    }
    const userTrace = traceByMessageId.get(user.id);
    const assistantTrace = traceByMessageId.get(assistant.id);
    if (!userTrace || !assistantTrace) return [];
    const userWorkspace = asRecord(userMetadata.workspace);
    const assistantWorkspace = asRecord(assistantMetadata.workspace);

    return [
      {
        user: {
          ...identity,
          id: user.id,
          traceId: userTrace.id,
          role: "user",
          createdAt: user.createdAt,
          ...workspaceProjection(userWorkspace),
        },
        assistant: {
          ...identity,
          id: assistant.id,
          traceId: assistantTrace.id,
          role: "assistant",
          createdAt: assistant.createdAt,
          ...workspaceProjection(assistantWorkspace),
        },
      },
    ];
  });
}

function workspaceProjection(workspace: Record<string, unknown> | undefined) {
  return {
    currentCodeHash: readString(workspace?.currentCodeHash) ?? null,
    currentExecutionFingerprint:
      readString(workspace?.currentExecutionFingerprint) ?? null,
    latestAuthoritativeRunEvidenceId:
      readString(workspace?.latestAuthoritativeRunEvidenceId) ?? null,
    latestAuthoritativeRunSource:
      readString(workspace?.latestAuthoritativeRunSource) ?? null,
    latestAuthoritativeRunStatus:
      readString(workspace?.latestAuthoritativeRunStatus) ?? null,
  };
}

function readFirstFailedCaseId(rawResultJson: string) {
  const raw = parseRecord(rawResultJson);
  const firstFailedCase = asRecord(raw.firstFailedCase);
  return readString(firstFailedCase?.id) ?? null;
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string) {
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
