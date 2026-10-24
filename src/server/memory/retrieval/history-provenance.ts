import type { PrismaClient } from "@prisma/client";
import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import type { CodeRunStatus } from "@/types/code-runner";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import type { MemoryCandidate } from "./candidate-core.types";

type ProvenancePrisma = Pick<PrismaClient, "l1MemoryEvent" | "runEvidence">;

export async function attachHistoryProvenance(
  prisma: ProvenancePrisma,
  args: {
    userId: string;
    memoryOrigin: MemoryOrigin;
    candidates: MemoryCandidate[];
  },
): Promise<MemoryCandidate[]> {
  const artifacts = new Set(
    args.candidates
      .filter((candidate) => candidate.mistakeRecallBasis?.kind === "learner_confirmed_artifact")
      .map((candidate) => candidate.id),
  );
  const traceIds = [...new Set(args.candidates.flatMap((candidate) => candidate.evidenceRefs))];
  if (traceIds.length === 0) {
    return args.candidates.map((candidate) => withProvenance(candidate, artifacts));
  }
  const events = await prisma.l1MemoryEvent.findMany({
    where: { id: { in: traceIds }, userId: args.userId, memoryOrigin: args.memoryOrigin },
    select: { id: true, reviewAttemptId: true, chatSessionId: true },
  });
  const eventById = new Map(events.map((event) => [event.id, event]));
  const reviewAttemptIds = [
    ...new Set([
      ...traceIds,
      ...events.flatMap((event) => event.reviewAttemptId ? [event.reviewAttemptId] : []),
    ]),
  ];
  const chatSessionIds = [...new Set(events.flatMap((event) => event.chatSessionId ? [event.chatSessionId] : []))];
  const evidence =
    reviewAttemptIds.length === 0 && chatSessionIds.length === 0
      ? []
      : await prisma.runEvidence.findMany({
          where: {
            memoryOrigin: args.memoryOrigin,
            OR: [
              ...(reviewAttemptIds.length > 0 ? [{ reviewAttemptId: { in: reviewAttemptIds } }] : []),
              ...(chatSessionIds.length > 0 ? [{ chatSessionId: { in: chatSessionIds } }] : []),
            ],
          },
          select: { status: true, source: true, rawResultJson: true, reviewAttemptId: true, chatSessionId: true },
        });
  return args.candidates.map((candidate) => {
    if (artifacts.has(candidate.id)) return withProvenance(candidate, artifacts);
    const candidateEvents = candidate.evidenceRefs
      .map((reference) => eventById.get(reference))
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const candidateReviewIds = new Set([
      ...candidate.evidenceRefs,
      ...candidateEvents.flatMap((event) => event.reviewAttemptId ? [event.reviewAttemptId] : []),
    ]);
    const candidateChatIds = new Set(
      candidateEvents.flatMap((event) => event.chatSessionId ? [event.chatSessionId] : []),
    );
    const authorities = new Set(evidence.flatMap((row) =>
      (row.reviewAttemptId && candidateReviewIds.has(row.reviewAttemptId)) ||
      (row.chatSessionId && candidateChatIds.has(row.chatSessionId))
        ? authorityForRun(row)
        : [],
    ));
    return {
      ...candidate,
      historyProvenance: {
        executionAuthority: combineAuthorities(authorities),
        resolutionStatus: resolutionStatus(candidate.status),
      },
    };
  });
}

function withProvenance(candidate: MemoryCandidate, artifacts: Set<string>): MemoryCandidate {
  return {
    ...candidate,
    historyProvenance: artifacts.has(candidate.id)
      ? { executionAuthority: "not_applicable", resolutionStatus: "unknown" }
      : { executionAuthority: "unknown", resolutionStatus: resolutionStatus(candidate.status) },
  };
}

function combineAuthorities(authorities: Set<"official" | "local_visible">) {
  if (authorities.has("official") && authorities.has("local_visible")) return "mixed" as const;
  if (authorities.has("official")) return "official" as const;
  if (authorities.has("local_visible")) return "local_visible" as const;
  return "unknown" as const;
}

function authorityForRun(row: { status: string; source: string; rawResultJson: string }) {
  if (!isCodeRunStatus(row.status)) return [];
  const payload = parseRecord(row.rawResultJson);
  const providerUsed = typeof payload.providerUsed === "string" ? payload.providerUsed : undefined;
  const verdict = classifyExecutionEvidence(
    { status: row.status },
    { consumer: "history", providerUsed, localFallback: row.source.includes("chat") || row.source.includes("piston") },
  );
  if (verdict.evidenceClass === "verdict_bearing") return ["official" as const];
  if (verdict.evidenceClass === "local_only") return ["local_visible" as const];
  return [];
}

function isCodeRunStatus(value: string): value is CodeRunStatus {
  return [
    "passed_visible_tests", "failed", "compile_error", "syntax_error", "runtime_error",
    "timeout", "empty_code", "no_tests", "unsupported_language", "evidence_unavailable",
  ].includes(value);
}

function resolutionStatus(status: string | undefined) {
  return status === "active" || status === "improving" || status === "resolved"
    ? status
    : "unknown";
}

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
