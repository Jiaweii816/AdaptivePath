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
  activityExtractionInputSchema,
  parseActivityExtractionEnvelope,
  type ActivityExtractionInput,
  type ActivityExtractionEnvelope,
  type ModelActivityExtractionOutput,
  type ParsedActivityExtractionInput,
} from "./activity-extraction-contract";
import { buildActivityExtractionPrompt } from "./build-activity-extraction-prompt";

export type ActivityExtractionProvider = {
  name: string;
  extract: (
    input: ActivityExtractionInput,
    traceContext?: TraceContext,
  ) => Promise<ActivityExtractionEnvelope>;
};

export function createMockActivityExtractionProvider(options: {
  output?: unknown;
} = {}): ActivityExtractionProvider {
  return {
    name: "mock-activity-extraction",
    async extract(inputValue) {
      const input = activityExtractionInputSchema.parse(inputValue);
      const output = options.output ?? buildMockOutput(input);
      return parseActivityExtractionEnvelope(output, input);
    },
  };
}

export function createOpenAiCompatibleActivityExtractionProvider(
  options: { client?: OpenAI; model?: string } = {},
): ActivityExtractionProvider {
  const client = options.client ?? createMemoryClient();
  const model = options.model ?? getMemoryModel();
  return {
    name: `openai-compatible-activity-extraction:${model}`,
    async extract(inputValue, traceContext) {
      const input = activityExtractionInputSchema.parse(inputValue);
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
                  "You are PatternCoach AI MemoryAgent extracting evidence-grounded, open-world learner memory. Return compact JSON only.",
              },
              { role: "user", content: buildActivityExtractionPrompt(input) },
            ],
          }),
        )) as ChatCompletion;
        const content = completion.choices[0]?.message.content;
        if (!content) throw new Error("Activity extraction returned an empty response.");
        const output = parseActivityExtractionEnvelope(
          repairProviderShape(parseJsonObjectWithRepair(content)),
          input,
        );
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "memory.extract_activity",
          source: "memory_agent:extract_activity",
          content: `extracted activity ${input.cluster.id}: ${output.observations.length} observations`,
          model,
          responseModel: completion.model,
          latencyMs,
          status: "ok",
          finishReason: completion.choices[0]?.finish_reason ?? null,
          usage: completion.usage,
          extraEventJson: {
            clusterId: input.cluster.id,
            inputHash: input.cluster.inputHash,
            observationCount: output.observations.length,
            coverageStatus: output.coverage.status,
          },
        });
        return output;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        addTraceLlmMs(traceContext, latencyMs);
        await appendLlmCallTrace({
          traceContext,
          step,
          task: "memory.extract_activity",
          source: "memory_agent:extract_activity",
          content: `activity extraction failed for ${input.cluster.id}`,
          model,
          responseModel: completion?.model ?? null,
          latencyMs,
          status: "error",
          finishReason: completion?.choices[0]?.finish_reason ?? null,
          usage: completion?.usage ?? null,
          usageMissingReason: "error_response",
          error,
          extraEventJson: {
            clusterId: input.cluster.id,
            inputHash: input.cluster.inputHash,
          },
        });
        throw error;
      }
    },
  };
}

