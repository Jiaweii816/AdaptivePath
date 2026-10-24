import { z } from "zod";
import {
  codeRunnerLanguageSchema,
  codeRunErrorDetailKindSchema,
  codeRunErrorLocationSchema,
  codeRunResultSchema,
  codeRunStatusSchema,
} from "@/types/code-runner";
import {
  evidenceVerdictSchema,
  failureProvenanceSchema,
} from "@/types/evidence";

export const DEFAULT_CHAT_MAX_TOOL_ITERATIONS = 5;
export const HARD_MAX_CHAT_TOOL_ITERATIONS = 8;

/**
 * Chat tool loop cap. It is intentionally env-overridable for local debugging,
 * but the chat path still calls the configured LLM and returns real errors.
 */
export const CHAT_MAX_TOOL_ITERATIONS = readChatMaxToolIterations();

export function readChatMaxToolIterations(
  env: NodeJS.ProcessEnv = process.env,
) {
  const rawValue = env.CHAT_MAX_TOOL_ITERATIONS;

  if (!rawValue) {
    return DEFAULT_CHAT_MAX_TOOL_ITERATIONS;
  }

  const parsed = Number(rawValue);

  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, HARD_MAX_CHAT_TOOL_ITERATIONS)
    : DEFAULT_CHAT_MAX_TOOL_ITERATIONS;
}

export function areChatToolsDisabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CHAT_TOOLS_DISABLED === "1" || env.CHAT_TOOLS_DISABLED === "true";
}

export const chatToolNameSchema = z.enum([
  "discover_capability",
  "run_current_code",
  "verify_proposed_repair",
  "past_problem_recall",
  "past_mistake_recall",
  "recall_learning_experience",
  "find_practice_problem",
  "search_interview_variant_candidates",
  "get_algorithm_hint",
  "lookup_api_reference",
  "note_memory",
  "save_knowledge_note",
  "save_mistake_book_entry",
]);

export type ChatToolName = z.infer<typeof chatToolNameSchema>;

/**
 * Meta-tool for progressive disclosure. The model describes an information or
 * capability need; it must not guess an internal tool name.
 */
export const discoverCapabilityToolArgsSchema = z
  .object({ need: z.string().trim().min(8).max(240) })
  .strict();

export const discoverCapabilityToolResultSchema = z.object({
  status: z.enum([
    "loaded",
    "no_match",
    "policy_denied",
    "requires_explicit_user_grant",
  ]),
  matchedCapabilities: z.array(
    z.object({
      capabilityId: z.string(),
      shortDescription: z.string(),
      status: z.enum(["loaded", "requires_explicit_user_grant"]),
    }),
  ).max(2),
});

export const runCodeToolTestCaseSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'Short label for this visible/custom test, for example "abba regression".',
    ),
  input: z
    .unknown()
    .describe(
      'JSON input matching the active problem contract, usually an object such as {"s":"abba"}.',
    ),
  expected: z
    .unknown()
    .describe(
      "Expected output for this visible/custom test. The tool compares actual output against this value.",
    ),
});

export const runCurrentCodeToolArgsSchema = z
  .object({
    tests: z
      .array(runCodeToolTestCaseSchema)
      .max(5)
      .optional()
      .describe(
        "Visible/custom tests to run against the user's current editor code. Use this for a user-named case like s='abba'. Omit or pass [] to rerun selected visible tests.",
      ),
    dataInput: z
      .string()
      .max(4000)
      .optional()
      .describe(
        "Raw LeetCode interpret input for the user's current editor code. In LeetCode mode this calls interpret only and does not create a real review submission.",
      ),
  })
  .strict();

const proposedRepairEditSchema = z
  .object({
    before: z
      .string()
      .trim()
      .min(1)
      .max(1200)
      .describe("Exact code fragment from the current editor that this repair replaces or removes."),
    after: z
      .string()
      .trim()
      .min(1)
      .max(1200)
      .describe("Replacement fragment present in the assistant-proposed repair code."),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .describe("Why this particular edit repairs the diagnosed mechanism."),
  })
  .strict();

export const proposedRepairSchema = z
  .object({
    diagnosis: z
      .string()
      .trim()
      .min(1)
      .max(800)
      .describe("Concrete bug or mechanism you diagnosed in the learner's current editor code."),
    changedSymbol: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Method or symbol changed by this repair, for example Solution.dfs."),
    edits: z
      .array(proposedRepairEditSchema)
      .min(1)
      .max(4)
      .describe("One or more concrete deltas from the current editor code to your proposed repair."),
    expectedBehavior: z
      .string()
      .trim()
      .min(1)
      .max(800)
      .describe("The case behavior or invariant this repair is expected to restore."),
  })
  .strict();

