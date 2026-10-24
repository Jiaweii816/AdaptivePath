import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { createStrategistClient } from "@/server/llm/client";
import { getStrategistModel } from "@/server/llm/models";
import type { ProviderUsage, TraceContext } from "@/server/llm/trace-context";
import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
} from "@/server/llm/trace-context";
import {
  STRATEGIST_PROMPT_VERSION,
  canonicalStrategistJson,
  type StrategistProviderOutput,
  type StrategistReadModel,
} from "../domain";

export type StrategistProviderResult = Readonly<{
  content: string;
  provider: string;
  modelAlias: string;
  responseModel: string | null;
  latencyMs: number;
  usage: ProviderUsage | null;
}>;

export type StrategistProvider = Readonly<{
  name: string;
  modelAlias: string;
  propose: (readModel: StrategistReadModel, traceContext?: TraceContext) => Promise<StrategistProviderResult>;
}>;

const SYSTEM_PROMPT = `You are PatternCoach's Campaign Strategist. Return exactly one JSON object.
Choose no_change unless a small, high-value future-route adjustment is justified.
You may only propose M4A Skeleton operations for future transferable nodes, mixedWindowDays, and an optional daily budget suggestion.
Required prerequisites are hard constraints; recommended prerequisites are soft ordering. Preserve the current started node. Repair Queue work is handled by the Daily Selector. Today's task is immutable.
Never modify mastery, learner state, evidence, memory, phase, today's task, curriculum, or non-transferable coverage. Never auto-accept a patch. Never use company or hours/week targeting.
Output either {"decision":"no_change","rationale":"..."} or {"decision":"propose_patch","rationale":"...","operations":[...],"dailyBudgetSuggestion":null}.`;

export function buildStrategistPrompt(readModel: StrategistReadModel) {
  return [
    { role: "system" as const, content: `${SYSTEM_PROMPT}\nPrompt version: ${STRATEGIST_PROMPT_VERSION}.` },
    { role: "user" as const, content: `STRATEGIST READ MODEL\n${canonicalStrategistJson(readModel)}` },
  ];
}

export function createOpenAiStrategistProvider(options: { client?: OpenAI; model?: string } = {}): StrategistProvider {
  const client = options.client ?? createStrategistClient();
  const model = options.model ?? getStrategistModel();
  return {
    name: `openai-compatible-strategist:${model}`,
    modelAlias: model,
    async propose(readModel, traceContext) {
      const messages = buildStrategistPrompt(readModel);
      const step = startTraceStep(traceContext, { spanKind: "llm" });
      const startedAt = Date.now();
      let completion: ChatCompletion | undefined;
      try {
        completion = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.1,
          max_tokens: 1_600,
          response_format: { type: "json_object" },
        }) as ChatCompletion;
        const content = completion.choices[0]?.message.content;
        if (!content) throw new Error("Strategist provider returned an empty response.");
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "campaign.strategist.propose_patch",
          source: "campaign_strategist",
          content: "single structured Strategist proposal",
          model,
          responseModel: completion.model,
          latencyMs,
          status: "ok",
          finishReason: completion.choices[0]?.finish_reason ?? null,
          usage: completion.usage ?? null,
          prompt: messages,
          rawOutput: content,
          extraEventJson: { promptVersion: STRATEGIST_PROMPT_VERSION, semanticCallCount: 1 },
        });
        return {
          content,
          provider: "openai-compatible",
          modelAlias: model,
          responseModel: completion.model,
          latencyMs,
          usage: completion.usage ?? null,
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "campaign.strategist.propose_patch",
          source: "campaign_strategist",
          content: "Strategist provider call failed",
          model,
          responseModel: completion?.model ?? null,
          latencyMs,
          status: "error",
          usage: completion?.usage ?? null,
          usageMissingReason: "error_response",
          error,
          prompt: messages,
          extraEventJson: { promptVersion: STRATEGIST_PROMPT_VERSION, semanticCallCount: 1 },
        });
        throw error;
      }
    },
  };
}

export function createStubStrategistProvider(output: StrategistProviderOutput | string, options: { delay?: Promise<void>; onCall?: () => void } = {}): StrategistProvider {
  return {
    name: "stub-strategist",
    modelAlias: "stub-strategist-v1",
    async propose() {
      options.onCall?.();
      await options.delay;
      return {
        content: typeof output === "string" ? output : JSON.stringify(output),
        provider: "stub",
        modelAlias: "stub-strategist-v1",
        responseModel: "stub-strategist-v1",
        latencyMs: 0,
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };
    },
  };
}
