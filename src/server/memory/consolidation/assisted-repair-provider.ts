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
  assistedRepairConsolidationOutputSchema,
  type AssistedRepairConsolidationOutput,
} from "./assisted-repair-contract";
import { buildAssistedRepairConsolidationPrompt } from "./build-assisted-repair-prompt";

export type AssistedRepairConsolidationInput = {
  repairKey: string;
  problemTitle: string;
  problemTags: string[];
  evidenceTraceIds: string[];
  failed: { code: string; resultSummary: string };
  userQuestion: string;
  coachReply: string;
  passed: { code: string; resultSummary: string };
};

export type AssistedRepairConsolidationProvider = {
  name: string;
  consolidate: (
    input: AssistedRepairConsolidationInput,
    traceContext?: TraceContext,
  ) => Promise<AssistedRepairConsolidationOutput>;
};

export function createLlmAssistedRepairConsolidationProvider(
  options: { client?: OpenAI; model?: string } = {},
): AssistedRepairConsolidationProvider {
  const client = options.client ?? createMemoryClient();
  const model = options.model ?? getMemoryModel();
  return {
    name: `llm-assisted-repair:${model}`,
    async consolidate(input, traceContext) {
      const step = startTraceStep(traceContext, { spanKind: "llm" });
      const startedAt = Date.now();
      let completion: ChatCompletion | undefined;
      try {
        completion = (await client.chat.completions.create(
          withMemoryNonStreamingCompatibility({
            model,
            temperature: 0.1,
            messages: [
              {
                role: "system",
                content:
                  "You are PatternCoach AI MemoryAgent consolidating a verified assisted repair experience. Return compact JSON only.",
              },
              {
                role: "user",
                content: buildAssistedRepairConsolidationPrompt(input),
              },
            ],
          }),
        )) as ChatCompletion;
        const content = completion.choices[0]?.message.content;
        if (!content) throw new Error("Assisted repair consolidation returned an empty response.");
        const output = assistedRepairConsolidationOutputSchema.parse(
          parseJsonObject(content),
        );
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "memory.consolidate_assisted_repair",
          source: "memory_agent:consolidate_assisted_repair",
          content: `consolidated assisted repair ${input.repairKey}`,
          model,
          responseModel: completion.model,
          latencyMs,
          status: "ok",
          finishReason: completion.choices[0]?.finish_reason ?? null,
          usage: completion.usage,
        });
        return output;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "memory.consolidate_assisted_repair",
          source: "memory_agent:consolidate_assisted_repair",
          content: `assisted repair consolidation failed for ${input.repairKey}`,
          model,
          responseModel: completion?.model ?? null,
          latencyMs,
          status: "error",
          finishReason: completion?.choices[0]?.finish_reason ?? null,
          usage: completion?.usage ?? null,
          usageMissingReason: "error_response",
          error,
        });
        throw error;
      }
    },
  };
}

export function getAssistedRepairConsolidationProvider() {
  return createLlmAssistedRepairConsolidationProvider();
}

function parseJsonObject(content: string): unknown {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
    }
    throw new Error("Assisted repair consolidation did not contain valid JSON.");
  }
}