export const runVerifyProposedRepairToolArgsSchema = z
  .object({
    candidateCode: z
      .string()
      .min(1)
      .max(12000)
      .describe(
        "Required complete, runnable Python repair authored by you, the assistant. It must differ materially from the learner's current editor code; never copy, replay, or merely reformat the editor code.",
      ),
    language: z.literal("Python").describe(
      "The repair runner is Python-only and must match the active Python editor.",
    ),
    repair: proposedRepairSchema.describe(
      "Required proof that this is an assistant-authored repair: diagnose the current mechanism, identify the changed symbol, and give exact before/after deltas.",
    ),
    tests: z
      .array(runCodeToolTestCaseSchema)
      .max(5)
      .optional()
      .describe(
        "Visible/custom tests to run against your proposed repair. Omit or pass [] to use selected visible tests.",
      ),
    dataInput: z
      .string()
      .max(4000)
      .optional()
      .describe(
        "Raw LeetCode interpret input for your proposed repair. In LeetCode mode this calls interpret only and does not create a real review submission.",
      ),
  })
  .strict();

export const runCodeOriginSchema = z.enum([
  "user_current_editor",
  "assistant_candidate",
]);

export const runCodeEvidenceKindSchema = z.enum([
  "current_editor_run",
  "candidate_run",
]);

export const runEvidenceProducerSchema = z.enum([
  "user_action",
  "assistant_tool",
]);
export const runEvidenceSubjectSchema = z.enum([
  "current_user_code",
  "assistant_candidate",
]);
export const runEvidenceAuthoritySchema = z.enum(["authoritative", "advisory"]);
export const runEvidenceScopeSchema = z.object({
  kind: z.enum(["selected_suite", "specific_examples", "runner_defined"]),
  totalCount: z.number().int().nonnegative().optional(),
});
export const runEvidenceOracleSchema = z.enum([
  "stored_expected",
  "provided_expected",
  "runner",
]);

export const runCodeToolObservationSchema = z.object({
  observationKind: z.literal("run_code_compact_observation"),
  runEvidenceId: z.string(),
  reviewAttemptId: z.string().nullable().optional(),
  chatSessionId: z.string(),
  matchesCurrentCode: z.boolean(),
  codeOrigin: runCodeOriginSchema,
  evidenceKind: runCodeEvidenceKindSchema,
  producer: runEvidenceProducerSchema,
  subject: runEvidenceSubjectSchema,
  authority: runEvidenceAuthoritySchema,
  scope: runEvidenceScopeSchema,
  oracle: runEvidenceOracleSchema,
  candidateDescription: z.string().optional(),
  status: codeRunStatusSchema,
  failureProvenance: failureProvenanceSchema.optional(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  actualOutput: z.string().optional(),
  expectedOutput: z.string().optional(),
  firstFailedCase: z
    .object({
      id: z.string(),
      label: z.string(),
      actualOutput: z.string().optional(),
      expectedOutput: z.string().optional(),
      errorSummary: z.string().optional(),
      errorLocation: codeRunErrorLocationSchema.optional(),
    })
    .optional(),
  errorLocation: codeRunErrorLocationSchema.optional(),
  errorDetail: z
    .object({
      kind: codeRunErrorDetailKindSchema,
      title: z.string(),
      summary: z.string(),
      likelyCauses: z.array(z.string()).default([]),
      nextStep: z.string().optional(),
    })
    .optional(),
  testResultSummary: z
    .object({
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      errored: z.number().int().nonnegative(),
    })
    .optional(),
  stdoutSummary: z.string().optional(),
  stderrSummary: z.string().optional(),
  rawRunnerPayloadWithheld: z.boolean().default(false),
  untrustedOutputRedacted: z.boolean(),
  redactedFields: z.array(z.string()).default([]),
  evidenceVerdict: evidenceVerdictSchema,
  modelInstruction: z.string(),
});

export const runCodeToolResultSchema = z.object({
  runEvidenceId: z.string(),
  reviewAttemptId: z.string().nullable().optional(),
  chatSessionId: z.string(),
  codeHash: z.string().nullable().optional(),
  executionFingerprint: z.string().nullable().optional(),
  executedCodeHash: z.string().nullable().optional(),
  currentCodeHash: z.string().nullable().optional(),
  matchesCurrentCode: z.boolean(),
  codeOrigin: runCodeOriginSchema,
  evidenceKind: runCodeEvidenceKindSchema,
  producer: runEvidenceProducerSchema,
  subject: runEvidenceSubjectSchema,
  authority: runEvidenceAuthoritySchema,
  scope: runEvidenceScopeSchema,
  oracle: runEvidenceOracleSchema,
  candidateDescription: z.string().optional(),
  result: codeRunResultSchema,
  evidenceVerdict: evidenceVerdictSchema,
  modelInstruction: z.string(),
  llmObservation: runCodeToolObservationSchema,
});

export const proposedRepairRejectedToolResultSchema = z.object({
  repairValidated: z.literal(false),
  reason: z.enum([
    "current_editor_unavailable",
    "language_mismatch",
    "candidate_is_not_a_repair",
    "repair_delta_not_locatable",
  ]),
  message: z.string(),
  llmObservation: z.object({
    observationKind: z.literal("proposed_repair_rejected"),
    repairValidated: z.literal(false),
    reason: z.string(),
    message: z.string(),
    modelInstruction: z.string(),
  }),
});

export const verifyProposedRepairToolResultSchema = z.union([
  runCodeToolResultSchema.extend({
    repairValidated: z.literal(true),
    repairSummary: z.string(),
  }),
  proposedRepairRejectedToolResultSchema,
]);

export const historyRecallToolArgsSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(300)
      .describe(
        "Natural-language description of the past problem or mistake to recall.",
      ),
    searchHints: z
      .array(z.string().trim().min(1).max(100))
      .max(8)
      .optional()
      .describe(
        "Optional soft ranking hints. Unknown hints never filter out historical candidates.",
      ),
  })
  .strict();

