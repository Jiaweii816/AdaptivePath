import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { CoachProvider, CoachReviewInput } from "@/server/agents/coach-agent/coach-agent.types";
import { applyCoachReplyGuards } from "@/server/agents/coach-agent/coach-reply-contract";
import { createReviewClient } from "@/server/llm/client";
import { getReviewModel } from "@/server/llm/models";
import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
} from "@/server/llm/trace-context";
import {
  coachDiagnosisSchema,
  memoryUpdateCandidateFactSchema,
  type CoachDiagnosis,
} from "@/types/coach";

export type TwoCallReviewProviderOptions = {
  reviewClient?: OpenAI;
  reviewModel?: string;
};

type ReviewTraceTask =
  | "review.two_call.diagnose"
  | "review.two_call.reply";

export function createTwoCallReviewProvider(
  options: TwoCallReviewProviderOptions = {},
): CoachProvider {
  const reviewClient = options.reviewClient ?? createReviewClient();
  const reviewModel = options.reviewModel ?? getReviewModel();

  return {
    async review(input) {
      const diagnosisContent = await requestReviewContent({
        client: reviewClient,
        model: reviewModel,
        messages: buildDiagnosisMessages(input),
        traceContext: input.traceContext,
        task: "review.two_call.diagnose",
      });
      const diagnosis = parseDiagnosisJson(diagnosisContent);
      const replyContent = await requestReviewContent({
        client: reviewClient,
        model: reviewModel,
        messages: buildReplyMessages(input, diagnosis),
        traceContext: input.traceContext,
        task: "review.two_call.reply",
      });
      const guard = applyCoachReplyGuards(replyContent.trim(), {
        responseLanguage: input.responseLanguage ?? "zh",
        runStatus: input.runResult.status,
      });

      return {
        diagnosis,
        coachReply: guard.reply,
        degraded: guard.safetyReplaced
          ? {
              tier: 1,
              reason: "Two-call eval reply safety guard replaced the model draft.",
              memorySkipped: true,
              safetyReplaced: true,
            }
          : undefined,
      };
    },

    async chat() {
      throw new Error("Two-call review provider is eval-only and does not implement chat().");
    },
  };
}

function buildDiagnosisMessages(input: CoachReviewInput): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content:
        "You are the diagnosis-only step for PatternCoach AI Review evals. Return exactly one JSON object and no markdown.",
    },
    {
      role: "user",
      content: [
        "Diagnose the learner's current Review attempt from the run evidence and code.",
        "Return JSON with this exact shape:",
        "{\"problemSlug\":\"...\",\"runStatus\":\"...\",\"userIssueSummary\":\"...\",\"coachSummary\":\"...\",\"mistakeTags\":[],\"skillTags\":[],\"selfCheck\":null,\"memoryUpdateCandidate\":{\"facts\":[],\"summary\":\"...\"}}",
        "memoryUpdateCandidate.facts must be an array of objects with factType/tag/label/confidence/evidenceSummary, or [] if none. Never put strings inside facts.",
        "Use stable snake_case mistakeTags. Do not claim hidden-test success or official acceptance.",
        "",
        `Problem: ${input.problem.leetcodeNumber ?? ""}. ${input.problem.title} (${input.problem.slug})`,
        `Tags: ${input.problem.tags.join(", ")}`,
        `Language: ${input.language}`,
        `User state: ${input.userState ?? "not specified"}`,
        `User question: ${input.userQuestion ?? "not specified"}`,
        input.evidenceVerdict
          ? `Evidence verdict: ${JSON.stringify(input.evidenceVerdict)}`
          : "Evidence verdict: not provided; use only the current Run evidence JSON.",
        input.evidenceVerdict
          ? `Evidence policy instruction: ${input.evidenceVerdict.modelInstruction}`
          : "Evidence policy instruction: do not claim hidden-test success.",
        "",
        "Run evidence JSON:",
        JSON.stringify(input.runResult, null, 2),
        "",
        "User code:",
        "```",
        input.code.slice(0, 6000),
        "```",
      ].join("\n"),
    },
  ];
}