function buildMockOutput(
  input: ParsedActivityExtractionInput,
): ModelActivityExtractionOutput {
  const learnerItems = input.items.filter(
    (item) => item.speaker === "learner" && item.evidenceTraceIds.length > 0,
  );
  const meaningful = learnerItems.filter((item) => !isNoise(item.text));
  const allText = input.items.map((item) => item.text).join("\n");
  const allowed = input.allowedLearnerEvidenceTraceIds;
  const cited = [
    ...new Set(meaningful.flatMap((item) => item.evidenceTraceIds)),
  ];

  if (meaningful.length === 0 || cited.length === 0) {
    return noSignalOutput(input, allowed);
  }

  if (meaningful.every((item) => isRecallOnlyQuestion(item.text))) {
    return {
      episode: {
        title: `Prior-memory recall on ${input.cluster.problemTitle ?? "Coach chat"}`,
        summary:
          "The learner asked Coach to retrieve a prior mistake; this interaction adds no independent evidence that the mistake recurred.",
        outcome: "informational",
        tags: ["memory retrieval"],
        salience: 0.35,
        evidenceTraceIds: cited,
      },
      observations: [],
      coverage: {
        status: "episode_only",
        ignoredEvidence: allowed.map((evidenceTraceId) => ({
          evidenceTraceId,
          reason: "retrieval_intent_only" as const,
        })),
        noSemanticSignalReason:
          "A request to recall prior memory is useful Episode context but is not new L2 evidence.",
      },
    };
  }

  const visitedRepair =
    /\bvisited\b|访问标记|访问集合/iu.test(allText) &&
    /(?:fail|failed|wrong|error|失败|错|漏)/iu.test(allText) &&
    /(?:pass|passed|resolved|fixed|通过|修复|改对)/iu.test(allText);
  const problemIds = input.cluster.problemId ? [input.cluster.problemId] : [];
  const firstLearnerText = meaningful[0]!.text.replace(/\s+/g, " ").slice(0, 500);
  const observations: ModelActivityExtractionOutput["observations"] = visitedRepair
    ? [
        {
          claimType: "weakness",
          claimText:
            "In this graph traversal activity, visited-state handling was initially omitted before the learner repaired it.",
          polarity: "negative",
          scope: {
            level: "mechanism",
            problemIds,
            topicHints: ["graph traversal", "visited-state handling"],
            context: "One assisted repair activity; not evidence of recurrence by itself.",
          },
          mechanismKeys: [],
          evidenceStrength: "observed",
          evidenceTraceIds: cited,
        },
      ]
    : [
        {
          claimType: "knowledge_state",
          claimText: `The learner explicitly engaged with: ${firstLearnerText}`,
          polarity: "neutral",
          scope: {
            level: input.cluster.problemId ? "problem" : "cross_problem",
            problemIds,
            topicHints: [],
            context: "Open-world activity observation; no canonical mechanism required.",
          },
          mechanismKeys: [],
          evidenceStrength: "user_explicit",
          evidenceTraceIds: cited,
        },
      ];
  const used = new Set(cited);
  return {
    episode: {
      title: visitedRepair
        ? `Visited-state repair on ${input.cluster.problemTitle ?? "graph activity"}`
        : `Learning activity on ${input.cluster.problemTitle ?? "Coach chat"}`,
      summary: visitedRepair
        ? "The learner encountered a visited-state omission, used Coach guidance as context, changed the approach, and reached a passing or resolved outcome in this activity."
        : `The learner discussed a substantive topic: ${firstLearnerText}`,
      outcome: visitedRepair ? "improved" : "informational",
      tags: visitedRepair ? ["graph traversal", "visited state"] : [],
      salience: visitedRepair ? 0.85 : 0.5,
      evidenceTraceIds: cited,
    },
    observations,
    coverage: {
      status: "complete",
      ignoredEvidence: allowed
        .filter((id) => !used.has(id))
        .map((evidenceTraceId) => ({
          evidenceTraceId,
          reason: "insufficient_learner_signal" as const,
        })),
    },
  };
}

function noSignalOutput(
  input: ParsedActivityExtractionInput,
  allowed: string[],
): ModelActivityExtractionOutput {
  return {
    episode: {
      title: `No durable signal in ${input.cluster.problemTitle ?? "Coach chat"}`,
      summary:
        "The activity contained only social, navigational, operational, or assistant-only context and produced no durable learner observation.",
      outcome: "no_semantic_signal",
      tags: [],
      salience: 0,
      evidenceTraceIds: allowed,
    },
    observations: [],
    coverage: {
      status: "no_semantic_signal",
      ignoredEvidence: allowed.map((evidenceTraceId) => ({
        evidenceTraceId,
        reason: "not_relevant_to_learning" as const,
      })),
      noSemanticSignalReason:
        "No learner-authored semantic signal suitable for durable memory was present.",
    },
  };
}

function isNoise(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.length < 2 ||
    /^(?:谢谢|感谢|好的|好|行|收到|明白了|thanks|thank you|ok|okay)[!！,.。、\s]*$/iu.test(
      normalized,
    ) ||
    /(?:return to today|go back to today|回\s*today|返回\s*today|provider unavailable|remote review unavailable|远程\s*review\s*不可用|服务不可用)/iu.test(
      normalized,
    )
  );
}

function isRecallOnlyQuestion(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim().toLowerCase();
  const asksPastRecall =
    /(?:上次|之前|以前|过去|曾经).*(?:哪里|哪儿|什么|怎么|栽坑|踩坑|犯错|错误|问题|提醒|记得|回忆)/u.test(
      normalized,
    ) ||
    /(?:提醒|告诉).*(?:上次|之前|以前).*(?:错误|问题|栽坑|踩坑)/u.test(
      normalized,
    ) ||
    /(?:last time|previously|before|past).*(?:where|what|mistake|error|fail|went wrong|remind|recall|remember)/u.test(
      normalized,
    );
  const exposesCurrentEvidence =
    /(?:这次|现在|当前).*(?:失败|报错|忘了|漏了|不会|卡住|做错)/u.test(
      normalized,
    ) ||
    /(?:又|再次).*(?:失败|忘了|漏了|犯错|做错)/u.test(normalized) ||
    /(?:failed|failing|forgot|omitted|stuck|wrong).*(?:again|this time|currently|now)/u.test(
      normalized,
    );
  return asksPastRecall && !exposesCurrentEvidence;
}