export const historicalRecallItemSchema = z
  .object({
    kind: z.enum(["past_problem", "past_mistake"]),
    title: z.string(),
    summary: z.string(),
    sourceProblem: z.string().optional(),
    outcome: z.string().optional(),
    mechanisms: z.array(z.string()).max(4),
    evidenceBasis: z.enum([
      "durable_negative_claim",
      "accepted_negative_observation",
      "learner_confirmed_artifact",
      "validated_negative_synthesis",
      "recorded_problem_activity",
      "durable_nonnegative_claim",
      "validated_profile_synthesis",
    ]),
    executionAuthority: z.enum([
      "official",
      "local_visible",
      "mixed",
      "not_applicable",
      "unknown",
    ]),
    resolutionStatus: z.enum(["active", "improving", "resolved", "unknown"]),
    relationToCurrent: z.enum([
      "same_problem_history",
      "cross_problem_history",
      "profile_only",
    ]),
  })
  .superRefine((item, ctx) => {
    if (
      item.kind === "past_mistake" &&
      [
        "recorded_problem_activity",
        "durable_nonnegative_claim",
        "validated_profile_synthesis",
      ].includes(item.evidenceBasis)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "past_mistake requires a negative evidence basis",
      });
    }
  });

export const historyRecallToolResultSchema = z.object({
  items: z.array(historicalRecallItemSchema).max(8),
});

/**
 * Pilot-only read contract. Runtime owns learner scope, active problem, and
 * algorithm tags; the model supplies only the two semantic retrieval plans.
 */
export const learningExperienceRecallToolArgsSchema = z
  .object({
    ftsKeywords: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(12)
      .describe(
        "Concrete search terms from the current code when present, otherwise from the learner's stated topic, active problem, or improvement goal. Prefer operations, invariants, and learning mechanisms such as left = mid, interval does not shrink, lower bound, or closed interval; avoid relying on a problem title or broad algorithm label alone.",
      ),
    failurePattern: z
      .string()
      .trim()
      .min(1)
      .max(1200)
      .optional()
      .describe(
        "Describe a concrete failure behavior to search for. Derive it from current code when present; otherwise use only a failure or weakness the learner actually stated, without inventing code behavior. This is a retrieval direction, not a verified diagnosis.",
      ),
    successPattern: z
      .string()
      .trim()
      .min(1)
      .max(1200)
      .optional()
      .describe(
        "Describe the correct behavior, invariant, or improvement goal to look for in a past successful experience. It may come from current code, the active problem, or the learner's stated guidance goal. This is a retrieval direction, not a learner fact.",
      ),
  })
  .strict()
  .refine((value) => Boolean(value.failurePattern || value.successPattern), {
    message: "At least one learning-experience pattern is required.",
  });

