import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  appendTraceEventBestEffort,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";
import type { FtsStore } from "./store/fts-store";
import type { MemoryOrigin } from "./memory-origin";
import type { VectorStore } from "./store/vector-store";
import { buildRetrievalQueryPlan } from "./retrieval/build-retrieval-query-plan";
import type {
  AutomaticMemoryIntent,
  CoachMemoryBrief,
  MemoryCandidate,
  RetrievalQueryPlan,
} from "./retrieval/candidate-core.types";
import { canonicalizeConcept } from "./retrieval/concepts";
import { projectCandidateForTrace } from "./retrieval/candidate-trace-projection";
import {
  retrieveCoachMemoryCandidates,
  type RetrievedCoachMemory,
} from "./retrieval/retrieve-coach-memory";
import { selectAutomaticMemory } from "./retrieval/select-automatic-memory";
import type { RetrievalEntry } from "./retrieval/profiles";
import type { EmbedClient } from "./retrieval/embed-client";
import { buildMemoryPromptReceipt } from "./retrieval/memory-prompt-receipt";

type AssemblyPrisma = Pick<
  PrismaClient,
  | "problem"
  | "l2MemoryFact"
  | "memoryEpisode"
  | "problemHistory"
  | "synthesisSlot"
  | "mistakeBookEntry"
>;

export type CoachMemoryAssembly = {
  queryPlan: RetrievalQueryPlan;
  candidates: MemoryCandidate[];
  candidateFingerprint: string;
  brief: CoachMemoryBrief;
  decisions: Array<{ candidateId: string; selected: boolean; reason: string }>;
};

export type AssembleCoachMemoryArgs = {
  userId: string;
  problemId: string;
  problemTags: string[];
  queryText: string;
  /** Runtime-owned scope; omitted only by legacy learner-only callers. */
  memoryOrigin?: MemoryOrigin;
  entry: RetrievalEntry;
  profile: {
    strongPatterns: string[];
    weakPatterns: string[];
    outputPreferences: string[];
  };
  currentSignal?: {
    mechanism?: string;
    stuckLayer?: string;
    failedCaseSummary?: string;
  };
  code?: string;
  ftsStore?: FtsStore;
  vectorStore?: VectorStore;
  embedClient?: EmbedClient;
  traceContext?: TraceContext;
};

export async function assembleCoachMemory(
  prisma: AssemblyPrisma,
  args: AssembleCoachMemoryArgs,
): Promise<CoachMemoryAssembly> {
  const problem = await loadProblem(prisma, args);
  const queryPlan = buildRetrievalQueryPlan({
    path: args.entry.kind === "review" ? "review" : "chat",
    intent: resolveAutomaticIntent(args.entry),
    userText: args.queryText,
    problem: { ...problem, tags: args.problemTags },
    currentSignal: args.currentSignal,
    code: args.code,
    language: "Python",
  });
  const retrieved = await retrieveCoachMemoryCandidates(prisma, {
    userId: args.userId,
    memoryOrigin: args.memoryOrigin ?? args.traceContext?.memoryOrigin ?? "learner",
    plan: queryPlan,
    ftsStore: args.ftsStore,
    vectorStore: args.vectorStore,
    embedClient: args.embedClient,
  });
  const candidates = [
    ...retrieved.candidates,
    ...onboardingCandidates(args.profile, queryPlan),
  ];
  const selection = selectAutomaticMemory({
    profileId: `${queryPlan.path}:${queryPlan.intent}`,
    plan: queryPlan,
    candidates,
    outputPreferences: unique([
      ...retrieved.durableOutputPreferences,
      ...args.profile.outputPreferences,
    ]),
    teachingStrategy: retrieved.teachingStrategy,
    retrievalStatus: retrieved.retrievalStatus,
  });
  const assembly = {
    queryPlan,
    candidates,
    candidateFingerprint: fingerprintCandidates(candidates),
    brief: selection.brief,
    decisions: selection.decisions,
  } satisfies CoachMemoryAssembly;
  await traceAssembly(args.traceContext, assembly, retrieved);
  return assembly;
}

async function loadProblem(prisma: AssemblyPrisma, args: AssembleCoachMemoryArgs) {
  const problem = await prisma.problem.findUnique({
    where: { id: args.problemId },
    select: { id: true, slug: true, title: true, leetcodeNumber: true },
  });
  return {
    id: problem?.id ?? args.problemId,
    slug: problem?.slug ?? args.problemId,
    title: problem?.title ?? args.problemId,
    leetcodeNumber: problem?.leetcodeNumber ?? undefined,
  };
}

