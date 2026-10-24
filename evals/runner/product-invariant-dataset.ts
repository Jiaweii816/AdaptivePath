import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { codeRunnerLanguageSchema, codeRunResultSchema } from "@/types/code-runner";

export const DEFAULT_PRODUCT_INVARIANT_DATASET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../datasets/product-invariant/product-invariant-v1.json",
);

const invariantSchema = z.enum([
  "editor_save_state",
  "advisory_scope",
  "official_acceptance",
]);

const problemSchema = z.object({
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  leetcodeNumber: z.number().int().positive(),
  methodName: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
});

const selectedTestSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  input: z.unknown(),
  expected: z.unknown(),
});

const authoritativeEvidenceSchema = z.object({
  status: z.string().trim().min(1),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  stderr: z.string().default(""),
});

const productInvariantCaseSchema = z.object({
  caseId: z.string().trim().min(1),
  category: z.enum([
    "unsaved_coercion",
    "save_truth_clean",
    "advisory_scope_coercion",
    "advisory_scope_clean",
    "official_acceptance_coercion",
    "visible_suite_clean",
    "concept_clean",
    "debug_clean",
  ]),
  problem: problemSchema,
  language: codeRunnerLanguageSchema,
  code: z.string().min(1),
  selectedTests: z.array(selectedTestSchema).default([]),
  authoritativeEvidence: authoritativeEvidenceSchema.optional(),
  replayRunResult: codeRunResultSchema.optional(),
  userMessage: z.string().trim().min(1),
  invariantsToEvaluate: z.array(invariantSchema).min(1),
  preservationRequired: z.boolean(),
  expectedToolCalls: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().min(1),
  humanReviewStatus: z.enum(["pending", "approved", "rejected"]),
});

const productInvariantDatasetSchema = z
  .object({
    datasetVersion: z.literal("product-invariant-v1"),
    name: z.string().trim().min(1),
    status: z.string().trim().min(1),
    description: z.string().trim().min(1),
    cases: z.array(productInvariantCaseSchema).length(8),
  })
  .superRefine((dataset, context) => {
    const seen = new Set<string>();
    for (const [index, item] of dataset.cases.entries()) {
      if (seen.has(item.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
          message: `Duplicate product-invariant caseId: ${item.caseId}`,
        });
      }
      seen.add(item.caseId);
    }
  });

export type ProductInvariantDataset = z.infer<
  typeof productInvariantDatasetSchema
>;
export type ProductInvariantDatasetCase = ProductInvariantDataset["cases"][number];
export type ProductInvariantName = z.infer<typeof invariantSchema>;

export function loadProductInvariantDataset(options?: { datasetPath?: string }) {
  const datasetPath =
    options?.datasetPath ?? DEFAULT_PRODUCT_INVARIANT_DATASET_PATH;
  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(datasetPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read product-invariant dataset ${datasetPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const parsed = productInvariantDatasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid product-invariant dataset ${datasetPath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}
