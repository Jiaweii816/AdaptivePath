import {
  type ChatToolArgs,
  type ChatToolResult,
} from "./chat-tool-contracts";
import { apiReferenceKb } from "./api-reference-kb";
import { resolveKnowledgeBookQuery } from "@/server/memory/store/knowledge-book-resolver";
import type { ChatToolExecutionContext } from "./chat-tool-dispatch";

export async function lookupApiReferenceChatTool(
  args: ChatToolArgs<"lookup_api_reference">,
  context?: ChatToolExecutionContext & { toolCallId?: string },
): Promise<ChatToolResult<"lookup_api_reference">> {
  const topics = expandTopicAliases(args.topic, args.language);
  const handbookLookup =
    context
      ? await resolveKnowledgeBookQuery(context.prisma, {
          userId: context.userId,
          problemId: context.problem.id,
          chatSessionId: context.chatSessionId,
          userMessageId: context.userMessageId,
          queryText: context.userMessageContent ?? args.topic,
          language: args.language,
          ftsStore: context.ftsStore,
        })
      : undefined;
  const languageEntries = apiReferenceKb.filter(
    (item) => item.language === args.language,
  );
  const entry =
    languageEntries.find((item) =>
      topics.some((topic) => normalizeTopic(item.topic) === topic),
    ) ??
    languageEntries.find((item) =>
      topics.some((topic) => {
        const itemTopic = normalizeTopic(item.topic);
        return itemTopic.includes(topic) || topic.includes(itemTopic);
      }),
    );

  if (!entry) {
    return {
      found: false,
      language: args.language,
      topic: args.topic,
      handbookLookup,
      message:
        "No curated local cheat-sheet entry matched this topic. Do not retry with a loosely related topic; answer from general language knowledge instead.",
      availableTopics: apiReferenceKb
        .filter((item) => item.language === args.language)
        .map((item) => item.topic),
    };
  }

  return {
    found: true,
    language: args.language,
    topic: args.topic,
    entry,
    handbookLookup,
  };
}

function normalizeTopic(topic: string) {
  return topic.trim().toLowerCase().replaceAll("std::", "");
}

function expandTopicAliases(topic: string, language: ChatToolArgs<"lookup_api_reference">["language"]) {
  const normalized = normalizeTopic(topic);
  const aliases = [normalized];

  if (language === "Python") {
    if (
      normalized.includes("双端队列") ||
      normalized.includes("队列") ||
      normalized.includes("queue") ||
      normalized.includes("deque")
    ) {
      aliases.push("deque", "collections");
    }
  }

  return [...new Set(aliases)];
}