export const learningExperienceRecallCardSchema = z.object({
  sourceProblem: z.string().optional(),
  experienceText: z.string(),
  sourceLayers: z.array(z.enum(["episode", "l2_fact", "l3_synthesis"])).min(1),
});

export const learningExperienceRecallToolResultSchema = z.object({
  pilot: z.literal("three_layer_experience"),
  retrievalStatus: z.enum([
    "full",
    "empty",
    "vector_unavailable",
    "partial_failure",
  ]),
  experiences: z.array(learningExperienceRecallCardSchema).max(2),
  message: z.string(),
});

export const findPracticeProblemToolArgsSchema = z.object({
  mode: z
    .enum(["advance", "reinforce"])
    .describe(
      "Use reinforce when the user explicitly asks for same-pattern practice, such as more HashMap drills. Use advance for a general next-problem request; the tool will finish the same Hot-150 pattern first, then move to the next Hot-150 pattern.",
    ),
  tags: z
    .array(z.string().min(1).max(80))
    .max(8)
    .describe(
      "Pattern tags to search, for example sliding-window, hashmap, binary-search, array, two-pointers.",
    ),
  completed_ids: z
    .array(z.string().min(1).max(80))
    .max(80)
    .optional()
    .describe(
      "Known completed LeetCode numbers or slugs. Pass [] if unknown; the tool also excludes locally completed ProblemHistory entries.",
    ),
});

