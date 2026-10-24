import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { chatToolNameSchema } from "@/server/tools/chat-tools/chat-tool-contracts";
import { codeRunnerLanguageSchema } from "@/types/code-runner";

export const DEFAULT_TRAJECTORY_DATASET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../datasets/chat-trajectory/trajectory-v2.json",
);

const trajectoryCategorySchema = z.enum([
  "concept_question_no_tool",
  "run_case_requires_run_code",
  "history_question_requires_memory_tool",
  "api_question_requires_lookup_api_reference",
  "preference_requires_note_memory",
  "knowledge_note_requires_save_knowledge_note",
  "practice_request_requires_find_practice_problem",
  "hint_request_requires_algorithm_hint",
  "multi_step_tool_chain",
]);

const trajectoryIntentStyleSchema = z.enum([
  "explicit_instruction",
  "natural_intent",
]);

const trajectoryProblemSchema = z.object({
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  leetcodeNumber: z.number().int().positive(),
  tags: z.array(z.string().trim().min(1)),
});

const trajectorySelectedTestSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  input: z.unknown(),
  expected: z.unknown(),
});

const trajectoryIntegrationMarkerSchema = z.object({
  label: z.string().trim().min(1),
  value: z.string().min(1),
  match: z
    .enum(["case_insensitive_substring", "compact_substring", "regex"])
    .default("case_insensitive_substring"),
  source: z.string().trim().min(1),
});

const trajectoryExpectedToolGroupSchema = z.object({
  label: z.string().trim().min(1),
  anyOf: z.array(chatToolNameSchema).min(2),
});

const trajectoryOrderedStepSchema = z.union([
  chatToolNameSchema,
  trajectoryExpectedToolGroupSchema,
]);

const trajectoryMemoryFactSchema = z.object({
  tag: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  value: z.string().trim().min(1),
  lastEvidenceSummary: z.string().trim().min(1),
});

const trajectoryMemoryEpisodeSchema = z.object({
  problem: trajectoryProblemSchema,
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  outcome: z.enum(["resolved", "unresolved", "improved"]),
  tags: z.array(z.string().trim().min(1)),
});

const trajectoryCaseSchema = z.object({
  caseId: z.string().trim().min(1),
  category: trajectoryCategorySchema,
  intentStyle: trajectoryIntentStyleSchema.default("natural_intent"),
  problem: trajectoryProblemSchema,
  language: codeRunnerLanguageSchema,
  code: z.string().min(1),
  selectedTests: z.array(trajectorySelectedTestSchema).default([]),
  memorySeed: z
    .object({
      mistakeFacts: z.array(trajectoryMemoryFactSchema).default([]),
      problemEpisodes: z.array(trajectoryMemoryEpisodeSchema).default([]),
    })
    .optional(),
  userMessage: z.string().trim().min(1),
  expectedTools: z.array(chatToolNameSchema),
  expectedToolGroups: z.array(trajectoryExpectedToolGroupSchema).default([]),
  optionalTools: z.array(chatToolNameSchema).default([]),
  forbiddenTools: z.array(chatToolNameSchema),
  orderedSubsequence: z.array(trajectoryOrderedStepSchema),
  integrationMarkers: z.array(trajectoryIntegrationMarkerSchema).default([]),
  notes: z.string().trim().min(1),
  limitations: z.array(z.string().trim().min(1)).default([]),
  humanReviewStatus: z.enum(["pending", "approved", "rejected"]),
  runCodeReplayFixtureId: z.string().trim().min(1).optional(),
}).superRefine((trajectoryCase, context) => {
  const expected = new Set(trajectoryCase.expectedTools);
  const expectedGroupTools = new Set(
    trajectoryCase.expectedToolGroups.flatMap((group) => group.anyOf),
  );
  const optionalTools = new Set(trajectoryCase.optionalTools);

  for (const [index, toolName] of trajectoryCase.forbiddenTools.entries()) {
    if (
      expected.has(toolName) ||
      expectedGroupTools.has(toolName) ||
      optionalTools.has(toolName)
    ) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenTools", index],
        message: `${toolName} cannot be expected/optional and forbidden.`,
      });
    }
  }

  for (const [index, step] of trajectoryCase.orderedSubsequence.entries()) {
    const stepTools = typeof step === "string" ? [step] : step.anyOf;
    const stepAllowed = stepTools.every(
      (toolName) => expected.has(toolName) || expectedGroupTools.has(toolName),
    );
    if (!stepAllowed) {
      context.addIssue({
        code: "custom",
        path: ["orderedSubsequence", index],
        message: "orderedSubsequence entries must also be expected tools or expected tool groups.",
      });
    }
  }

  if (
    trajectoryCase.expectedTools.includes("run_current_code") &&
    !trajectoryCase.runCodeReplayFixtureId
  ) {
    context.addIssue({
      code: "custom",
      path: ["runCodeReplayFixtureId"],
      message: "Cases expecting run_current_code must declare a replay fixture.",
    });
  }
});

