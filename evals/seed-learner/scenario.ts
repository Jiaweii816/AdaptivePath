import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { evidenceKindSchema, episodeOutcomeSchema } from "@/server/memory/memory.types";
import { codeRunnerLanguageSchema, codeRunStatusSchema } from "@/types/code-runner";
import type { FactSource } from "@/server/memory/store/fact-store";

export const DEFAULT_SEED_LEARNER_SCENARIO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "scenarios/v1-learner.json",
);

const humanReviewStatusSchema = z.enum(["pending", "approved", "rejected"]);

const factSourceSchema = z.enum([
  "review_diagnosis",
  "chat_consolidation",
  "user_explicit",
  "reflection",
  "mock_interview_feedback",
]);

const scenarioFactStatusSchema = z.enum([
  "current",
  "stale",
  "superseded",
  "low_confidence",
]);

const learnerProfileSchema = z.object({
  learnerId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  handle: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  interviewGoal: z.string().trim().min(1).optional(),
  preferredLanguages: z.array(codeRunnerLanguageSchema).min(1),
  strongPatterns: z.array(z.string().trim().min(1)).default([]),
  weakPatterns: z.array(z.string().trim().min(1)).default([]),
  explanationStyle: z.array(z.string().trim().min(1)).default([]),
  outputPreferences: z.array(z.string().trim().min(1)).default([]),
});

const practicedProblemSchema = z.object({
  key: z.string().trim().min(1),
  problemId: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  leetcodeNumber: z.number().int().positive().optional(),
  difficulty: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).min(1),
  methodName: z.string().trim().min(1),
  isDemoSupported: z.boolean().default(true),
});

const runEvidenceSeedSchema = z.object({
  status: codeRunStatusSchema,
  passedCount: z.number().int().nonnegative().default(0),
  failedCount: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().nonnegative().optional(),
  actualOutput: z.string().optional(),
  expectedOutput: z.string().optional(),
  firstFailedCase: z
    .object({
      id: z.string().trim().min(1),
      label: z.string().trim().min(1),
      input: z.unknown(),
      expected: z.unknown(),
      actual: z.unknown().optional(),
      error: z.string().optional(),
    })
    .optional(),
});

const reviewEpisodeSeedSchema = z.object({
  language: codeRunnerLanguageSchema.default("Python"),
  userState: z.string().trim().min(1).optional(),
  userQuestion: z.string().trim().min(1).optional(),
  codeSnapshot: z.string().default(""),
  run: runEvidenceSeedSchema.optional(),
  diagnosis: z
    .object({
      mistakeTags: z.array(z.string().trim().min(1)).default([]),
      skillTags: z.array(z.string().trim().min(1)).default([]),
      userIssueSummary: z.string().trim().min(1),
      coachSummary: z.string().trim().min(1),
    })
    .optional(),
  coachReplyMarkdown: z.string().trim().min(1).optional(),
});

const chatEpisodeSeedSchema = z.object({
  userMessages: z.array(z.string().trim().min(1)).min(1),
  assistantMessages: z.array(z.string().trim().min(1)).default([]),
  memoryNote: z
    .object({
      tag: z.string().trim().min(1),
      value: z.string().trim().min(1),
    })
    .optional(),
});

const seedEpisodeSchema = z
  .object({
    key: z.string().trim().min(1),
    kind: z.enum(["review", "chat_segment"]),
    problemSlug: z.string().trim().min(1),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(600),
    outcome: episodeOutcomeSchema,
    tags: z.array(z.string().trim().min(1)).default([]),
    salience: z.number().min(0).max(1).default(0.5),
    expectedRetrievable: z.boolean(),
    scriptedAt: z.string().trim().min(1).optional(),
    review: reviewEpisodeSeedSchema.optional(),
    chat: chatEpisodeSeedSchema.optional(),
  })
  .superRefine((episode, context) => {
    if (episode.kind === "review" && !episode.review) {
      context.addIssue({
        code: "custom",
        path: ["review"],
        message: "review episodes must include review details.",
      });
    }
    if (episode.kind === "chat_segment" && !episode.chat) {
      context.addIssue({
        code: "custom",
        path: ["chat"],
        message: "chat_segment episodes must include chat details.",
      });
    }
  });

const factArbitrationEventSchema = z.object({
  episodeKey: z.string().trim().min(1),
  evidenceKind: evidenceKindSchema,
  observedBehavior: z.string().trim().min(1),
  value: z.string().trim().min(1).optional(),
  source: factSourceSchema.optional(),
});

const seedFactSchema = z.object({
  key: z.string().trim().min(1),
  factType: z.string().trim().min(1),
  status: scenarioFactStatusSchema,
  label: z.string().trim().min(1),
  tag: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  evidenceSummary: z.string().trim().min(1),
  relatedProblemSlugs: z.array(z.string().trim().min(1)).min(1),
  sourceEpisodeKey: z.string().trim().min(1),
  source: factSourceSchema,
  expectedRetrievable: z.boolean(),
  staleReason: z.string().trim().min(1).optional(),
  arbitration: z.array(factArbitrationEventSchema).min(1),
});