export const practiceProblemSuggestionSchema = z.object({
  title: z.string(),
  slug: z.string(),
  leetcodeNumber: z.number().int().positive(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  tags: z.array(z.string()),
  tier: z.enum(["hot150", "extended"]),
  order: z.number().int().positive().optional(),
  section: z.string().optional(),
  reason: z.string(),
});

export const findPracticeProblemToolResultSchema = z.object({
  mode: z.enum(["advance", "reinforce"]),
  searchedTags: z.array(z.string()),
  excludedCompletedIds: z.array(z.string()),
  recommendationScope: z.enum([
    "hot150_same_type",
    "extended_same_type",
    "hot150_next_type",
    "extended_fallback",
  ]),
  transitionMessage: z.string().optional(),
  usedFallback: z.boolean(),
  suggestions: z.array(practiceProblemSuggestionSchema).max(3),
});

export const searchInterviewVariantCandidatesToolArgsSchema = z
  .object({
    company: z.string().trim().min(1).max(80).optional(),
    focus: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const webVariantCandidateSchema = z.object({
  title: z.string().min(1).max(140),
  url: z.string().url().max(512),
  sourceHost: z.string().min(1).max(200),
  snippet: z.string().min(1).max(220),
  matchedSignals: z.array(z.string().min(1).max(80)).max(3),
  relevanceScore: z.number().min(0).max(1).optional(),
});

export const searchInterviewVariantCandidatesToolResultSchema = z.object({
  status: z.enum([
    "success",
    "empty",
    "disabled",
    "timeout",
    "rate_limited",
    "quota_exceeded",
    "provider_error",
  ]),
  anchorProblem: z.object({
    title: z.string(),
    slug: z.string(),
    tags: z.array(z.string()).max(8),
  }),
  searchWindow: z.object({
    startDate: z.string(),
    endDate: z.string(),
    months: z.literal(24),
  }),
  retrievalStage: z.enum(["exact_title", "mechanism_fallback"]),
  candidates: z.array(webVariantCandidateSchema).max(3),
  weaknessCues: z.array(z.string().max(120)).max(3),
  message: z.string().max(500),
});

export const getAlgorithmHintToolArgsSchema = z
  .object({
    problem_slug: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe(
        "Optional LeetCode title slug. Omit this to use the active problem from the current chat context; pass it only when the user explicitly names a different current problem.",
      ),
    focus: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .optional()
      .describe(
        "Optional short phrase for what the learner is stuck on, e.g. binary-search boundary, window shrink, state transition, choosing a data structure, or understanding the first step.",
      ),
  })
  .strict();

export const algorithmHintLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const algorithmHintModeSchema = z.enum([
  "algorithm_or_data_structure",
  "implementation_strategy",
  "pseudocode",
]);

export const algorithmHintPolicySchema = z.object({
  mode: algorithmHintModeSchema,
  allowedDisclosure: z.string(),
  mustInclude: z.array(z.string()),
  mustAvoid: z.array(z.string()),
  finalReplyInstruction: z.string(),
});

export const getAlgorithmHintToolResultSchema = z.object({
  found: z.boolean(),
  problemSlug: z.string(),
  title: z.string().optional(),
  level: z.number().int().min(1).max(3).optional(),
  previousLevel: algorithmHintLevelSchema.optional(),
  maxLevel: z.literal(3),
  capped: z.boolean().optional(),
  problemTags: z.array(z.string()).optional(),
  focus: z.string().optional(),
  hint: z
    .object({
      heading: z.string(),
      content: z.string(),
    })
    .optional(),
  hintPolicy: algorithmHintPolicySchema.optional(),
  telemetry: z
    .object({
      progressId: z.string().optional(),
      chatSessionId: z.string().optional(),
      toolCallId: z.string().optional(),
      currentCodeHash: z.string().optional(),
      eventKind: z.literal("algorithm_hint_progressed"),
    })
    .optional(),
  message: z.string().optional(),
});

export const lookupApiReferenceToolArgsSchema = z.object({
  language: codeRunnerLanguageSchema.describe(
    "Programming language for the API reference. Only Python and C++ are supported.",
  ),
  topic: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "Specific API topic, for example collections, heapq, unordered_map, vector, priority_queue, set, or map.",
    ),
});

export const apiReferenceEntrySchema = z.object({
  language: codeRunnerLanguageSchema,
  topic: z.string(),
  summary: z.string(),
  commonUses: z.array(z.string()),
  examples: z.array(z.string()).max(4),
  pitfalls: z.array(z.string()).max(4),
});

export const knowledgeBookMatchedNoteSchema = z.object({
  noteId: z.string(),
  conceptKey: z.string(),
  title: z.string(),
  snippet: z.string(),
  whenToUse: z.string(),
  category: z.string(),
  previousLookupCount: z.number().int().nonnegative(),
  lookupCount: z.number().int().nonnegative(),
  touched: z.boolean(),
  coveredAspects: z.array(z.string()),
  missingAspects: z.array(z.string()),
  coverageReason: z.string(),
});

export const knowledgeBookLookupSchema = z.object({
  status: z.enum(["covered", "partial", "related", "none"]),
  canonicalTopic: z.string().optional(),
  queryAspects: z.array(z.string()),
  matchedNotes: z.array(knowledgeBookMatchedNoteSchema),
});

export const lookupApiReferenceToolResultSchema = z.object({
  found: z.boolean(),
  language: codeRunnerLanguageSchema,
  topic: z.string(),
  entry: apiReferenceEntrySchema.optional(),
  handbookLookup: knowledgeBookLookupSchema.optional(),
  message: z.string().optional(),
  availableTopics: z.array(z.string()).optional(),
});

export const noteMemoryToolArgsSchema = z.object({
  tag: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "snake_case preference key, e.g. preferred_language, explanation_style, practice_pace.",
    ),
  value: z
    .string()
    .min(1)
    .max(300)
    .describe("The preference content exactly as the user stated it."),
});

export const noteMemoryToolResultSchema = z.object({
  saved: z.boolean(),
  factType: z.literal("preference"),
  tag: z.string(),
  value: z.string(),
  message: z.string(),
});

export const saveKnowledgeNoteToolArgsSchema = z.object({
  conceptKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe(
      "snake_case unique concept key, e.g. python_heapq or sliding_window_template.",
    ),
  title: z.string().trim().min(1).max(80).describe("Short display title."),
  snippet: z
    .string()
    .trim()
    .min(1)
    .max(800)
    .describe("Minimal copy-paste code; may be multi-line."),
  whenToUse: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe("One line describing when to use this."),
  category: z.enum(["python_api", "cpp_stl", "algo_template", "stdlib"]),
});

export const saveKnowledgeNoteToolResultSchema = z.object({
  saved: z.boolean(),
  noteId: z.string().nullable(),
  conceptKey: z.string(),
  title: z.string(),
  alreadyExisted: z.boolean().default(false),
  lookupCount: z.number().int().nonnegative(),
  message: z.string(),
});

export const saveMistakeBookEntryToolArgsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(90)
    .describe(
      "Short display title for this problem-specific mistake-book entry.",
    ),
  guideMarkdown: z
    .string()
    .trim()
    .min(1)
    .max(2200)
    .describe(
      "Problem-specific review guide in markdown. Focus on the solution idea, invariant, key boundary, and implementation reminders for the active problem. Do not paste a full official solution.",
    ),
  selfCheckQuestion: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .optional()
    .describe("Optional active-recall question for this exact problem."),
  selfCheckAnswer: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe("Optional concise answer to the self-check question."),
  tags: z
    .array(z.string().trim().min(1).max(60))
    .max(8)
    .optional()
    .describe("Problem/pattern tags such as two_pointers or binary_search."),
});

