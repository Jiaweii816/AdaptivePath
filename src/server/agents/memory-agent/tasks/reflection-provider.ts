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
  reflectionOutputSchema,
  strategyProposalSchema,
  type ReflectionOutput,
} from "@/server/memory/memory.types";
import { buildReflectionPrompt } from "./build-reflection-prompt";

export type ReflectionInput = {
  userHandle: string;
  episodes: Array<{
    id: string;
    title: string;
    summary: string;
    outcome: string;
    tags: string[];
  }>;
  changedFacts: Array<{
    id: string;
    factType: string;
    tag: string;
    value: string | null;
    claimText?: string | null;
    polarity?: string | null;
    scope?: {
      level: string;
      problemIds: string[];
      topicHints: string[];
      context?: string;
    };
    mechanismKeys?: string[];
    confidence: number;
    evidenceTraceIds: string[];
    evidenceClusters: Array<{
      id: string;
      problemId: string | null;
      reviewAttemptId: string | null;
    }>;
  }>;
  activeSlots: Array<{ slot: string; synthesisKey: string; text: string }>;
  strategySignals: Array<{
    tag: string;
    observation: string;
    polarity: "positive" | "negative";
  }>;
};

export type ReflectionProvider = {
  name: string;
  reflect: (
    input: ReflectionInput,
    traceContext?: TraceContext,
  ) => Promise<ReflectionOutput>;
};

export function createMockReflectionProvider(
  options: { forcedOutput?: ReflectionOutput } = {},
): ReflectionProvider {
  return {
    name: "mock-reflection",
    async reflect(input) {
      if (options.forcedOutput) {
        return reflectionOutputSchema.parse(options.forcedOutput);
      }

      const slotUpserts = [
        buildMockSynthesis(input.changedFacts, "weakness"),
        buildMockSynthesis(input.changedFacts, "strength"),
      ].filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));

      const strategyProposals = input.strategySignals
        .filter((signal) => signal.polarity === "positive")
        .slice(0, 1)
        .map((signal) => ({
          tag: signal.tag,
          hypothesis: `Strategy "${signal.tag}" appears to help: ${signal.observation}`.slice(
            0,
            300,
          ),
          expectedObservable: "reviewTransition" as const,
          evidenceTraceIds: input.changedFacts[0]?.evidenceTraceIds.slice(0, 1) ?? [],
        }))
        .filter((proposal) => proposal.evidenceTraceIds.length > 0);

      return reflectionOutputSchema.parse({
        slotUpserts,
        strategyProposals,
        factAudits: [],
      });
    },
  };
}

function buildMockSynthesis(
  facts: ReflectionInput["changedFacts"],
  polarity: "strength" | "weakness",
) {
  const matching = facts.filter((fact) =>
    polarity === "strength"
      ? fact.polarity === "positive" ||
        fact.factType === "strength" ||
        fact.factType === "skill"
      : fact.polarity === "negative" ||
        fact.factType === "weakness" ||
        fact.factType === "mistake" ||
        fact.factType === "unresolved_confusion",
  );
  const clusters = [
    ...new Map(
      matching
        .flatMap((fact) => fact.evidenceClusters)
        .map((cluster) => [cluster.id, cluster]),
    ).values(),
  ];
  const problemCount = new Set(
    clusters.flatMap((cluster) =>
      cluster.problemId ? [cluster.problemId] : [],
    ),
  ).size;
  if (clusters.length < 2 || problemCount < 2) return undefined;

  const readablePatterns = [
    ...new Set(
      matching.map(
        (fact) =>
          fact.claimText?.trim() ||
          fact.value?.trim() ||
          "a recurring learning pattern",
      ),
    ),
  ];
  return {
    slot: polarity === "strength" ? ("strengths" as const) : ("weakness_patterns" as const),
    synthesisKey: `${polarity}-${matching.map((fact) => fact.tag).sort().join("-")}`.slice(
      0,
      80,
    ),
    text:
      polarity === "strength"
        ? `Across different problems the learner has demonstrated: ${readablePatterns.join("; ")}.`
        : `Across different problems the learner has repeatedly shown: ${readablePatterns.join("; ")}.`,
    evidenceFactIds: [...new Set(matching.map((fact) => fact.id))],
    confidence: 0.6,
    status: "active" as const,
  };
}