const expectedSchema = z.object({
  currentFactKeys: z.array(z.string().trim().min(1)).default([]),
  staleFactKeys: z.array(z.string().trim().min(1)).default([]),
  episodeKeys: z.array(z.string().trim().min(1)).default([]),
});

export const seedLearnerScenarioSchema = z
  .object({
    scenarioVersion: z.literal("seed-learner-scenario-v1"),
    scenarioId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    status: z.string().trim().min(1),
    description: z.string().trim().min(1),
    humanReviewStatus: humanReviewStatusSchema,
    learnerProfile: learnerProfileSchema,
    practicedProblems: z.array(practicedProblemSchema).min(1),
    // Evaluation/seed processes may create fixture identities and problem
    // metadata, but they must not mint earned learner history or L2 facts.
    // Historical benchmark scenarios remain parseable so the runner can
    // reject them with an explicit provenance error.
    episodes: z.array(seedEpisodeSchema).default([]),
    facts: z.array(seedFactSchema).default([]),
    expected: expectedSchema,
    notes: z.array(z.string().trim().min(1)).default([]),
    limitations: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((scenario, context) => {
    addDuplicateIssues(
      context,
      ["practicedProblems"],
      scenario.practicedProblems.map((item) => item.key),
      "problem key",
    );
    addDuplicateIssues(
      context,
      ["practicedProblems"],
      scenario.practicedProblems.map((item) => item.slug),
      "problem slug",
    );
    addDuplicateIssues(
      context,
      ["episodes"],
      scenario.episodes.map((item) => item.key),
      "episode key",
    );
    addDuplicateIssues(
      context,
      ["facts"],
      scenario.facts.map((item) => item.key),
      "fact key",
    );

    const problemSlugs = new Set(scenario.practicedProblems.map((item) => item.slug));
    const episodeKeys = new Set(scenario.episodes.map((item) => item.key));
    const factKeys = new Set(scenario.facts.map((item) => item.key));

    for (const [index, episode] of scenario.episodes.entries()) {
      if (!problemSlugs.has(episode.problemSlug)) {
        context.addIssue({
          code: "custom",
          path: ["episodes", index, "problemSlug"],
          message: `Unknown problem slug: ${episode.problemSlug}`,
        });
      }
    }

    for (const [index, fact] of scenario.facts.entries()) {
      if (!episodeKeys.has(fact.sourceEpisodeKey)) {
        context.addIssue({
          code: "custom",
          path: ["facts", index, "sourceEpisodeKey"],
          message: `Unknown source episode key: ${fact.sourceEpisodeKey}`,
        });
      }
      for (const [slugIndex, slug] of fact.relatedProblemSlugs.entries()) {
        if (!problemSlugs.has(slug)) {
          context.addIssue({
            code: "custom",
            path: ["facts", index, "relatedProblemSlugs", slugIndex],
            message: `Unknown related problem slug: ${slug}`,
          });
        }
      }
      for (const [eventIndex, event] of fact.arbitration.entries()) {
        if (!episodeKeys.has(event.episodeKey)) {
          context.addIssue({
            code: "custom",
            path: ["facts", index, "arbitration", eventIndex, "episodeKey"],
            message: `Unknown arbitration episode key: ${event.episodeKey}`,
          });
        }
      }
      if (fact.status !== "current" && !fact.staleReason) {
        context.addIssue({
          code: "custom",
          path: ["facts", index, "staleReason"],
          message: "Non-current facts must explain why they are stale/superseded/low-confidence.",
        });
      }
    }

    validateExpectedKeys(context, ["expected", "currentFactKeys"], scenario.expected.currentFactKeys, factKeys);
    validateExpectedKeys(context, ["expected", "staleFactKeys"], scenario.expected.staleFactKeys, factKeys);
    validateExpectedKeys(context, ["expected", "episodeKeys"], scenario.expected.episodeKeys, episodeKeys);
  });

export type SeedLearnerScenario = z.infer<typeof seedLearnerScenarioSchema>;
export type SeedLearnerScenarioFact = SeedLearnerScenario["facts"][number];
export type SeedLearnerScenarioEpisode = SeedLearnerScenario["episodes"][number];
export type SeedLearnerFactSource = FactSource;

export function loadSeedLearnerScenario(options?: {
  scenarioPath?: string;
}): SeedLearnerScenario {
  const scenarioPath = options?.scenarioPath ?? DEFAULT_SEED_LEARNER_SCENARIO_PATH;
  let rawScenario: unknown;

  try {
    rawScenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read seed learner scenario ${scenarioPath}: ${reason}`);
  }

  const parsed = seedLearnerScenarioSchema.safeParse(rawScenario);
  if (!parsed.success) {
    throw new Error(
      `Invalid seed learner scenario ${scenarioPath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

function addDuplicateIssues(
  context: z.RefinementCtx,
  path: (string | number)[],
  values: string[],
  label: string,
) {
  const seen = new Set<string>();

  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Duplicate ${label}: ${value}`,
      });
    }
    seen.add(value);
  }
}

function validateExpectedKeys(
  context: z.RefinementCtx,
  path: (string | number)[],
  values: string[],
  allowed: Set<string>,
) {
  for (const [index, value] of values.entries()) {
    if (!allowed.has(value)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Unknown expected key: ${value}`,
      });
    }
  }
}