export const saveMistakeBookEntryToolResultSchema = z.object({
  saved: z.boolean(),
  entryId: z.string().nullable(),
  problemSlug: z.string(),
  title: z.string(),
  saveCount: z.number().int().nonnegative(),
  message: z.string(),
  recallIndexStatus: z.enum(["ready", "pending_repair"]).optional(),
});

export const chatToolArgSchemas = {
  discover_capability: discoverCapabilityToolArgsSchema,
  run_current_code: runCurrentCodeToolArgsSchema,
  verify_proposed_repair: runVerifyProposedRepairToolArgsSchema,
  past_problem_recall: historyRecallToolArgsSchema,
  past_mistake_recall: historyRecallToolArgsSchema,
  recall_learning_experience: learningExperienceRecallToolArgsSchema,
  find_practice_problem: findPracticeProblemToolArgsSchema,
  search_interview_variant_candidates:
    searchInterviewVariantCandidatesToolArgsSchema,
  get_algorithm_hint: getAlgorithmHintToolArgsSchema,
  lookup_api_reference: lookupApiReferenceToolArgsSchema,
  note_memory: noteMemoryToolArgsSchema,
  save_knowledge_note: saveKnowledgeNoteToolArgsSchema,
  save_mistake_book_entry: saveMistakeBookEntryToolArgsSchema,
} as const satisfies Record<ChatToolName, z.ZodType>;

export const chatToolResultSchemas = {
  discover_capability: discoverCapabilityToolResultSchema,
  run_current_code: runCodeToolResultSchema,
  verify_proposed_repair: verifyProposedRepairToolResultSchema,
  past_problem_recall: historyRecallToolResultSchema,
  past_mistake_recall: historyRecallToolResultSchema,
  recall_learning_experience: learningExperienceRecallToolResultSchema,
  find_practice_problem: findPracticeProblemToolResultSchema,
  search_interview_variant_candidates:
    searchInterviewVariantCandidatesToolResultSchema,
  get_algorithm_hint: getAlgorithmHintToolResultSchema,
  lookup_api_reference: lookupApiReferenceToolResultSchema,
  note_memory: noteMemoryToolResultSchema,
  save_knowledge_note: saveKnowledgeNoteToolResultSchema,
  save_mistake_book_entry: saveMistakeBookEntryToolResultSchema,
} as const satisfies Record<ChatToolName, z.ZodType>;

export type ChatToolArgs<TName extends ChatToolName> = z.infer<
  (typeof chatToolArgSchemas)[TName]
>;
export type ChatToolResult<TName extends ChatToolName> = z.infer<
  (typeof chatToolResultSchemas)[TName]
>;

