import { irisHandle } from "@/features/onboarding/profile-defaults";
import { runStatusKind } from "@/lib/ui-status";
import prisma from "@/server/db/prisma";
import { resolveLearnerActivityLedgerOrigins } from "@/server/memory/memory-origin";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
import { sanitizeToolProtocolText } from "@/server/llm/tool-protocol-leak";

export type ChatReplayMessage = {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  label: string;
  contentMarkdown: string;
  sequence: number;
  createdAt: Date;
};

export type ChatReplayToolStep = {
  kind: "tool";
  id: string;
  toolCallId: string;
  toolName: string;
  displayName: string;
  argumentSummary: string;
  resultSummary: string;
  occurredAt: Date;
};

export type ChatReplayItem = ChatReplayMessage | ChatReplayToolStep;

export type ChatSessionStatus = "resolved" | "failed" | "in_progress";

export type ChatHistorySession = {
  id: string;
  title: string;
  primaryLanguage: string | null;
  createdAt: Date;
  updatedAt: Date;
  problem: {
    id: string;
    slug: string;
    title: string;
    leetcodeNumber: number | null;
    difficulty: string | null;
  };
  problemHistoryHref: string | null;
  replay: ChatReplayItem[];
  messageCount: number;
  status: ChatSessionStatus;
};

export type ChatHistoryBucketLabel =
  "Today" | "Yesterday" | "This Week" | "Earlier";

export type ChatHistoryBucket = {
  label: ChatHistoryBucketLabel;
  sessions: ChatHistorySession[];
};

export type ChatHistorySnapshot = {
  difficulty: string | null;
  tags: string[];
  statementExcerpt: string;
  examples: Array<{ input: unknown; output: unknown; explanation?: string }>;
  draftLanguage: string | null;
  draftContent: string | null;
};

export type ChatHistoryPageData = {
  buckets: ChatHistoryBucket[];
  selected: ChatHistorySession | null;
  selectedSnapshot: ChatHistorySnapshot | null;
  selectedSessionId: string;
};

function startOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

export function bucketByRecency(
  sessions: ChatHistorySession[],
  now: Date = new Date(),
): ChatHistoryBucket[] {
  const today = startOfDay(now);
  const dayMs = 24 * 60 * 60 * 1000;
  const order: ChatHistoryBucketLabel[] = [
    "Today",
    "Yesterday",
    "This Week",
    "Earlier",
  ];
  const map = new Map<ChatHistoryBucketLabel, ChatHistorySession[]>();
  const sorted = [...sessions].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  for (const session of sorted) {
    const day = startOfDay(session.updatedAt);
    let label: ChatHistoryBucketLabel;
    if (day === today) label = "Today";
    else if (day === today - dayMs) label = "Yesterday";
    else if (day > today - 7 * dayMs) label = "This Week";
    else label = "Earlier";
    map.set(label, [...(map.get(label) ?? []), session]);
  }

  return order
    .filter((label) => map.has(label))
    .map((label) => ({ label, sessions: map.get(label) ?? [] }));
}

type RawChatMessage = {
  id: string;
  role: string;
  contentMarkdown: string;
  metadataJson: string;
  sequence: number;
  createdAt: Date;
};

type RawToolEvent = {
  id: string;
  eventType: string;
  eventJson: string;
  occurredAt: Date;
  createdAt: Date;
};

type ParsedToolEvent = {
  id: string;
  eventType: "tool_call" | "tool_result";
  toolCallId: string;
  toolName: string;
  arguments?: unknown;
  result?: unknown;
  occurredAt: Date;
  createdAt: Date;
};

function sessionStatus(runStatus: string | undefined): ChatSessionStatus {
  if (!runStatus) return "in_progress";
  const kind = runStatusKind(runStatus);
  if (kind === "passed") return "resolved";
  if (kind === "failed") return "failed";
  return "in_progress";
}