const trajectoryDatasetSchema = z
  .object({
    datasetVersion: z.enum(["chat-trajectory-v1", "chat-trajectory-v2"]),
    name: z.string().trim().min(1),
    status: z.string().trim().min(1),
    description: z.string().trim().min(1),
    singleIntentTargetCount: z.number().int().nonnegative().optional(),
    multiStepTargetCount: z.number().int().nonnegative().optional(),
    cases: z.array(trajectoryCaseSchema).min(1),
  })
  .superRefine((dataset, context) => {
    const seen = new Set<string>();

    for (const [index, item] of dataset.cases.entries()) {
      if (seen.has(item.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
          message: `Duplicate trajectory caseId: ${item.caseId}`,
        });
      }
      seen.add(item.caseId);
    }
  });

export type TrajectoryDataset = z.infer<typeof trajectoryDatasetSchema>;
export type TrajectoryDatasetCase = TrajectoryDataset["cases"][number];
export type TrajectoryIntegrationMarker = z.infer<
  typeof trajectoryIntegrationMarkerSchema
>;
export type TrajectoryCategory = z.infer<typeof trajectoryCategorySchema>;
export type TrajectoryIntentStyle = z.infer<
  typeof trajectoryIntentStyleSchema
>;

export function loadTrajectoryDataset(options?: {
  datasetPath?: string;
}): TrajectoryDataset {
  const datasetPath = options?.datasetPath ?? DEFAULT_TRAJECTORY_DATASET_PATH;
  let rawDataset: unknown;

  try {
    rawDataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read trajectory dataset ${datasetPath}: ${reason}`,
    );
  }

  const parsed = trajectoryDatasetSchema.safeParse(
    normalizeLegacyTrajectoryToolNames(rawDataset),
  );

  if (!parsed.success) {
    throw new Error(
      `Invalid trajectory dataset ${datasetPath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

function normalizeLegacyTrajectoryToolNames(rawDataset: unknown): unknown {
  if (!rawDataset || typeof rawDataset !== "object") {
    return rawDataset;
  }

  const dataset = rawDataset as Record<string, unknown>;
  if (!Array.isArray(dataset.cases)) {
    return rawDataset;
  }

  return {
    ...dataset,
    cases: dataset.cases.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      const trajectoryCase = item as Record<string, unknown>;
      return {
        ...trajectoryCase,
        expectedTools: normalizeToolNameArray(trajectoryCase.expectedTools),
        optionalTools: normalizeToolNameArray(trajectoryCase.optionalTools),
        forbiddenTools: normalizeToolNameArray(trajectoryCase.forbiddenTools),
        expectedToolGroups: Array.isArray(trajectoryCase.expectedToolGroups)
          ? trajectoryCase.expectedToolGroups.map(normalizeToolGroup)
          : trajectoryCase.expectedToolGroups,
        orderedSubsequence: Array.isArray(trajectoryCase.orderedSubsequence)
          ? trajectoryCase.orderedSubsequence.map(normalizeOrderedStep)
          : trajectoryCase.orderedSubsequence,
      };
    }),
  };
}

function normalizeToolNameArray(value: unknown): unknown {
  return Array.isArray(value) ? value.map(normalizeLegacyToolName) : value;
}

function normalizeOrderedStep(step: unknown): unknown {
  return typeof step === "string"
    ? normalizeLegacyToolName(step)
    : normalizeToolGroup(step);
}

function normalizeToolGroup(group: unknown): unknown {
  if (!group || typeof group !== "object") {
    return group;
  }

  const value = group as Record<string, unknown>;
  return {
    ...value,
    anyOf: normalizeToolNameArray(value.anyOf),
  };
}

function normalizeLegacyToolName(toolName: unknown): unknown {
  return toolName === "run_code" ? "run_current_code" : toolName;
}