const chatToolDescriptions = {
  discover_capability:
    "Discover an additional capability when the currently available tools do not provide the information or action you need. Describe the needed capability or information in plain language; do not guess an internal tool name. Discovery never grants permission to run code or save durable learner data.",
  run_current_code:
    "Run exactly the code currently present in the user's editor. This tool has no code argument and never runs assistant-modified code. Call when the learner asks whether their current code passes/fails, asks to rerun, asks what their code outputs, says 先跑一下/跑多少/测一下/这个 case/my code/this code, or asks why the latest visible editor-code run failed. Use tests for user-named visible/custom cases such as s='abba'; omit tests to rerun selected visible tests. The result is a current-turn advisory observation about current_user_code; its scope says whether it covered the selected suite, specific examples, or runner-defined input. Do not generalize a specific_examples result to the selected suite. Do not call just because current code exists. Do not call for pure why/how concept explanation, API syntax lookup, practice recommendation, durable preference capture, or Handbook notes.",
  verify_proposed_repair:
    "Validate a concrete repair authored by you, the assistant, before recommending that repair. You MUST supply a complete modified Python implementation plus a repair object that names the current-code bug, changed symbol, exact before/after edit fragments, and expected behavior. This is NOT a way to rerun, copy, reproduce, or diagnose the learner's current editor code: use run_current_code for that. The backend rejects a candidate that is the same editor program modulo imports, comments, or formatting, or whose declared edits cannot be located. A passing result verifies only your proposed repair on its observed visible scope; it never means the learner's editor code passed or changed.",
  past_problem_recall:
    "Recall this learner's prior problems, successful transfers, and related historical episodes. Required when the learner explicitly asks what similar problems they did before or what they previously did well. Pass a natural-language query; searchHints are soft boosts only. The runtime automatically supplies user identity, active problem, and clean concepts. Read-only. Use only returned items for historical claims.",
  past_mistake_recall:
    "Recall this learner's prior mistake evidence and unresolved historical episodes. Required when the learner explicitly asks whether they made a similar mistake before. Pass a natural-language query; searchHints are soft boosts only and never hard filters. The runtime automatically supplies user identity, active problem, and clean concepts. Read-only. Use only returned items for historical claims.",
  recall_learning_experience:
    "Read-only learning-experience recall for the current question, active problem, or current Python code. REQUIRED when the learner explicitly asks you to combine, consult, or use their past learning experiences/history for guidance, even if intent classification says general follow-up. Otherwise call whenever prior learner experience could materially personalize the answer. Build concrete ftsKeywords and a specific failurePattern and/or successPattern from the current code when present; without code, use only the learner's stated topic, mechanism, or improvement goal and do not invent code behavior. Keywords should name observable operations, invariants, or learning mechanisms, not merely a problem title or a broad algorithm label. Runtime supplies learner scope. The result contains at most two evidence-family-deduplicated experiences drawn from Episode, L2 fact, and L3 synthesis. Independently decide whether each result is relevant before using it. Use only returned text for historical claims; never treat similarity as proof of the current root cause or old local evidence as official acceptance.",
  find_practice_problem:
    "Recommend 2-3 metadata-only practice problems from the controlled catalog. Use for ordinary next problems, more drills, same-pattern practice, 巩固/再练/刷两道/同类型/先简单点, or what to practice after the current topic. Use reinforce for same-pattern drills; use advance for a general next-step request. Pass tags from the learner's requested pattern or the active problem tags. The tool searches Hot-150 first and falls back internally; suggestions are not executable in this MVP. When this and search_interview_variant_candidates are both available, choose exactly one source: prefer this tool unless the learner explicitly asks for web, recent interview, company, 变体/变题/变式, or follow-up material. Do not use when the learner is asking to run/debug the current code or wants an API snippet.",
  search_interview_variant_candidates:
    "Search public web pages for recent coding-interview variant candidates related to the active Hot-150 problem. Use this instead of find_practice_problem when the learner explicitly asks for web/internet/网络/网上/recent/最近/面经/company/公司/变体/变题/变式/follow-up/手撕题 variants. Do not call both recommendation-source tools in one reply unless the learner explicitly asks to compare local practice with web discovery. Use company only when the learner explicitly names it, and focus only when they explicitly name a variant axis. The backend owns the active problem, a fixed 24-month window, privacy, and result limit; never send learner weakness, code, tests, history, or a raw query. Results are unverified source candidates, not official company questions or executable PatternCoach problems. Use only returned URLs for source citations, paraphrase rather than copy a full statement, and say when web discovery is unavailable.",
  get_algorithm_hint:
    "Advance the learner's progressive hint level for the active algorithm problem and return a hint-policy contract, not a prepared answer. Required before the final reply when the learner asks for 提示/hint/一点提示/不要答案/别直接给代码/暗示/点拨/只给方向/只要方向, says they are stuck, asks for gradual guidance, asks for the next/deeper hint such as 再深入一点/再多一点/next hint, or wants only a nudge on the current problem. For compound requests like 优化思路但只要提示, 优化方向别给答案, or 只给我一点点思路, use get_algorithm_hint before run_current_code; do not run the current code first unless the learner explicitly asks to run/verify/test a case. This generic tool works for any cached problem because it does not know the solution; it only records progression and tells you how much you may reveal. Level 1 = name the algorithm/data-structure family or core pattern only. Level 2 = connect that pattern to this problem's state, invariant, or implementation plan. Level 3 = give pseudocode-level steps or branch logic, still not full language-specific code unless the learner separately asks for a full solution. Omit problem_slug to use the active problem. Optionally pass focus if the user names what they are stuck on. Never choose or fake the level yourself; use the returned level/hintPolicy as a hard disclosure boundary in the final answer. Do not call for API syntax, full-solution requests, practice recommendations, or a pure explanation of an existing line unless the learner is asking for a hint.",
  lookup_api_reference:
    "Optionally look up a concise entry from a SMALL, OFFLINE curated cheat sheet and check whether the learner already has a matching Knowledge Handbook note. It never uses the network. Curated Python topics: deque, collections (Counter/defaultdict/deque), heapq. Curated C++ topics: vector, unordered_map, priority_queue, set, map. Use this tool only when the requested topic is in that list or when checking an existing Handbook note is useful. For tuple, list, dict, string methods, bisect, custom APIs, or any other unlisted topic, answer from your own language knowledge instead of calling this tool. If found=false, do not retry with a loosely related topic. Do not call for problem-specific algorithm logic. A save request does not require this lookup first; call save_knowledge_note directly when you already know the reusable syntax.",
  note_memory:
    'Save a durable user preference to long-term memory immediately. Required before the final reply when the learner states a future preference, even without the word "remember": "以后/之后/后面/下次...", "默认用 Python", "我更喜欢/更吃手动走例子", "先别直接给完整解", "英文问的话标题也用英文". Use a short snake_case tag and store the preference content exactly as the user stated it. Do not merely promise to remember a durable preference without this tool. Do not call for one-off instructions limited to this turn, skills, weaknesses, mistakes, or your own observations; those flow through consolidation. Do not use for reusable API/template snippets; use save_knowledge_note for those.',
  save_knowledge_note:
    "Save a reusable language/library/template note to the learner's Knowledge Handbook. Decide from the meaning of the user's request, not from a fixed keyword list. Call when the learner clearly asks to save, organize, capture, remember, review later, update, or extend reusable knowledge in a knowledge book/Knowledge Handbook/知识手册, including natural requests such as 'organize this tuple note into my knowledge book'. Author a minimal copy-paste snippet and one-line when-to-use in the current reply language. Do not call merely because a reusable API was discussed when the learner did not ask to retain it. Do not call just because lookup_api_reference found an existing Handbook note unless the learner asked to update or extend it. Do not call for output/teaching preferences (use note_memory), problem-specific bug logic, a problem-specific solution guide, 错题本, or full official solutions. The optional local API lookup is not a prerequisite when you already know the syntax. Repeated conceptKey saves only increase the lookup count unless this same turn already touched the note through Handbook lookup.",
  save_mistake_book_entry:
    "Save the ACTIVE PROBLEM to the learner's Mistake Book / 错题本 as a problem-specific review guide. Required when the learner asks to 收录这题/加入错题本/save to mistake book/放进 mistake book/这题以后复习, even if their latest Review passed but the process was hard. Use this for problem-level solution logic, invariants, boundary decisions, and implementation reminders. Do not use for reusable API/syntax/template snippets (use save_knowledge_note), durable preferences (use note_memory), or practice recommendations. Do not paste a full official solution or claim hidden-test acceptance. Repeated saves for the same active problem overwrite the guide and increment saveCount.",
} as const satisfies Record<ChatToolName, string>;

