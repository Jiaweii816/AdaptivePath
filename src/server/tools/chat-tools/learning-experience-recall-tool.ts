import {
  appendTraceEventBestEffort,
  startTraceStep,
} from "@/server/llm/trace-context";
import { recallThreeLayerLearningExperiences } from "@/server/memory/learning-experience-recall/three-layer-recall";
import { isLearningExperienceRecallPilotEnabled } from "@/server/memory/learning-experience-recall/pilot-mode";
import { getDefaultFtsStore } from "@/server/memory/store/fts-store";
import type { ChatToolArgs, ChatToolResult } from "./chat-tool-contracts";
import type { ChatToolExecutionContext } from "./chat-tool-dispatch";

export async function recallLearningExperienceChatTool(
  args: ChatToolArgs<"recall_learning_experience">,
  context: ChatToolExecutionContext,
): Promise<ChatToolResult<"recall_learning_experience">> {
  if (!isLearningExperienceRecallPilotEnabled()) {
    throw new Error(
      "Learning-experience recall Pilot is not enabled for this process.",
    );
  }
  const recalled = await recallThreeLayerLearningExperiences({
    prisma: context.prisma,
    learnerId: context.userId,
    ftsKeywords: args.ftsKeywords,
    failurePattern: args.failurePattern,
    successPattern: args.successPattern,
    ftsStore: context.ftsStore ?? getDefaultFtsStore(),
  });
  await traceRecall(context, args, recalled);
  return {
    pilot: "three_layer_experience",
    retrievalStatus: recalled.status,
    experiences: recalled.experiences,
    message:
      recalled.experiences.length > 0
        ? "These are ranked historical analogies, not a diagnosis. Independently decide whether each one is relevant before using it."
        : "No learning experience was returned. Do not infer that the learner has no related history.",
  };
}

async function traceRecall(
  context: ChatToolExecutionContext,
  args: ChatToolArgs<"recall_learning_experience">,
  recalled: Awaited<ReturnType<typeof recallThreeLayerLearningExperiences>>,
) {
  if (!context.traceContext) return;
  await appendTraceEventBestEffort(context.traceContext, {
    step: startTraceStep(context.traceContext, { spanKind: "retrieval" }),
    stage: "context_memory",
    kind: "retrieval",
    title: "Three-layer learning-experience recall Pilot",
    status:
      recalled.status === "partial_failure"
        ? "degraded"
        : recalled.status === "vector_unavailable"
          ? "skipped"
          : "succeeded",
    details: {
      input: {
        ftsKeywords: args.ftsKeywords,
        failurePattern: args.failurePattern ?? null,
        successPattern: args.successPattern ?? null,
        runtimeScope: {
          userId: context.userId,
          problemId: context.problem.id,
        },
      },
      retrieval: recalled.trace,
      metadata: {
        source: "recall_learning_experience_tool",
        retrievalStatus: recalled.status,
        sourceLayers: ["episode", "l2_fact", "l3_synthesis"],
        fusion: "weighted_rrf",
        evidenceFamilyDeduplication: true,
        maxReturnedBundles: 2,
        maxToolExecutionsPerTurn: 1,
      },
    },
  });
}
