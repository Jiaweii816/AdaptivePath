import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const manifestFactStatusSchema = z.enum([
  "current",
  "stale",
  "superseded",
  "low_confidence",
]);

const arbitrationPathEntrySchema = z.object({
  episodeKey: z.string().trim().min(1),
  evidenceKind: z.string().trim().min(1),
  source: z.string().trim().min(1),
  evidenceTraceIds: z.array(z.string().trim().min(1)).min(1),
});

const manifestFactSchema = z.object({
  scenarioFactKey: z.string().trim().min(1),
  factId: z.string().trim().min(1),
  factType: z.string().trim().min(1),
  tag: z.string().trim().min(1),
  label: z.string().nullable(),
  value: z.string().nullable(),
  dbStatus: z.string().trim().min(1),
  scenarioStatus: manifestFactStatusSchema,
  confidence: z.number().min(0).max(1),
  expectedRetrievable: z.boolean(),
  relatedProblemSlugs: z.array(z.string().trim().min(1)),
  sourceEpisodeKey: z.string().trim().min(1),
  sourceEpisodeId: z.string().trim().min(1),
  source: z.string().trim().min(1),
  evidenceTraceIds: z.array(z.string().trim().min(1)),
  arbitrationPath: z.array(arbitrationPathEntrySchema).min(1),
});

const manifestEpisodeSchema = z.object({
  scenarioEpisodeKey: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  problemSlug: z.string().trim().min(1),
  problemPath: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  outcome: z.string().trim().min(1),
  expectedRetrievable: z.boolean(),
  sourceTraceIds: z.array(z.string().trim().min(1)),
});

const manifestStaleFactSchema = z.object({
  scenarioFactKey: z.string().trim().min(1),
  factId: z.string().trim().min(1),
  dbStatus: z.string().trim().min(1),
  scenarioStatus: manifestFactStatusSchema,
  reason: z.string().trim().min(1),
});

const manifestPreferenceSchema = z.object({
  scenarioFactKey: z.string().trim().min(1),
  factId: z.string().trim().min(1),
  tag: z.string().trim().min(1),
  label: z.string().nullable(),
  expectedRetrievable: z.boolean(),
});

export const seedLearnerManifestSchema = z.object({
  manifestVersion: z.literal("seed-learner-manifest-v1"),
  generatedAt: z.string().trim().min(1),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z.literal("seed-learner-scenario-v1"),
  scenarioPath: z.string().trim().min(1),
  dbPath: z.string().trim().min(1),
  learnerId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  humanReviewStatus: z.enum(["pending", "approved", "rejected"]),
  counts: z.object({
    facts: z.number().int().nonnegative(),
    episodes: z.number().int().nonnegative(),
    staleOrSupersededFacts: z.number().int().nonnegative(),
    preferenceFacts: z.number().int().nonnegative(),
  }),
  facts: z.array(manifestFactSchema),
  episodes: z.array(manifestEpisodeSchema),
  staleFacts: z.array(manifestStaleFactSchema),
  preferences: z.array(manifestPreferenceSchema),
  arbitration: z.object({
    used: z.boolean(),
    sources: z.array(z.string().trim().min(1)),
    rejectedCandidateCount: z.number().int().nonnegative(),
    deterministicIdUpdates: z.array(z.string().trim().min(1)),
    fixtureOnlyWrites: z.array(z.string().trim().min(1)),
  }),
  realLlmCalls: z.boolean(),
  notes: z.array(z.string().trim().min(1)),
  limitations: z.array(z.string().trim().min(1)),
});

export type SeedLearnerManifest = z.infer<typeof seedLearnerManifestSchema>;
export type SeedLearnerManifestFact = SeedLearnerManifest["facts"][number];

export function writeSeedLearnerManifest(
  manifestPath: string,
  manifest: SeedLearnerManifest,
) {
  const parsed = seedLearnerManifestSchema.parse(manifest);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export function loadSeedLearnerManifest(manifestPath: string) {
  let rawManifest: unknown;

  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read seed learner manifest ${manifestPath}: ${reason}`);
  }

  const parsed = seedLearnerManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    throw new Error(
      `Invalid seed learner manifest ${manifestPath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}