export function createLlmReflectionProvider(
  options: { client?: OpenAI; model?: string } = {},
): ReflectionProvider {
  const client = options.client ?? createMemoryClient();
  const model = options.model ?? getMemoryModel();

  return {
    name: `llm-reflection:${model}`,
    async reflect(input, traceContext) {
      const step = startTraceStep(traceContext, { spanKind: "llm" });
      const startedAt = Date.now();
      let completion: ChatCompletion | undefined;

      try {
        const request = withMemoryNonStreamingCompatibility({
          model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are PatternCoach AI MemoryAgent reflecting over learner memory. Return compact JSON only.",
            },
            { role: "user", content: buildReflectionPrompt(input) },
          ],
        });
        completion = (await client.chat.completions.create(request)) as ChatCompletion;
        const content = completion.choices[0]?.message.content;

        if (!content) {
          throw new Error("Reflection LLM returned an empty response.");
        }

        const parsed = parseReflectionOutput(content);
        const output = parsed.output;
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "memory.reflect",
          source: "memory_agent:reflect",
          content: `reflect: ${output.slotUpserts.length} slots, ${output.strategyProposals.length} strategy proposals, ${output.factAudits.length} audits`,
          model,
          responseModel: completion.model,
          latencyMs,
          status: "ok",
          finishReason: completion.choices[0]?.finish_reason ?? null,
          usage: completion.usage,
          extraEventJson: {
            provider: `llm-reflection:${model}`,
            slotUpsertCount: output.slotUpserts.length,
            proposalCount: output.strategyProposals.length,
            rejectedMalformedStrategyProposalCount:
              parsed.rejectedMalformedStrategyProposalCount,
            auditCount: output.factAudits.length,
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
          task: "memory.reflect",
          source: "memory_agent:reflect",
          content: "reflection failed",
          model,
          responseModel: completion?.model ?? null,
          latencyMs,
          status: "error",
          finishReason: completion?.choices[0]?.finish_reason ?? null,
          usage: completion?.usage ?? null,
          usageMissingReason: "error_response",
          error,
          extraEventJson: {
            provider: `llm-reflection:${model}`,
            episodeCount: input.episodes.length,
            changedFactCount: input.changedFacts.length,
            activeSlotCount: input.activeSlots.length,
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

export function getReflectionProvider(): ReflectionProvider {
  if (process.env.REFLECTION_PROVIDER === "mock") {
    return createMockReflectionProvider();
  }

  return createLlmReflectionProvider();
}

function parseReflectionOutput(content: string): {
  output: ReflectionOutput;
  rejectedMalformedStrategyProposalCount: number;
} {
  const raw = parseJsonObject(content);
  if (!isRecord(raw) || !Array.isArray(raw.strategyProposals)) {
    return {
      output: reflectionOutputSchema.parse(raw),
      rejectedMalformedStrategyProposalCount: 0,
    };
  }

  const strategyProposals = raw.strategyProposals.flatMap((proposal) => {
    const parsed = strategyProposalSchema.safeParse(proposal);
    return parsed.success ? [parsed.data] : [];
  });

  return {
    output: reflectionOutputSchema.parse({
      ...raw,
      strategyProposals,
    }),
    rejectedMalformedStrategyProposalCount:
      raw.strategyProposals.length - strategyProposals.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(content: string): unknown {
  const sanitized = escapeControlCharsInStrings(content);

  try {
    return JSON.parse(sanitized) as unknown;
  } catch {
    const unfenced = sanitized
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    try {
      return JSON.parse(unfenced) as unknown;
    } catch {
      const start = sanitized.indexOf("{");
      const end = sanitized.lastIndexOf("}");

      if (start >= 0 && end > start) {
        return JSON.parse(sanitized.slice(start, end + 1)) as unknown;
      }

      throw new Error("Reflection LLM output did not contain valid JSON.");
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