export function parseJsonObjectWithRepair(content: string): unknown {
  const sanitized = escapeControlCharsInStrings(content).trim();
  const unfenced = sanitized
    .replace(/^```(?:json)?/iu, "")
    .replace(/```$/u, "")
    .trim();
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
    }
    throw new Error("Activity extraction did not contain valid JSON.");
  }
}

const MIN_UNIT_INTERVAL = 0;
const MAX_UNIT_INTERVAL = 1;

/**
 * Qwen/OpenAI-compatible providers occasionally return a natural-language
 * synonym for the closed Episode outcome enum, or a unit-interval number as a
 * quoted string, even when the rest of the JSON is valid. Repair only those two
 * explicit shapes at the provider edge. Unknown values remain invalid, and all
 * evidence/coverage/claim validation is still performed by
 * parseActivityExtractionOutput.
 */
export function repairProviderShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  return {
    ...record,
    ...repairEpisode(record.episode),
    ...repairObservations(record.observations),
  };
}

function repairEpisode(episode: unknown) {
  if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
    return {};
  }
  const episodeRecord = episode as Record<string, unknown>;
  const outcome =
    typeof episodeRecord.outcome === "string"
      ? (normalizeOutcomeAlias(episodeRecord.outcome) ?? episodeRecord.outcome)
      : episodeRecord.outcome;
  return {
    episode: {
      ...episodeRecord,
      outcome,
      salience: coerceUnitInterval(episodeRecord.salience),
    },
  };
}

function repairObservations(observations: unknown) {
  if (!Array.isArray(observations)) return {};
  return {
    observations: observations.map((observation) => {
      if (!observation || typeof observation !== "object") return observation;
      const record = observation as Record<string, unknown>;
      const proposal = record.relationProposal;
      if (!proposal || typeof proposal !== "object") return record;
      const proposalRecord = proposal as Record<string, unknown>;
      return {
        ...record,
        relationProposal: {
          ...proposalRecord,
          modelConfidence: coerceUnitInterval(proposalRecord.modelConfidence),
        },
      };
    }),
  };
}

/**
 * qwen3-8b answers episode.salience with a qualitative word ("high") as often
 * as a number. Map only this small closed set; anything else stays invalid so
 * the contract still rejects it.
 */
const QUALITATIVE_UNIT_INTERVAL: Readonly<Record<string, number>> = {
  high: 0.85,
  very_high: 0.95,
  medium: 0.5,
  moderate: 0.5,
  low: 0.25,
  very_low: 0.1,
  none: 0,
};

function coerceUnitInterval(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) {
    return Math.min(MAX_UNIT_INTERVAL, Math.max(MIN_UNIT_INTERVAL, parsed));
  }
  const key = trimmed.toLowerCase().replace(/[\s-]+/gu, "_");
  return QUALITATIVE_UNIT_INTERVAL[key] ?? value;
}

function normalizeOutcomeAlias(value: string) {
  const key = value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  const aliases: Readonly<Record<string, string>> = {
    resolved: "resolved",
    solved: "resolved",
    fixed: "resolved",
    repaired: "resolved",
    passed: "resolved",
    completed: "resolved",
    complete: "resolved",
    success: "resolved",
    successful: "resolved",
    unresolved: "unresolved",
    failed: "unresolved",
    incomplete: "unresolved",
    stuck: "unresolved",
    blocked: "unresolved",
    improved: "improved",
    improvement: "improved",
    progress: "improved",
    partially_resolved: "improved",
    abandoned: "abandoned",
    skipped: "abandoned",
    discontinued: "abandoned",
    informational: "informational",
    information: "informational",
    discussion: "informational",
    discussed: "informational",
    recall: "informational",
    episode_only: "informational",
    no_semantic_signal: "no_semantic_signal",
    no_signal: "no_semantic_signal",
    none: "no_semantic_signal",
  };
  return aliases[key];
}

function escapeControlCharsInStrings(text: string) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      result += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      result += char;
      inString = !inString;
      continue;
    }
    if (inString && char === "\n") {
      result += "\\n";
      continue;
    }
    if (inString && char === "\r") {
      result += "\\r";
      continue;
    }
    if (inString && char === "\t") {
      result += "\\t";
      continue;
    }
    result += char;
  }
  return result;
}