export async function getChatHistoryPageData(filters: {
  sessionId?: string;
}): Promise<ChatHistoryPageData> {
  const user = await prisma.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });

  const rawSessions = await prisma.chatSession.findMany({
    where: {
      userId: user.id,
      memoryOrigin: { in: resolveLearnerActivityLedgerOrigins() },
    },
    include: {
      problem: true,
      messages: { orderBy: { sequence: "asc" } },
      problemHistories: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });
  const projectedToolEvents = await loadFormalTraceProjection(prisma, {
    userId: user.id,
    chatSessionIds: rawSessions.map((session) => session.id),
    eventTypes: ["tool_call", "tool_result"],
    order: "asc",
  });
  const toolEventsBySession = new Map<string, RawToolEvent[]>();
  for (const event of projectedToolEvents) {
    if (!event.chatSessionId) continue;
    const events = toolEventsBySession.get(event.chatSessionId) ?? [];
    events.push(event);
    toolEventsBySession.set(event.chatSessionId, events);
  }

  const sessions: ChatHistorySession[] = rawSessions.map((session) => {
    const visible = filterChatHistoryAfterClear({
      messages: session.messages,
      toolEvents: toolEventsBySession.get(session.id) ?? [],
      clearedBeforeSequence: session.clearedBeforeSequence,
      clearedAt: session.clearedAt,
    });

    return {
      id: session.id,
      title: session.title ?? session.problem.title,
      primaryLanguage: session.primaryLanguage,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      problem: {
        id: session.problem.id,
        slug: session.problem.slug,
        title: session.problem.title,
        leetcodeNumber: session.problem.leetcodeNumber,
        difficulty: session.problem.difficulty,
      },
      problemHistoryHref:
        session.problemHistories.length > 0
          ? `/history/problems?problem=${session.problem.slug}`
          : null,
      replay: buildChatReplay({
        messages: visible.messages,
        toolEvents: visible.toolEvents,
      }),
      messageCount: visible.messages.length,
      status: sessionStatus(session.problemHistories[0]?.runStatus),
    };
  });

  const selectedId = filters.sessionId ?? sessions[0]?.id ?? "";
  const selectedRaw =
    rawSessions.find((session) => session.id === selectedId) ?? null;
  const selected =
    sessions.find((session) => session.id === selectedId) ?? null;

  const selectedSnapshot = selectedRaw
    ? await buildSnapshot({
        userId: user.id,
        problem: selectedRaw.problem,
        primaryLanguage: selectedRaw.primaryLanguage,
      })
    : null;

  return {
    buckets: bucketByRecency(sessions),
    selected,
    selectedSnapshot,
    selectedSessionId: selectedId,
  };
}