function onboardingCandidates(
  profile: AssembleCoachMemoryArgs["profile"],
  plan: RetrievalQueryPlan,
) {
  const strengths = profile.strongPatterns.map((value) =>
    onboardingCandidate(value, "successful_transfer", "Self-reported strength", plan),
  );
  const weaknesses = profile.weakPatterns.map((value) =>
    onboardingCandidate(value, "recurring_mistake", "Self-reported growth area", plan),
  );
  return [...strengths, ...weaknesses];
}

function onboardingCandidate(
  value: string,
  role: "successful_transfer" | "recurring_mistake",
  title: string,
  plan: RetrievalQueryPlan,
): MemoryCandidate {
  const concept = canonicalizeConcept(value);
  const active = plan.concepts.active.includes(concept);
  const profileMeta = plan.intent === "profile_meta_question";
  return {
    id: `onboarding:${hashText(`${role}:${value}`)}`,
    source: "onboarding_profile",
    truthClass: "self_reported_profile",
    role,
    title,
    teachingText:
      role === "successful_transfer"
        ? `The learner described ${humanize(value)} as a strength.`
        : `The learner described ${humanize(value)} as an area to strengthen.`,
    concepts: concept ? [concept] : [],
    evidenceRefs: [],
    retrievalSignals: {
      matchTier: active ? "concept" : profileMeta ? "lexical_only" : "none",
      conceptMatch: active ? "active" : "none",
      mechanismMatch: false,
      intentFit: profileMeta ? 1 : active ? 0.55 : 0.15,
    },
  };
}

function resolveAutomaticIntent(entry: RetrievalEntry): AutomaticMemoryIntent {
  if (entry.kind === "review" || entry.kind === "kickoff") return "review";
  if (entry.kind !== "chat") return "general_followup";
  return isAutomaticIntent(entry.intent) ? entry.intent : "general_followup";
}

function isAutomaticIntent(value: string): value is AutomaticMemoryIntent {
  return new Set<string>([
    "concept_question",
    "hint_request",
    "anxiety_or_stuck",
    "run_case_request",
    "execute_failed_ask",
    "debug_followup",
    "optimization_request",
    "full_code_request",
    "practice_request",
    "api_reference_question",
    "past_problem_recall_request",
    "past_mistake_recall_request",
    "profile_meta_question",
    "general_followup",
  ]).has(value);
}

function fingerprintCandidates(candidates: MemoryCandidate[]) {
  return hashText(
    JSON.stringify(
      [...candidates]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((candidate) => ({
          id: candidate.id,
          source: candidate.source,
          role: candidate.role,
          historyFacets: [...(candidate.historyFacets ?? [])].sort(),
          concepts: [...candidate.concepts].sort(),
          signals: candidate.retrievalSignals,
        })),
    ),
  );
}

async function traceAssembly(
  traceContext: TraceContext | undefined,
  assembly: CoachMemoryAssembly,
  retrieved: RetrievedCoachMemory,
) {
  if (!traceContext) return;
  const selectedIds = assembly.decisions
    .filter((decision) => decision.selected)
    .map((decision) => decision.candidateId);
  await appendTraceEventBestEffort(traceContext, {
    step: startTraceStep(traceContext, { spanKind: "retrieval" }),
    stage: "context_memory",
    kind: "retrieval",
    title: "Coach memory assembly",
    status:
      assembly.brief.retrievalStatus === "failed"
        ? "failed"
        : assembly.brief.retrievalStatus === "partial_failure"
          ? "degraded"
          : "succeeded",
    details: {
      retrieval: {
        queryPlan: assembly.queryPlan,
        candidateFingerprint: assembly.candidateFingerprint,
        candidateCount: assembly.candidates.length,
        candidates: assembly.candidates.map((candidate) =>
          projectCandidateForTrace(
            candidate,
            assembly.decisions.find(
              (decision) => decision.candidateId === candidate.id,
            ),
          ),
        ),
        decisions: assembly.decisions,
        sourceErrors: retrieved.sourceErrors,
      },
      metadata: {
        source: "build_coach_memory_context",
        retrievalStatus: assembly.brief.retrievalStatus,
        lexicalOnlyIsHealthy: assembly.brief.retrievalStatus === "lexical_only",
        application: {
          selectedCandidateIds: selectedIds,
          providerInputCueCount: assembly.brief.teachableMemories.length,
          memoryPromptReceipt: buildMemoryPromptReceipt(assembly.brief),
          appliedByModel: "unknown",
          visibleClaim: "unknown",
        },
      },
    },
  });
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
