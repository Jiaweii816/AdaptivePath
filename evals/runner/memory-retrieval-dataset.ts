import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const DEFAULT_MEMORY_RETRIEVAL_DATASET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../datasets/memory/memory-retrieval-v1.json",
);

const memoryRetrievalCategorySchema = z.enum([
  "mistake_recall",
  "skill_recall",
  "preference",
  "api_confusion",
  "stale_suppression",
  "low_confidence_suppression",
]);

const queryLanguageSchema = z.enum(["zh", "en", "mixed"]);
const queryDifficultySchema = z.enum(["direct", "paraphrase", "adversarial"]);
const memoryNeedSchema = z.enum([
  "must_retrieve",
  "nice_to_have",
  "must_not_retrieve",
]);

const retrievalEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("review") }),
  z.object({ kind: z.literal("kickoff") }),
  z.object({ kind: z.literal("recall_tool") }),
  z.object({
    kind: z.literal("chat"),
    intent: z.string().trim().min(1),
  }),
]);

const memoryRetrievalCaseSchema = z.object({
  queryId: z.string().trim().min(1),
  category: memoryRetrievalCategorySchema,
  problemSlug: z.string().trim().min(1),
  entry: retrievalEntrySchema,
  userQuestion: z.string().trim().min(1),
  expectedFactKeys: z.array(z.string().trim().min(1)).default([]),
  expectedEpisodeKeys: z.array(z.string().trim().min(1)).default([]),
  forbiddenFactKeys: z.array(z.string().trim().min(1)).default([]),
  forbiddenEpisodeKeys: z.array(z.string().trim().min(1)).default([]),
  neutralFactKeys: z.array(z.string().trim().min(1)).default([]),
  neutralEpisodeKeys: z.array(z.string().trim().min(1)).default([]),
  expectedProfilePreferenceMarkers: z.array(z.string().trim().min(1)).default([]),
  queryLanguage: queryLanguageSchema.optional(),
  difficulty: queryDifficultySchema.optional(),
  memoryNeed: memoryNeedSchema.optional(),
  statusExpectation: z.string().trim().min(1).optional(),
  distractorKeys: z.array(z.string().trim().min(1)).default([]),
  whyExpected: z.string().trim().min(1).optional(),
  whyForbidden: z.string().trim().min(1).optional(),
  k: z.number().int().positive().max(20).default(5),
  notes: z.string().trim().min(1),
  limitations: z.array(z.string().trim().min(1)).default([]),
});

const memoryRetrievalDatasetSchema = z
  .object({
    datasetVersion: z.enum([
      "memory-retrieval-v1",
      "memory-retrieval-v1.1",
      "memory-retrieval-v1.2",
    ]),
    name: z.string().trim().min(1),
    status: z.string().trim().min(1),
    description: z.string().trim().min(1),
    defaultK: z.number().int().positive().max(20).default(5),
    humanReviewStatus: z.enum(["pending", "approved", "rejected"]),
    cases: z.array(memoryRetrievalCaseSchema).min(1),
    limitations: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((dataset, context) => {
    const seen = new Set<string>();

    for (const [index, item] of dataset.cases.entries()) {
      if (seen.has(item.queryId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "queryId"],
          message: `Duplicate memory queryId: ${item.queryId}`,
        });
      }
      seen.add(item.queryId);
    }
  });

export type MemoryRetrievalDataset = z.infer<
  typeof memoryRetrievalDatasetSchema
>;
export type MemoryRetrievalCase = MemoryRetrievalDataset["cases"][number];
export type MemoryRetrievalCategory = z.infer<
  typeof memoryRetrievalCategorySchema
>;
export type MemoryRetrievalEntry = z.infer<typeof retrievalEntrySchema>;

export function loadMemoryRetrievalDataset(options?: {
  datasetPath?: string;
}): MemoryRetrievalDataset {
  const datasetPath = options?.datasetPath ?? DEFAULT_MEMORY_RETRIEVAL_DATASET_PATH;
  let rawDataset: unknown;

  try {
    rawDataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read memory retrieval dataset ${datasetPath}: ${reason}`,
    );
  }

  const parsed = memoryRetrievalDatasetSchema.safeParse(rawDataset);
  if (!parsed.success) {
    throw new Error(
      `Invalid memory retrieval dataset ${datasetPath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

export function validateMemoryDatasetAgainstManifest(args: {
  dataset: MemoryRetrievalDataset;
  factKeys: Set<string>;
  episodeKeys: Set<string>;
}) {
  const errors: string[] = [];

  for (const item of args.dataset.cases) {
    for (const key of item.expectedFactKeys) {
      if (!args.factKeys.has(key)) {
        errors.push(`${item.queryId}: unknown expectedFactKey ${key}`);
      }
    }
    for (const key of item.expectedEpisodeKeys) {
      if (!args.episodeKeys.has(key)) {
        errors.push(`${item.queryId}: unknown expectedEpisodeKey ${key}`);
      }
    }
    for (const key of item.forbiddenFactKeys) {
      if (!args.factKeys.has(key)) {
        errors.push(`${item.queryId}: unknown forbiddenFactKey ${key}`);
      }
    }
    for (const key of item.forbiddenEpisodeKeys) {
      if (!args.episodeKeys.has(key)) {
        errors.push(`${item.queryId}: unknown forbiddenEpisodeKey ${key}`);
      }
    }
    for (const key of item.neutralFactKeys) {
      if (!args.factKeys.has(key)) {
        errors.push(`${item.queryId}: unknown neutralFactKey ${key}`);
      }
    }
    for (const key of item.neutralEpisodeKeys) {
      if (!args.episodeKeys.has(key)) {
        errors.push(`${item.queryId}: unknown neutralEpisodeKey ${key}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Memory retrieval dataset/manifest mismatch:\n${errors.join("\n")}`);
  }
}
