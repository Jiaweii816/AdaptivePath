import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  buildInterviewerSystemPrompt,
  buildReportPrompt,
  buildStartPrompt,
  buildTurnPrompt,
} from "./build-interviewer-prompt";
import {
  parseInterviewerReportOutput,
  parseInterviewerTurnOutput,
} from "./parse-interviewer-output";
import type { InterviewerProvider } from "./interviewer-agent.types";
import { createInterviewClient } from "@/server/llm/client";
import { getInterviewModel } from "@/server/llm/models";
import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
} from "@/server/llm/trace-context";
import { deepSeekV4ThinkingParams } from "@/server/llm/deepseek-v4-request";
import { findForbiddenCopy } from "@/server/agents/coach-agent/coach-reply-contract";

export type OpenAiInterviewerProviderOptions = {
  client?: OpenAI;
  model?: string;
};

export function createOpenAiInterviewerProvider(
  options: OpenAiInterviewerProviderOptions = {},
): InterviewerProvider {
  const client = options.client ?? createInterviewClient();
  const model = options.model ?? getInterviewModel();

  return {
    async start(input) {
      const raw = await requestContent({
        client,
        model,
        task: "mock_interview.start",
        traceContext: input.traceContext,
        responseLanguage: input.responseLanguage,
        userPrompt: buildStartPrompt(input),
      });
      const parsed = parseInterviewerTurnOutput(raw, {
        currentPhase: "intro",
      });

      return {
        ...parsed,
        questionAsked: false,
        messageMarkdown: guardInterviewCopy(parsed.messageMarkdown, input.responseLanguage),
      };
    },

    async continue(input) {
      const raw = await requestContent({
        client,
        model,
        task: "mock_interview.respond",
        traceContext: input.traceContext,
        responseLanguage: input.responseLanguage,
        userPrompt: buildTurnPrompt(input, "turn"),
      });
      const parsed = parseInterviewerTurnOutput(raw, {
        currentPhase: input.currentPhase,
      });

      return {
        ...parsed,
        messageMarkdown: guardInterviewCopy(parsed.messageMarkdown, input.responseLanguage),
      };
    },

    async discussCode(input) {
      const raw = await requestContent({
        client,
        model,
        task: "mock_interview.send_code",
        traceContext: input.traceContext,
        responseLanguage: input.responseLanguage,
        userPrompt: buildTurnPrompt(input, "code"),
      });
      const parsed = parseInterviewerTurnOutput(raw, {
        currentPhase: input.currentPhase,
      });

      return {
        ...parsed,
        messageMarkdown: guardInterviewCopy(parsed.messageMarkdown, input.responseLanguage),
      };
    },

    async complete(input) {
      const raw = await requestContent({
        client,
        model,
        task: "mock_interview.complete",
        traceContext: input.traceContext,
        responseLanguage: input.responseLanguage,
        userPrompt: buildReportPrompt(input),
        temperature: 0.2,
      });
      const parsed = parseInterviewerReportOutput(raw);

      return {
        ...parsed,
        reportMarkdown: guardInterviewCopy(parsed.reportMarkdown, input.responseLanguage),
      };
    },
  };
}

async function requestContent(args: {
  client: OpenAI;
  model: string;
  task: string;
  traceContext?: Parameters<InterviewerProvider["continue"]>[0]["traceContext"];
  responseLanguage: "zh" | "en";
  userPrompt: string;
  temperature?: number;
}) {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildInterviewerSystemPrompt(args.responseLanguage),
    },
    {
      role: "user",
      content: args.userPrompt,
    },
  ];
  const step = startTraceStep(args.traceContext, { spanKind: "llm" });
  const startedAt = Date.now();
  let completion: Awaited<
    ReturnType<OpenAI["chat"]["completions"]["create"]>
  >;

  try {
    completion = await args.client.chat.completions.create({
      model: args.model,
      ...deepSeekV4ThinkingParams(args.model, "disabled"),
      temperature: args.temperature ?? 0.25,
      messages,
    });
    const latencyMs = Date.now() - startedAt;
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

  const content = completion.choices[0]?.message.content;

  if (!content) {
    throw new Error("Interviewer LLM returned an empty response.");
  }

  return content;
}

function guardInterviewCopy(markdown: string, language: "zh" | "en") {
  if (findForbiddenCopy(markdown).length === 0) {
    return markdown;
  }

  return language === "zh"
    ? "这条面试官草稿触发了边界：它读起来像提交/通过承诺。我们改成一个安全追问：请只基于当前可见运行证据，说明你下一步会验证哪个边界。"
    : "The interviewer draft crossed a boundary by sounding like a submission or acceptance promise. Safe replacement: based only on the visible run evidence, which boundary would you verify next?";
}
