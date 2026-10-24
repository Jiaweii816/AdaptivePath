import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const DEFAULT_MEMORY_CITATION_DATASET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../datasets/memory/memory-citation-v1.json",
);

const memoryCitationCategorySchema = z.enum([
  "mistake_memory",
  "skill_memory",
  "preference_memory",
  "api_confusion_memory",
  "stale_memory",
  "no_memory_evidence",
]);

const citationRequirementSchema = z.enum([
  "required",
  "optional",
  "none_expected",
]);

const memoryCitationCaseSchema = z.object({
  caseId: z.string().trim().min(1),
  category: memoryCitationCategorySchema,
  problemSlug: z.string().trim().min(1),
  userQuestion: z.string().trim().min(1),
  expectedFactKeys: z.array(z.string().trim().min(1)).default([]),
  expectedEpisodeKeys: z.array(z.string().trim().min(1)).default([]),
  forbiddenFactKeys: z.array(z.string().trim().min(1)).default([]),
  forbiddenEpisodeKeys: z.array(z.string().trim().min(1)).default([]),
  neutralFactKeys: z.array(z.string().trim().min(1)).default([]),
  neutralEpisodeKeys: z.array(z.string().trim().min(1)).default([]),
  citationRequirement: citationRequirementSchema,
  notes: z.string().trim().min(1),
  limitations: z.array(z.string().trim().min(1)).default([]),
});

const memoryCitationDatasetSchema = z
  .object({
    datasetVersion: z.enum([
      "memory-citation-v1",
      "memory-citation-v1.1",
      "memory-citation-v1.2",
    ]),
    name: z.string().trim().min(1),
    status: z.string().trim().min(1),
    description: z.string().trim().min(1),
    humanReviewStatus: z.enum(["pending", "approved", "rejected"]),
    cases: z.array(memoryCitationCaseSchema).min(1),
    limitations: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((dataset, context) => {
    const seen = new Set<string>();

    for (const [index, item] of dataset.cases.entries()) {
      if (seen.has(item.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
          message: `Duplicate memory citation caseId: ${item.caseId}`,
        });
      }
      seen.add(item.caseId);
    }
  });

export type MemoryCitationDataset = z.infer<
  typeof memoryCitationDatasetSchema
>;
export type MemoryCitationCase = MemoryCitationDataset["cases"][number];
export type MemoryCitationCategory = z.infer<
  typeof memoryCitationCategorySchema
>;
export type MemoryCitationRequirement = z.infer<
  typeof citationRequirementSchema
>;

export function loadMemoryCitationDataset(options?: {
  datasetPath?: string;
}): MemoryCitationDataset {
  const datasetPath =
    options?.datasetPath ?? DEFAULT_MEMORY_CITATION_DATASET_PATH;
  let rawDataset: unknown;

  try {
    rawDataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read memory citation dataset ${datasetPath}: ${reason}`,
    );
  }

  const parsed = memoryCitationDatasetSchema.safeParse(rawDataset);
  if (!parsed.success) {
    throw new Error(
      `Invalid memory citation dataset ${datasetPath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

export function validateMemoryCitationDatasetAgainstManifest(args: {
  dataset: MemoryCitationDataset;
  factKeys: Set<string>;
  episodeKeys: Set<string>;
}) {
  const errors: string[] = [];

  for (const item of args.dataset.cases) {
    for (const key of item.expectedFactKeys) {
      if (!args.factKeys.has(key)) {
        errors.push(`${item.caseId}: unknown expectedFactKey ${key}`);
      }
    }
    for (const key of item.expectedEpisodeKeys) {
      if (!args.episodeKeys.has(key)) {
        errors.push(`${item.caseId}: unknown expectedEpisodeKey ${key}`);
      }
    }
    for (const key of item.forbiddenFactKeys) {
      if (!args.factKeys.has(key)) {
        errors.push(`${item.caseId}: unknown forbiddenFactKey ${key}`);
      }
    }
    for (const key of item.forbiddenEpisodeKeys) {
      if (!args.episodeKeys.has(key)) {
        errors.push(`${item.caseId}: unknown forbiddenEpisodeKey ${key}`);
      }
    }
    for (const key of item.neutralFactKeys) {
      if (!args.factKeys.has(key)) {
        errors.push(`${item.caseId}: unknown neutralFactKey ${key}`);
      }
    }
    for (const key of item.neutralEpisodeKeys) {
      if (!args.episodeKeys.has(key)) {
        errors.push(`${item.caseId}: unknown neutralEpisodeKey ${key}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Memory citation dataset/manifest mismatch:\n${errors.join("\n")}`,
    );
  }
}