export type ChatToolManifestEntry = {
  type: "function";
  function: {
    name: ChatToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function buildChatToolManifest(
  availableToolNames: ReadonlySet<ChatToolName> = new Set(
    chatToolNameSchema.options,
  ),
): ChatToolManifestEntry[] {
  return chatToolNameSchema.options
    .filter((name) => availableToolNames.has(name))
    .map((name): ChatToolManifestEntry => ({
      type: "function",
      function: {
        name,
        description: compileAvailableToolDescription(
          chatToolDescriptions[name],
          availableToolNames,
        ),
        parameters: toOpenAiJsonSchema(chatToolArgSchemas[name]),
      },
    }));
}

export const chatToolManifest = buildChatToolManifest();

function compileAvailableToolDescription(
  description: string,
  availableToolNames: ReadonlySet<ChatToolName>,
) {
  const unavailableNames = chatToolNameSchema.options.filter(
    (name) => !availableToolNames.has(name),
  );

  if (unavailableNames.length === 0) {
    return description;
  }

  return description
    .split(/(?<=\.)\s+/)
    .filter(
      (sentence) =>
        !unavailableNames.some((toolName) => sentence.includes(toolName)),
    )
    .join(" ")
    .trim();
}

function toOpenAiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  return jsonSchema;
}
