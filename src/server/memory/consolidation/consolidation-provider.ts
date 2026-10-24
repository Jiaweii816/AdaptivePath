import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { createMemoryClient } from "@/server/llm/client";
import { withMemoryNonStreamingCompatibility } from "@/server/llm/memory-provider-compat";
import { getMemoryModel } from "@/server/llm/models";
import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";
import {
  consolidationOutputSchema,
  normalizeMemoryTag,
  type ConsolidationOutput,
} from "@/server/memory/memory.types";
import { buildConsolidationPrompt } from "./build-consolidation-prompt";

export type ConsolidationInput = {
  problemTitle: string;
  problemTags: string[];
  triggerReason: string;
  currentRollingSummary?: string;
  evidenceTraceIds: string[];
  plannedStrategies: Array<{ strategyTag: string; assistantMessageId: string }>;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

export type ChatConsolidationProvider = {
  name: string;
  consolidate: (
    input: ConsolidationInput,
    traceContext?: TraceContext,
  ) => Promise<ConsolidationOutput>;
};

export function createMockChatConsolidationProvider(): ChatConsolidationProvider {
  return {
    name: "mock-consolidation",
    async consolidate(input) {
      const userMessages = input.messages.filter(
        (message) => message.role === "user",
      );
      const isSalience = input.triggerReason.startsWith("salience");
      const tag = normalizeMemoryTag(input.problemTags[0] ?? "general");
      const mechanismTag = `${tag}_invariant_confusion`;

      return consolidationOutputSchema.parse({
        episodeSummary: {
          title: `Chat on ${input.problemTitle}: ${tag}`,
          summary:
            `${userMessages.length} user turns (trigger: ${input.triggerReason}). ` +
            `Last question: ${userMessages.at(-1)?.content.slice(0, 160) ?? "none"}`,
          outcome: isSalience ? "unresolved" : "resolved",
          tags: [tag],
          salience: isSalience ? 0.9 : 0.4,
        },
        factCandidates:
          isSalience && input.evidenceTraceIds.length > 0
            ? [
                {
                  factType: "unresolved_confusion",
                  tag: mechanismTag,
                  value: `User asked about ${tag} repeatedly without resolving it.`,
                  evidenceKind: "reinforce",
                  observedBehavior: userMessages
                    .map((message) => message.content.slice(0, 60))
                    .join(" | ")
                    .slice(0, 300),
                  evidenceTraceIds: input.evidenceTraceIds,
                },
              ]
            : [],
        newRollingSummary:
          `${input.currentRollingSummary ? `${input.currentRollingSummary} ` : ""}` +
          `Discussed ${tag} on ${input.problemTitle} (${input.messages.length} messages, ${input.triggerReason}).`,
      });
    },
  };
}

export function createLlmChatConsolidationProvider(
  options: { client?: OpenAI; model?: string } = {},
): ChatConsolidationProvider {
  const client = options.client ?? createMemoryClient();
  const model = options.model ?? getMemoryModel();

  return {
    name: `llm-consolidation:${model}`,
    async consolidate(input, traceContext) {
      const step = startTraceStep(traceContext, { spanKind: "llm" });
      const startedAt = Date.now();
      let completion: ChatCompletion | undefined;

      try {
        completion = (await client.chat.completions.create(
          withMemoryNonStreamingCompatibility({
            model,
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "You are PatternCoach AI MemoryAgent consolidating a chat segment. Return compact JSON only.",
              },
              { role: "user", content: buildConsolidationPrompt(input) },
            ],
          }),
        )) as ChatCompletion;
        const content = completion.choices[0]?.message.content;

        if (!content) {
          throw new Error("Consolidation LLM returned an empty response.");
        }

        const output = consolidationOutputSchema.parse(parseJsonObject(content));
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "memory.consolidate_chat",
          source: "memory_agent:consolidate_chat",
          content: `consolidated ${input.messages.length} messages (${input.triggerReason})`,
          model,
          responseModel: completion.model,
          latencyMs,
          status: "ok",
          finishReason: completion.choices[0]?.finish_reason ?? null,
          usage: completion.usage,
          extraEventJson: {
            provider: `llm-consolidation:${model}`,
            triggerReason: input.triggerReason,
            messageCount: input.messages.length,
            strategySignals: output.strategySignals,
            timings: {
              totalMs: latencyMs,
              llmMsTotal: latencyMs,
            },
          },
        });

        return output;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "memory.consolidate_chat",
          source: "memory_agent:consolidate_chat",
          content: `consolidation failed for ${input.messages.length} messages (${input.triggerReason})`,
          model,
          responseModel: completion?.model ?? null,
          latencyMs,
          status: "error",
          finishReason: completion?.choices[0]?.finish_reason ?? null,
          usage: completion?.usage ?? null,
          usageMissingReason: "error_response",
          error,
          extraEventJson: {
            provider: `llm-consolidation:${model}`,
            triggerReason: input.triggerReason,
            messageCount: input.messages.length,
            timings: {
              totalMs: latencyMs,
              llmMsTotal: latencyMs,
            },
          },
        });
        throw error;
      }
    },
  };
}

export function getChatConsolidationProvider(): ChatConsolidationProvider {
  if (process.env.CHAT_CONSOLIDATION_PROVIDER === "mock") {
    return createMockChatConsolidationProvider();
  }

  return createLlmChatConsolidationProvider();
}

function parseJsonObject(content: string): unknown {
  const sanitized = escapeControlCharsInStrings(content);

  try {
    return JSON.parse(sanitized) as unknown;
  } catch {
    const unfenced = sanitized
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return JSON.parse(unfenced) as unknown;
    } catch {
      const start = sanitized.indexOf("{");
      const end = sanitized.lastIndexOf("}");

      if (start >= 0 && end > start) {
        return JSON.parse(sanitized.slice(start, end + 1)) as unknown;
      }

      throw new Error("Consolidation LLM output did not contain valid JSON.");
    }
  }
}

function escapeControlCharsInStrings(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      result += ch;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (ch === "\n") {
        result += "\\n";
        continue;
      }
      if (ch === "\r") {
        result += "\\r";
        continue;
      }
      if (ch === "\t") {
        result += "\\t";
        continue;
      }
    }

    result += ch;
  }

  return result;
}