function buildReplyMessages(
  input: CoachReviewInput,
  diagnosis: CoachDiagnosis,
): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content:
        "You are the reply-only step for PatternCoach AI Review evals. Write only the learner-facing markdown reply.",
    },
    {
      role: "user",
      content: [
        input.responseLanguage === "en"
          ? "Respond in English."
          : "Respond in Chinese.",
        "Use the diagnosis JSON and concrete run evidence. Do not output diagnosis JSON. Do not claim hidden-test success or guaranteed official acceptance.",
        "For failed runs: root cause first, walk a minimal failing case, give the smallest repair to the learner's current approach, and end with one concrete next step. No full official solution.",
        "",
        `Problem: ${input.problem.leetcodeNumber ?? ""}. ${input.problem.title} (${input.problem.slug})`,
        `Language: ${input.language}`,
        `User state: ${input.userState ?? "not specified"}`,
        `User question: ${input.userQuestion ?? "not specified"}`,
        "",
        "Diagnosis JSON:",
        JSON.stringify(diagnosis, null, 2),
        "",
        "Run evidence JSON:",
        JSON.stringify(input.runResult, null, 2),
        "",
        "User code:",
        "```",
        input.code.slice(0, 6000),
        "```",
      ].join("\n"),
    },
  ];
}

async function requestReviewContent(args: {
  client: OpenAI;
  model: string;
  messages: ChatCompletionMessageParam[];
  traceContext?: CoachReviewInput["traceContext"];
  task: ReviewTraceTask;
}) {
  const step = startTraceStep(args.traceContext, { spanKind: "llm" });
  const startedAt = Date.now();

  try {
    const completion = await args.client.chat.completions.create({
      model: args.model,
      temperature: args.task === "review.two_call.diagnose" ? 0.1 : 0.2,
      messages: args.messages,
    });
    const latencyMs = Date.now() - startedAt;
    const content = completion.choices[0]?.message.content;

    if (!content) {
      throw new Error(`${args.task} LLM returned an empty response.`);
    }

    addTraceLlmMs(args.traceContext, latencyMs);
    await appendLlmCallTrace({
      traceContext: args.traceContext,
      step,
      task: args.task,
      model: args.model,
      responseModel: completion.model,
      latencyMs,
      status: "ok",
      finishReason: completion.choices[0]?.finish_reason ?? null,
      usage: completion.usage,
    });

    return content;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    addTraceLlmMs(args.traceContext, latencyMs);
    await appendLlmCallTrace({
      traceContext: args.traceContext,
      step,
      task: args.task,
      model: args.model,
      responseModel: null,
      latencyMs,
      status: "error",
      finishReason: null,
      usage: null,
      usageMissingReason: "error_response",
      error,
    });
    throw error;
  }
}

function parseDiagnosisJson(content: string): CoachDiagnosis {
  const candidate = parseFirstJsonObject(stripCodeFence(content));
  const parsed = coachDiagnosisSchema.safeParse(candidate);

  if (parsed.success) {
    return parsed.data;
  }

  const sanitized = coachDiagnosisSchema.safeParse(
    sanitizeDiagnosisCandidate(candidate),
  );

  if (sanitized.success) {
    return sanitized.data;
  }

  throw new Error(
    `Two-call diagnosis JSON could not be parsed: ${parsed.error.message}`,
  );
}

function sanitizeDiagnosisCandidate(candidate: unknown) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return candidate;
  }

  const record = { ...(candidate as Record<string, unknown>) };
  const memoryUpdateCandidate = record.memoryUpdateCandidate;

  if (
    memoryUpdateCandidate &&
    typeof memoryUpdateCandidate === "object" &&
    !Array.isArray(memoryUpdateCandidate)
  ) {
    const memoryRecord = {
      ...(memoryUpdateCandidate as Record<string, unknown>),
    };
    const facts = Array.isArray(memoryRecord.facts)
      ? memoryRecord.facts
          .map(sanitizeMemoryFact)
          .filter((fact): fact is NonNullable<ReturnType<typeof sanitizeMemoryFact>> =>
            Boolean(fact),
          )
      : [];
    record.memoryUpdateCandidate = {
      ...memoryRecord,
      facts,
    };
  } else {
    record.memoryUpdateCandidate = { facts: [] };
  }

  return record;
}

function sanitizeMemoryFact(fact: unknown) {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
    return null;
  }

  const record = { ...(fact as Record<string, unknown>) };

  if (typeof record.confidence === "string") {
    const confidence = Number(record.confidence);
    if (Number.isFinite(confidence)) {
      record.confidence = confidence;
    } else {
      delete record.confidence;
    }
  }

  const parsed = memoryUpdateCandidateFactSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

function parseFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");

  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char !== "}") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1)) as unknown;
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}