async function buildSnapshot(args: {
  userId: string;
  problem: {
    id: string;
    difficulty: string | null;
    tags: string;
    statementMarkdown: string;
    examplesJson: string;
  };
  primaryLanguage: string | null;
}): Promise<ChatHistorySnapshot> {
  const draft = await prisma.codeDraft.findFirst({
    where: {
      userId: args.userId,
      problemId: args.problem.id,
      ...(args.primaryLanguage ? { language: args.primaryLanguage } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  const statement = args.problem.statementMarkdown.trim();
  const statementExcerpt =
    statement.length > 320 ? `${statement.slice(0, 320)}…` : statement;

  return {
    difficulty: args.problem.difficulty,
    tags: parseJson<string[]>(args.problem.tags, []),
    statementExcerpt,
    examples: parseJson<ChatHistorySnapshot["examples"]>(
      args.problem.examplesJson,
      [],
    ),
    draftLanguage: draft?.language ?? args.primaryLanguage,
    draftContent: draft?.content ?? null,
  };
}

export function buildChatReplay(args: {
  messages: RawChatMessage[];
  toolEvents: RawToolEvent[];
}): ChatReplayItem[] {
  const messages = args.messages
    .map(toReplayMessage)
    .filter((message): message is ChatReplayMessage => Boolean(message))
    .sort((a, b) => a.sequence - b.sequence);
  const toolSteps = pairToolSteps(args.toolEvents);
  const replay: ChatReplayItem[] = [];
  const usedToolStepIds = new Set<string>();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    replay.push(message);

    if (message.role !== "user") {
      continue;
    }

    const nextAssistant = messages
      .slice(index + 1)
      .find((candidate) => candidate.role === "assistant");
    const windowEnd =
      nextAssistant?.createdAt.getTime() ?? Number.POSITIVE_INFINITY;

    for (const toolStep of toolSteps) {
      const toolTime = toolStep.occurredAt.getTime();

      if (
        !usedToolStepIds.has(toolStep.id) &&
        toolTime >= message.createdAt.getTime() &&
        toolTime <= windowEnd
      ) {
        replay.push(toolStep);
        usedToolStepIds.add(toolStep.id);
      }
    }
  }

  for (const toolStep of toolSteps) {
    if (!usedToolStepIds.has(toolStep.id)) {
      replay.push(toolStep);
    }
  }

  return replay;
}

export function filterChatHistoryAfterClear<
  TMessage extends { sequence: number },
  TToolEvent extends { eventJson: string; occurredAt: Date },
>(args: {
  messages: TMessage[];
  toolEvents: TToolEvent[];
  clearedBeforeSequence: number;
  clearedAt: Date | null;
}): { messages: TMessage[]; toolEvents: TToolEvent[] } {
  return {
    messages: args.messages.filter(
      (message) => message.sequence > args.clearedBeforeSequence,
    ),
    toolEvents: args.toolEvents.filter((event) =>
      isToolEventAfterClear({
        event,
        clearedBeforeSequence: args.clearedBeforeSequence,
        clearedAt: args.clearedAt,
      }),
    ),
  };
}

function isToolEventAfterClear(args: {
  event: { eventJson: string; occurredAt: Date };
  clearedBeforeSequence: number;
  clearedAt: Date | null;
}) {
  const sequence = parseToolEventSequence(args.event.eventJson);

  if (sequence !== null) {
    return sequence > args.clearedBeforeSequence;
  }

  return !args.clearedAt || args.event.occurredAt > args.clearedAt;
}

function parseToolEventSequence(eventJson: string) {
  const parsed = parseJson<{ sequence?: unknown }>(eventJson, {});

  return typeof parsed.sequence === "number" && Number.isFinite(parsed.sequence)
    ? parsed.sequence
    : null;
}

function toReplayMessage(
  message: RawChatMessage,
): ChatReplayMessage | undefined {
  if (message.role !== "user" && message.role !== "assistant") {
    return undefined;
  }

  const metadata = parseJson<{ type?: string }>(message.metadataJson, {});
  const label =
    message.role === "user"
      ? "User"
      : metadata.type === "review_reply"
        ? "Review Reply"
        : "Coach";

  return {
    kind: "message",
    id: message.id,
    role: message.role,
    label,
    contentMarkdown:
      message.role === "assistant"
        ? sanitizeToolProtocolText(message.contentMarkdown).text
        : message.contentMarkdown,
    sequence: message.sequence,
    createdAt: message.createdAt,
  };
}

function pairToolSteps(events: RawToolEvent[]): ChatReplayToolStep[] {
  const parsedEvents = events
    .map(parseToolEvent)
    .filter((event): event is ParsedToolEvent => Boolean(event));
  const callsById = new Map(
    parsedEvents
      .filter((event) => event.eventType === "tool_call")
      .map((event) => [event.toolCallId, event]),
  );
  const resultEvents = parsedEvents.filter(
    (event) => event.eventType === "tool_result",
  );
  const steps = resultEvents.map((resultEvent) => {
    const callEvent = callsById.get(resultEvent.toolCallId);
    const toolName = resultEvent.toolName || callEvent?.toolName || "tool";

    return {
      kind: "tool" as const,
      id: resultEvent.id,
      toolCallId: resultEvent.toolCallId,
      toolName,
      displayName: displayToolName(toolName),
      argumentSummary: summarizeToolArguments(toolName, callEvent?.arguments),
      resultSummary: summarizeToolResult(toolName, resultEvent.result),
      occurredAt: callEvent?.occurredAt ?? resultEvent.occurredAt,
    };
  });
  const resultIds = new Set(resultEvents.map((event) => event.toolCallId));
  const callsWithoutResults = [...callsById.values()]
    .filter((callEvent) => !resultIds.has(callEvent.toolCallId))
    .map((callEvent) => ({
      kind: "tool" as const,
      id: callEvent.id,
      toolCallId: callEvent.toolCallId,
      toolName: callEvent.toolName,
      displayName: displayToolName(callEvent.toolName),
      argumentSummary: summarizeToolArguments(
        callEvent.toolName,
        callEvent.arguments,
      ),
      resultSummary: "No tool result was recorded.",
      occurredAt: callEvent.occurredAt,
    }));

  return [...steps, ...callsWithoutResults].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
}

function parseToolEvent(event: RawToolEvent): ParsedToolEvent | undefined {
  if (event.eventType !== "tool_call" && event.eventType !== "tool_result") {
    return undefined;
  }

  const parsed = parseJson<{
    toolCallId?: unknown;
    toolName?: unknown;
    arguments?: unknown;
    result?: unknown;
  }>(event.eventJson, {});

  if (
    typeof parsed.toolCallId !== "string" ||
    typeof parsed.toolName !== "string"
  ) {
    return undefined;
  }

  return {
    id: event.id,
    eventType: event.eventType,
    toolCallId: parsed.toolCallId,
    toolName: parsed.toolName,
    arguments: parsed.arguments,
    result: parsed.result,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
  };
}

function displayToolName(toolName: string) {
  const names: Record<string, string> = {
    run_code: "Run Code",
    run_current_code: "Run Current Code",
    verify_proposed_repair: "Verify Proposed Repair",
    past_mistake_recall: "Past Mistake Recall",
    find_practice_problem: "Practice Recommendation",
    get_algorithm_hint: "Algorithm Hint",
    lookup_api_reference: "API Reference",
    past_problem_recall: "Past Problem Recall",
    note_memory: "Memory Note",
    save_knowledge_note: "Knowledge Handbook",
    save_mistake_book_entry: "Mistake Book",
  };

  return names[toolName] ?? toolName;
}

function summarizeToolArguments(toolName: string, args: unknown) {
  const value = asRecord(args);

  if (toolName === "run_code" || toolName === "run_current_code") {
    const language = stringValue(value.language) ?? "code";
    const tests = Array.isArray(value.tests) ? value.tests : [];
    const labels = tests
      .map((test) => stringValue(asRecord(test).label))
      .filter(Boolean)
      .slice(0, 3);

    return labels.length > 0
      ? `${language}; tests: ${labels.join(", ")}`
      : `${language}; active visible tests`;
  }

  if (toolName === "verify_proposed_repair") {
    const language = stringValue(value.language) ?? "code";
    const repair = asRecord(value.repair);
    const description = stringValue(repair.diagnosis);
    const tests = Array.isArray(value.tests) ? value.tests : [];
    const labels = tests
      .map((test) => stringValue(asRecord(test).label))
      .filter(Boolean)
      .slice(0, 3);
    const testSummary =
      labels.length > 0
        ? `tests: ${labels.join(", ")}`
        : "active visible tests";

    return description
      ? `${language}; candidate: ${description}; ${testSummary}`
      : `${language}; assistant candidate; ${testSummary}`;
  }

  if (
    toolName === "past_mistake_recall" ||
    toolName === "past_problem_recall"
  ) {
    const query = stringValue(value.query) ?? "learner history";
    const hints = Array.isArray(value.searchHints)
      ? value.searchHints.filter((hint): hint is string => typeof hint === "string")
      : [];
    return hints.length > 0
      ? `${query}; hints: ${hints.slice(0, 3).join(", ")}`
      : query;
  }

  if (toolName === "find_practice_problem") {
    const tags = Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : [];

    return `${stringValue(value.mode) ?? "practice"}; ${tags.join(", ") || "current tags"}`;
  }

  if (toolName === "get_algorithm_hint") {
    const focus = stringValue(value.focus);
    const slug = stringValue(value.problem_slug) ?? "active problem";
    return focus ? `${slug}; focus: ${focus}` : slug;
  }

  if (toolName === "lookup_api_reference") {
    return `${stringValue(value.language) ?? "language"} ${stringValue(value.topic) ?? "topic"}`;
  }

  if (toolName === "save_knowledge_note") {
    const title = stringValue(value.title) ?? stringValue(value.conceptKey);
    return title ? `saved concept: ${title}` : "knowledge note";
  }

  if (toolName === "save_mistake_book_entry") {
    const title = stringValue(value.title);
    return title ? `saved problem guide: ${title}` : "mistake-book entry";
  }

  return "tool arguments recorded";
}

function summarizeToolResult(toolName: string, result: unknown) {
  const value = asRecord(result);

  if (
    toolName === "run_code" ||
    toolName === "run_current_code" ||
    toolName === "verify_proposed_repair"
  ) {
    if (value.repairValidated === false) {
      return stringValue(value.message) ?? "Proposed repair was not run.";
    }
    const runResult = asRecord(value.result);
    const status = stringValue(runResult.status) ?? "runner result";
    const passed = numberValue(runResult.passedCount) ?? 0;
    const failed = numberValue(runResult.failedCount) ?? 0;
    const failedCase = asRecord(runResult.firstFailedCase);
    const failedLabel = stringValue(failedCase.label);
    const errorDetail = asRecord(runResult.errorDetail);
    const errorTitle = stringValue(errorDetail.title);

    return failedLabel
      ? `${status}: ${passed} passed, ${failed} failed; first failed case ${failedLabel}.`
      : errorTitle
        ? `${status}: ${passed} passed, ${failed} failed; ${errorTitle}.`
        : `${status}: ${passed} passed, ${failed} failed.`;
  }

  if (
    toolName === "past_mistake_recall" ||
    toolName === "past_problem_recall"
  ) {
    const items = Array.isArray(value.items) ? value.items : [];
    const titles = items
      .map((item) => stringValue(asRecord(item).title))
      .filter(Boolean)
      .slice(0, 3);
    const noun = toolName === "past_mistake_recall" ? "mistake" : "problem";
    return titles.length > 0
      ? `${items.length} past ${noun} item(s): ${titles.join(", ")}.`
      : `No relevant past ${noun} history.`;
  }

  if (toolName === "find_practice_problem") {
    const suggestions = Array.isArray(value.suggestions)
      ? value.suggestions
          .map((suggestion) => {
            const item = asRecord(suggestion);
            const number = numberValue(item.leetcodeNumber);
            const title = stringValue(item.title);

            return number && title ? `${number}. ${title}` : title;
          })
          .filter(Boolean)
          .slice(0, 3)
      : [];

    return suggestions.length > 0
      ? `Suggested ${suggestions.join(", ")}.`
      : "No practice suggestion matched.";
  }

  if (toolName === "get_algorithm_hint") {
    const hintPolicy = asRecord(value.hintPolicy);
    const hint = asRecord(value.hint);
    const heading = stringValue(hint.heading) ?? stringValue(hintPolicy.mode);
    const level = numberValue(value.level);

    return heading
      ? `Level ${level ?? "?"}: ${heading}.`
      : (stringValue(value.message) ?? "Hint policy checked.");
  }

  if (toolName === "lookup_api_reference") {
    const entry = asRecord(value.entry);
    const summary = stringValue(entry.summary);

    return summary ?? stringValue(value.message) ?? "API reference checked.";
  }

  if (toolName === "save_knowledge_note") {
    const title = stringValue(value.title) ?? stringValue(value.conceptKey);
    const count = numberValue(value.lookupCount);
    return title
      ? `${title} saved to Knowledge Handbook${count ? `, lookup #${count}` : ""}.`
      : "Knowledge note checked.";
  }

  if (toolName === "save_mistake_book_entry") {
    const title = stringValue(value.title);
    const count = numberValue(value.saveCount);
    return title
      ? `${title} saved to Mistake Book${count ? `, save #${count}` : ""}.`
      : "Mistake Book entry checked.";
  }

  return "Tool result recorded.";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
