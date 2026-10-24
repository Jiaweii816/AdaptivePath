import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";
import type { CodeRunResult } from "@/types/code-runner";
import type { CoachReviewResult } from "@/types/coach";
import type { CoachProvider, CoachReviewInput } from "./coach-agent.types";
import { buildRunEvidenceDiagnosis } from "./run-evidence-diagnosis";
import { sanitizeSelfCheck } from "./self-check-guard";
import { buildMemoryPromptReceipt } from "@/server/memory/retrieval/memory-prompt-receipt";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";

export async function callReviewProviderOnce(
  provider: CoachProvider,
  input: CoachReviewInput,
  traceContext: TraceContext | undefined,
) {
  if (provider.runtimeTraceOwnership === "provider") {
    return provider.review(input);
  }

  const step = startTraceStep(traceContext, { spanKind: "llm" });
  const startedAt = Date.now();
  try {
    const result = await provider.review(input);
    const latencyMs = Date.now() - startedAt;
    addTraceLlmMs(traceContext, latencyMs);
    await traceProviderSuccess({ traceContext, step, input, result, latencyMs });
    return result;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    addTraceLlmMs(traceContext, latencyMs);
    await traceProviderError({ traceContext, step, input, error, latencyMs });
    throw error;
  }
}

type ProviderTraceArgs = {
  traceContext?: TraceContext;
  step: ReturnType<typeof startTraceStep>;
  input: CoachReviewInput;
  latencyMs: number;
};

async function traceProviderSuccess(
  args: ProviderTraceArgs & { result: CoachReviewResult },
) {
  await appendLlmCallTrace({
    traceContext: args.traceContext,
    step: args.step,
    task: "review.diagnose_and_reply",
    source: "review:provider_seam",
    provider: "injected",
    model: "coach-provider-seam",
    latencyMs: args.latencyMs,
    status: "ok",
    usage: null,
    usageMissingReason: "provider_omitted",
    input: providerTraceInput(args.input),
    parsedOutput: args.result,
    visibleOutput: args.result,
    extraEventJson: {
      providerSeam: true,
      memoryPromptReceipt: buildMemoryPromptReceipt(args.input.memory),
    },
  });
}

async function traceProviderError(
  args: ProviderTraceArgs & { error: unknown },
) {
  await appendLlmCallTrace({
    traceContext: args.traceContext,
    step: args.step,
    task: "review.diagnose_and_reply",
    source: "review:provider_seam",
    provider: "injected",
    model: "coach-provider-seam",
    latencyMs: args.latencyMs,
    status: "error",
    usage: null,
    usageMissingReason: "error_response",
    error: args.error,
    input: providerTraceInput(args.input),
    extraEventJson: {
      providerSeam: true,
      memoryPromptReceipt: buildMemoryPromptReceipt(args.input.memory),
    },
  });
}

function providerTraceInput(input: CoachReviewInput) {
  return {
    providerTraceOwnership: "orchestration",
    evidenceClass: input.evidenceVerdict?.evidenceClass,
    runStatus: input.runResult.status,
  };
}

export function sanitizePersistableSelfCheck(args: {
  coachResult: CoachReviewResult;
  runStatus: CodeRunResult["status"];
}) {
  if (args.runStatus === "passed_visible_tests" || args.coachResult.degraded) {
    return null;
  }
  return sanitizeSelfCheck(args.coachResult.diagnosis.selfCheck);
}

export function buildLlmUnavailableResult(args: {
  problemSlug: string;
  problemTags: string[];
  runResult: CodeRunResult;
  responseLanguage: "zh" | "en";
  error: unknown;
}): CoachReviewResult {
  return {
    diagnosis: buildRunEvidenceDiagnosis({
      problemSlug: args.problemSlug,
      problemTags: args.problemTags,
      runResult: args.runResult,
    }),
    coachReply: buildLlmUnavailableReply({
      language: args.responseLanguage,
      runResult: args.runResult,
      timedOut: isTimeoutError(args.error),
    }),
    degraded: {
      tier: 3,
      reason: `LLM review unavailable: ${errorMessage(args.error)}`,
      memorySkipped: true,
    },
  };
}

function buildLlmUnavailableReply(args: {
  language: "zh" | "en";
  runResult: CodeRunResult;
  timedOut: boolean;
}): string {
  const officialAccepted =
    readProviderUsed(args.runResult) === "lc_submit" &&
    args.runResult.status === "passed_visible_tests";
  if (args.language === "en") {
    if (officialAccepted) {
      return [
        "LeetCode's official judge returned Accepted.",
        args.timedOut
          ? "The Coach review exceeded the 25-second limit, so I kept the official result and skipped unverified extra commentary."
          : "The coach model was unavailable, so I kept the official result and skipped unverified extra commentary.",
        "You can continue the interview now and ask Coach for a short follow-up later.",
      ].join("\n");
    }
    return [
      "The coach model was unavailable, so I cannot give a trustworthy diagnosis this time.",
      "Your code still ran: use the run evidence above as ground truth, trace the first failed visible case to the first diverging value or line, then run Review My Code again when the model is back.",
    ].join("\n");
  }
  if (officialAccepted) {
    return [
      "LeetCode 官方判题已返回 Accepted。",
      args.timedOut
        ? "Coach 点评超过 25 秒上限；本次保留官方结果，不补充未经验证的额外诊断。"
        : "教练模型这次不可用；本次保留官方结果，不补充未经验证的额外诊断。",
      "你可以继续面试，稍后再让 Coach 做简短追问点评。",
    ].join("\n");
  }
  return [
    "教练模型这次不可用，所以我不能给出可信诊断。",
    "你的代码已经跑过了:以上方运行证据为准,先手动 trace 第一个失败的可见用例,找到第一个跑偏的值或行,等模型恢复后再点一次 Review My Code。",
  ].join("\n");
}

function isTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /timeout|timed out/iu.test(`${error.name} ${error.message}`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "unknown");
}
