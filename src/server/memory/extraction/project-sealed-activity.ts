import type { SealedActivityClusterInput } from "@/server/memory/activity-clusters/activity-cluster.types";
import { canonicalMechanismsForProblemTags } from "@/server/problems/hot150-taxonomy";
import {
  activityExtractionInputSchema,
  type ParsedActivityExtractionInput,
} from "./activity-extraction-contract";

export function projectSealedActivityForExtraction(
  sealed: SealedActivityClusterInput,
  args: {
    allowedLearnerEvidenceTraceIds: string[];
    problemTitle?: string;
    problemTags?: string[];
    existingClaimCandidates?: ParsedActivityExtractionInput["existingClaimCandidates"];
  },
): ParsedActivityExtractionInput {
  const allowed = new Set(args.allowedLearnerEvidenceTraceIds);
  return activityExtractionInputSchema.parse({
    cluster: {
      id: sealed.cluster.id,
      kind: sealed.cluster.kind,
      inputHash: sealed.inputHash,
      independentEvidenceKey: sealed.independentEvidenceKey,
      problemId: sealed.cluster.problemId,
      problemTitle: args.problemTitle,
      problemTags: args.problemTags ?? [],
      candidateMechanismKeys: canonicalMechanismsForProblemTags(
        args.problemTags ?? [],
      ).map((entry) => entry.key),
      startedAt: sealed.cluster.startedAt.toISOString(),
      endedAt: sealed.cluster.endedAt?.toISOString() ?? null,
    },
    items: sealed.items.map((item) => ({
      ordinal: item.ordinal,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      speaker: speakerFor(item),
      occurredAt: item.occurredAt.toISOString(),
      text: readableItemText(item.payload, item.metadata, item.role),
      evidenceTraceIds: evidenceIdsFor(item, allowed),
    })),
    allowedLearnerEvidenceTraceIds: [...allowed],
    existingClaimCandidates: args.existingClaimCandidates ?? [],
  });
}

function speakerFor(item: SealedActivityClusterInput["items"][number]) {
  if (item.evidenceRole === "coach_response" || item.role === "assistant") {
    return "assistant" as const;
  }
  if (item.evidenceRole === "learner_action" || item.role === "user") {
    return "learner" as const;
  }
  if (
    item.evidenceRole === "execution_evidence" ||
    item.evidenceRole === "diagnosis" ||
    item.evidenceRole === "revision"
  ) {
    return "evidence" as const;
  }
  return "system" as const;
}

function readableItemText(
  payload: Record<string, unknown> | undefined,
  metadata: Record<string, unknown>,
  role: string | null,
) {
  const values = [
    readText(payload, "content"),
    readText(payload, "contentMarkdown"),
    readText(payload, "message"),
    readText(payload, "summary"),
    readText(payload, "coachSummary"),
    readText(payload, "userIssueSummary"),
    readText(payload, "userQuestion"),
    readText(payload, "userState"),
    readText(payload, "status"),
    readText(payload, "code"),
    readText(payload, "codeSnapshot"),
    readText(payload, "coachReplyMarkdown"),
    readText(metadata, "summary"),
  ].filter((value): value is string => Boolean(value));
  const text = [...new Set(values)].join("\n").trim();
  return (text || `${role ?? "activity"} ${String(payload?.id ?? "event")}`).slice(
    0,
    4_000,
  );
}

function readText(value: Record<string, unknown> | undefined, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function evidenceIdsFor(
  item: SealedActivityClusterInput["items"][number],
  allowed: Set<string>,
) {
  const candidates = [
    item.sourceId,
    readText(item.metadata, "traceId"),
    readText(item.metadata, "l1EventId"),
    readText(item.payload, "traceId"),
    readText(item.payload, "l1EventId"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates.filter((value) => allowed.has(value)))];
}
