import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { chatToolNameSchema } from "@/server/tools/chat-tools/chat-tool-contracts";
import {
  codeRunnerLanguageSchema,
  codeRunResultSchema,
} from "@/types/code-runner";
import { evidenceVerdictSchema } from "@/types/evidence";

export const DEFAULT_SAFETY_DATASET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../datasets/safety/safety-v1.2.json",
);

const safetyCategorySchema = z.enum([
  "ask_to_fake_ac",
  "code_comment_injection",
  "runner_unavailable_fabrication",
  "full_solution_request",
  "code_disclosure_boundary",
  "local_only_overclaim",
  "tool_output_injection",
]);

const codeDisclosureSchema = z.enum(["guided", "full_code"]);

const safetyInjectionChannelSchema = z.enum([
  "user_message",
  "code_comment",
  "tool_output",
  "none",
]);

const safetyPathSchema = z.enum(["review", "chat"]);

const safetyProblemSchema = z.object({
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  leetcodeNumber: z.number().int().positive(),
  tags: z.array(z.string().trim().min(1)),
  methodName: z.string().trim().min(1),
});

const safetySelectedTestSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  input: z.unknown(),
  expected: z.unknown(),
});

const safetyEvidenceMarkerSchema = z.object({
  label: z.string().trim().min(1),
  value: z.string().min(1),
  match: z
    .enum(["case_insensitive_substring", "compact_substring", "regex"])
    .default("case_insensitive_substring"),
  source: z.string().trim().min(1),
});

const judgeCalibrationSchema = z.object({
  fullSolutionLeakageJudgeCalibrated: z.boolean(),
  calibrationSampleCount: z.number().int().nonnegative(),
  notes: z.string().trim().min(1),
});

const safetyCaseSchema = z
  .object({
    caseId: z.string().trim().min(1),
    category: safetyCategorySchema,
    injectionChannel: safetyInjectionChannelSchema,
    path: safetyPathSchema,
    problem: safetyProblemSchema,
    language: codeRunnerLanguageSchema,
    code: z.string().min(1),
    selectedTests: z.array(safetySelectedTestSchema).default([]),
    userMessage: z.string().trim().min(1),
    codeDisclosure: codeDisclosureSchema.optional(),
    expectedToolCalls: z.array(chatToolNameSchema).default([]),
    forbiddenToolCalls: z.array(chatToolNameSchema).default([]),
    runResult: codeRunResultSchema.optional(),
    evidenceVerdict: evidenceVerdictSchema.optional(),
    toolRunResult: codeRunResultSchema.optional(),
    prohibitedClaims: z.array(z.string().trim().min(1)).default([]),
    requiredSafeBehavior: z.string().trim().min(1),
    forbiddenPhrases: z.array(z.string().trim().min(1)).default([]),
    forbiddenRegex: z.array(z.string().trim().min(1)).default([]),
    allowedEvidenceMarkers: z.array(safetyEvidenceMarkerSchema).default([]),
    judgeRequired: z.boolean(),
    notes: z.string().trim().min(1),
    limitations: z.array(z.string().trim().min(1)).default([]),
    humanReviewStatus: z.enum(["pending", "approved", "rejected"]),
  })
  .superRefine((safetyCase, context) => {
    if (safetyCase.path === "review" && !safetyCase.runResult) {
      context.addIssue({
        code: "custom",
        path: ["runResult"],
        message: "Review safety cases must include replay runResult.",
      });
    }

    if (safetyCase.path === "review" && !safetyCase.evidenceVerdict) {
      context.addIssue({
        code: "custom",
        path: ["evidenceVerdict"],
        message: "Review safety cases must include replay evidenceVerdict.",
      });
    }

    if (
      safetyCase.injectionChannel === "tool_output" &&
      safetyCase.path !== "chat"
    ) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: "Tool-output injection cases must use the chat path.",
      });
    }

    if (
      safetyCase.injectionChannel === "tool_output" &&
      !safetyCase.toolRunResult
    ) {
      context.addIssue({
        code: "custom",
        path: ["toolRunResult"],
        message: "Tool-output injection cases must include replay toolRunResult.",
      });
    }

    for (const [index, pattern] of safetyCase.forbiddenRegex.entries()) {
      try {
        compileDatasetRegex(pattern);
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["forbiddenRegex", index],
          message:
            error instanceof Error ? error.message : `Invalid regex: ${pattern}`,
        });
      }
    }

    for (const [index, marker] of safetyCase.allowedEvidenceMarkers.entries()) {
      if (marker.match !== "regex") {
        continue;
      }
      try {
        compileDatasetRegex(marker.value);
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["allowedEvidenceMarkers", index, "value"],
          message:
            error instanceof Error ? error.message : `Invalid regex: ${marker.value}`,
        });
      }
    }
  })
  .transform((safetyCase) => ({
    ...safetyCase,
    // Legacy v1's explicit full-code request encoded the old refusal policy.
    // Materialize it as an allowed full-code control so explicit code requests
    // are not incorrectly failed when an old dataset is loaded.
    codeDisclosure:
      safetyCase.codeDisclosure ??
      (safetyCase.category === "full_solution_request" ? "full_code" : "guided"),
  }));

const safetyDatasetSchema = z
  .object({
    datasetVersion: z.enum(["safety-v1", "safety-v1.1", "safety-v1.2"]),
    name: z.string().trim().min(1),
    status: z.string().trim().min(1),
    description: z.string().trim().min(1),
    judgeCalibration: judgeCalibrationSchema,
    cases: z.array(safetyCaseSchema).min(1),
  })
  .superRefine((dataset, context) => {
    const seen = new Set<string>();

    for (const [index, item] of dataset.cases.entries()) {
      if (seen.has(item.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
          message: `Duplicate safety caseId: ${item.caseId}`,
        });
      }
      seen.add(item.caseId);
    }
  });

export type SafetyDataset = z.infer<typeof safetyDatasetSchema>;
export type SafetyDatasetCase = SafetyDataset["cases"][number];
export type SafetyEvidenceMarker = z.infer<typeof safetyEvidenceMarkerSchema>;
export type SafetyCategory = z.infer<typeof safetyCategorySchema>;
export type SafetyInjectionChannel = z.infer<
  typeof safetyInjectionChannelSchema
>;
export type SafetyPath = z.infer<typeof safetyPathSchema>;
export type SafetyCodeDisclosure = z.infer<typeof codeDisclosureSchema>;

export function loadSafetyDataset(options?: {
  datasetPath?: string;
}): SafetyDataset {
  const datasetPath = options?.datasetPath ?? DEFAULT_SAFETY_DATASET_PATH;
  let rawDataset: unknown;

  try {
    rawDataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read safety dataset ${datasetPath}: ${reason}`);
  }

  const parsed = safetyDatasetSchema.safeParse(rawDataset);

  if (!parsed.success) {
    throw new Error(
      `Invalid safety dataset ${datasetPath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

export function compileDatasetRegex(source: string): RegExp {
  if (source.startsWith("(?i)")) {
    return new RegExp(source.slice("(?i)".length), "i");
  }

  return new RegExp(source);
}
