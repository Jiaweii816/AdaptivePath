import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { codeRunnerLanguageSchema } from "@/types/code-runner";
import {
  DEFAULT_REVIEW_REPLAY_FIXTURE_DIR,
  loadReviewReplayCases,
  type ReviewReplayCase,
} from "./replay-run-evidence";

export const DEFAULT_REVIEW_DATASET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../datasets/review/review-v1.1.json",
);

const evidenceMarkerSchema = z.object({
  label: z.string().trim().min(1),
  value: z.string().min(1),
  match: z
    .enum(["case_insensitive_substring", "compact_substring"])
    .default("case_insensitive_substring"),
});

const reviewDatasetCaseSchema = z.object({
  caseId: z.string().trim().min(1),
  fixtureId: z.string().trim().min(1),
  problem: z.object({
    slug: z.string().trim().min(1),
    title: z.string().trim().min(1),
    leetcodeNumber: z.number().int().positive(),
  }),
  language: codeRunnerLanguageSchema,
  bugCategory: z.string().trim().min(1),
  goldenMistakeTags: z.array(z.string().trim().min(1)).min(1),
  expectedEvidenceMarkers: z.array(evidenceMarkerSchema).min(1),
  source: z.enum(["generated", "realistic", "manual", "synthetic", "real_history"]),
  notes: z.string().trim().min(1),
  limitations: z.array(z.string().trim().min(1)).default([]),
  humanReviewStatus: z.enum(["pending", "approved", "rejected"]),
});

const reviewDatasetSchema = z
  .object({
    datasetVersion: z.enum(["review-coachbench-v1", "review-coachbench-v1.1"]),
    name: z.string().trim().min(1),
    status: z.string().trim().min(1),
    description: z.string().trim().min(1),
    labelTaxonomy: z.array(
      z.object({
        bugCategory: z.string().trim().min(1),
        goldenMistakeTags: z.array(z.string().trim().min(1)).min(1),
        notes: z.string().trim().min(1),
      }),
    ),
    cases: z.array(reviewDatasetCaseSchema).min(1),
  })
  .superRefine((dataset, context) => {
    const caseIds = new Set<string>();
    const taxonomy = new Map(
      dataset.labelTaxonomy.map((item) => [
        item.bugCategory,
        normalizeDatasetTags(item.goldenMistakeTags),
      ]),
    );

    for (const [index, item] of dataset.cases.entries()) {
      if (caseIds.has(item.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
          message: `Duplicate review caseId: ${item.caseId}`,
        });
      }
      caseIds.add(item.caseId);

      const taxonomyTags = taxonomy.get(item.bugCategory);
      if (!taxonomyTags) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "bugCategory"],
          message: `bugCategory ${item.bugCategory} is missing from labelTaxonomy.`,
        });
        continue;
      }

      const caseTags = normalizeDatasetTags(item.goldenMistakeTags);
      if (JSON.stringify(caseTags) !== JSON.stringify(taxonomyTags)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "goldenMistakeTags"],
          message:
            "Case goldenMistakeTags must match the bugCategory taxonomy entry.",
        });
      }
    }
  });

type ReviewDatasetRaw = z.infer<typeof reviewDatasetSchema>;

export type ReviewEvidenceMarker = z.infer<typeof evidenceMarkerSchema>;

export type ReviewDatasetCase = z.infer<typeof reviewDatasetCaseSchema> & {
  fixture: ReviewReplayCase;
};

export type ReviewDataset = Omit<ReviewDatasetRaw, "cases"> & {
  cases: ReviewDatasetCase[];
};

export function loadReviewDataset(options?: {
  datasetPath?: string;
  fixtureDir?: string;
}): ReviewDataset {
  const datasetPath = options?.datasetPath ?? DEFAULT_REVIEW_DATASET_PATH;
  const fixtureDir =
    options?.fixtureDir ?? resolveFixtureDirForDatasetPath(datasetPath);
  let rawDataset: unknown;

  try {
    rawDataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read review dataset ${datasetPath}: ${reason}`);
  }

  const parsed = reviewDatasetSchema.safeParse(rawDataset);
  if (!parsed.success) {
    throw new Error(
      `Invalid review dataset ${datasetPath}: ${parsed.error.message}`,
    );
  }

  const fixturesById = new Map(
    loadReviewReplayCases({ fixtureDir }).map((fixture) => [fixture.id, fixture]),
  );

  return {
    ...parsed.data,
    cases: parsed.data.cases.map((reviewCase) => {
      const fixture = fixturesById.get(reviewCase.fixtureId);

      if (!fixture) {
        throw new Error(
          `Review dataset case ${reviewCase.caseId} references missing fixture ${reviewCase.fixtureId}.`,
        );
      }

      validateCaseFixtureCompatibility(reviewCase, fixture);

      return {
        ...reviewCase,
        fixture,
      };
    }),
  };
}

function validateCaseFixtureCompatibility(
  reviewCase: z.infer<typeof reviewDatasetCaseSchema>,
  fixture: ReviewReplayCase,
) {
  const mismatches: string[] = [];

  if (reviewCase.caseId !== fixture.id) {
    mismatches.push(`caseId ${reviewCase.caseId} != fixture id ${fixture.id}`);
  }
  if (reviewCase.problem.slug !== fixture.problem.slug) {
    mismatches.push(
      `problem.slug ${reviewCase.problem.slug} != fixture slug ${fixture.problem.slug}`,
    );
  }
  if (reviewCase.problem.leetcodeNumber !== fixture.problem.leetcodeNumber) {
    mismatches.push(
      `problem.leetcodeNumber ${reviewCase.problem.leetcodeNumber} != fixture number ${fixture.problem.leetcodeNumber}`,
    );
  }
  if (reviewCase.language !== fixture.language) {
    mismatches.push(`language ${reviewCase.language} != fixture ${fixture.language}`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Review dataset case ${reviewCase.caseId} is incompatible with fixture ${fixture.id}: ${mismatches.join("; ")}.`,
    );
  }
}

function normalizeDatasetTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
}

function resolveFixtureDirForDatasetPath(datasetPath: string) {
  const datasetFile = path.basename(datasetPath);

  if (datasetFile === "review-v1.1.json") {
    return path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../fixtures/run-evidence/review-v1.1",
    );
  }

  return DEFAULT_REVIEW_REPLAY_FIXTURE_DIR;
}
