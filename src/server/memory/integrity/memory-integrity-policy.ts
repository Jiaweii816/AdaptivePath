import { createHash } from "node:crypto";
import type { L1MemoryEvent, PrismaClient } from "@prisma/client";
import type { FactCandidate } from "@/server/memory/memory.types";
import { normalizeMemoryTag } from "@/server/memory/memory.types";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";
import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import { codeRunStatusSchema } from "@/types/code-runner";
import {
  resolveCanonicalMechanismSignal,
  type CanonicalMechanismResolution,
} from "@/server/problems/hot150-taxonomy";
import { verifyAssistedRepairChainClosedEvent } from "@/server/memory/consolidation/verify-assisted-repair-chain";

export const BLOCKED_DURABLE_FACT_TAGS = new Set([
  "no_search_logic",
  "hardcoded_return",
]);

const SUPPORTED_DURABLE_FACT_TYPES = new Set([
  "mistake",
  "weakness",
  "skill",
  "strength",
  "preference",
  "unresolved_confusion",
  "strategy",
]);

const MULTI_CLUSTER_FACT_TYPES = new Set([
  "mistake",
  "weakness",
  "skill",
  "strength",
  "unresolved_confusion",
]);

const LEARNER_BEHAVIOR_EVENT_TYPES = new Set([
  "review_attempt",
  "run_evidence",
  "historical_replay_attestation",
  "chat_user_message",
  "memory_note",
  "mock_interview_started",
  "mock_interview_turn",
  "mock_interview_run_evidence",
  "mock_interview_code_discussion",
  "mock_interview_feedback",
  "assisted_repair_chain_closed",
]);

const COACH_RUN_STORAGE_SOURCES = new Set([
  "chat_current_tool",
  "chat_candidate_tool",
  "chat_tool",
]);

const CODE_SHAPE_TAG_PATTERNS = [
  /^(?:no|missing|unimplemented|placeholder|dummy|hardcoded)_/,
  /^(?:search|lookup|retrieval)_implementation$/,
  /^(?:ignores?|returns?|returning)_/,
  /^(?:empty|starter|placeholder|dummy)_code$/,
  /^(?:constant|direct|dummy)_return$/,
  /^(?:syntax|compile)_error$/,
  /_syntax_error$/,
  /_compile_error$/,
];

type EligibilityPrisma = Pick<
  PrismaClient,
  | "l1MemoryEvent"
  | "runEvidence"
  | "mockInterviewRunEvidence"
  | "practiceRunLog"
  | "chatMessage"
  | "problem"
>;

type EligibilityEvidence = L1MemoryEvent;

export type DurableEvidenceCluster = {
  key: string;
  problemId: string | null;
  reviewAttemptId: string | null;
  revisionKey: string;
  transition: FactCandidate["evidenceKind"];
  evidenceTraceIds: string[];
};

export type DurableFactIntegrity = {
  version: 1;
  origin: MemoryOrigin;
  subject: "learner_behavior" | "user_explicit";
  mechanism: string;
  humanLabel: string;
  portability: "portable";
  promotionStatus: "pending" | "trusted";
  evidenceClusters: DurableEvidenceCluster[];
};

export type DurableEligibilityDecision =
  | {
      eligible: true;
      origin: "learner";
      subject: DurableFactIntegrity["subject"];
      mechanism: string;
      humanLabel: string;
      requiredClusterCount: number;
      evidenceClusters: DurableEvidenceCluster[];
      evidence: EligibilityEvidence[];
    }
  | { eligible: false; reason: string };

export function isBlockedDurableFactTag(tag: string) {
  return BLOCKED_DURABLE_FACT_TAGS.has(normalizeMemoryTag(tag));
}

export function isCodeShapeOnlyFactTag(tag: string) {
  const normalized = normalizeMemoryTag(tag);
  return CODE_SHAPE_TAG_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function containsDevelopmentNoiseText(value: string) {
  return DEVELOPMENT_NOISE_TEXT_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    const matched = pattern.test(value);
    pattern.lastIndex = 0;
    return matched;
  });
}

export function redactDevelopmentNoiseText(value: string) {
  let redacted = value;
  for (const pattern of DEVELOPMENT_NOISE_TEXT_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, " ");
    pattern.lastIndex = 0;
  }
  return redacted;
}

export function isTrustedL2FactForConsumption(fact: {
  tag: string;
  status: string;
  memoryOrigin?: string | null;
  validationJson?: string | null;
}) {
  if (isBlockedDurableFactTag(fact.tag)) return false;
  if (fact.memoryOrigin !== "learner") return false;
  if (
    fact.status !== "active" &&
    fact.status !== "improving" &&
    fact.status !== "validated"
  ) {
    return false;
  }

  return (
    readDurableFactIntegrity(fact.validationJson)?.promotionStatus === "trusted"
  );
}

export function readDurableFactIntegrity(
  validationJson: string | null | undefined,
): DurableFactIntegrity | undefined {
  const root = parseRecord(validationJson);
  const raw = asRecord(root.integrity);
  if (!raw || raw.version !== 1 || raw.origin !== "learner") return undefined;
  if (raw.subject !== "learner_behavior" && raw.subject !== "user_explicit") {
    return undefined;
  }
  if (
    typeof raw.mechanism !== "string" ||
    typeof raw.humanLabel !== "string" ||
    raw.portability !== "portable" ||
    (raw.promotionStatus !== "pending" && raw.promotionStatus !== "trusted") ||
    !Array.isArray(raw.evidenceClusters)
  ) {
    return undefined;
  }

  const clusters = raw.evidenceClusters.flatMap((value) => {
    const cluster = asRecord(value);
    if (
      !cluster ||
      typeof cluster.key !== "string" ||
      typeof cluster.revisionKey !== "string" ||
      typeof cluster.transition !== "string" ||
      !Array.isArray(cluster.evidenceTraceIds)
    ) {
      return [];
    }
    return [
      {
        key: cluster.key,
        problemId:
          typeof cluster.problemId === "string" ? cluster.problemId : null,
        reviewAttemptId:
          typeof cluster.reviewAttemptId === "string"
            ? cluster.reviewAttemptId
            : null,
        revisionKey: cluster.revisionKey,
        transition: cluster.transition as DurableEvidenceCluster["transition"],
        evidenceTraceIds: cluster.evidenceTraceIds.filter(
          (id): id is string => typeof id === "string",
        ),
      },
    ];
  });

  return {
    version: 1,
    origin: "learner",
    subject: raw.subject,
    mechanism: raw.mechanism,
    humanLabel: raw.humanLabel,
    portability: "portable",
    promotionStatus: raw.promotionStatus,
    evidenceClusters: clusters,
  };
}

export function writeDurableFactIntegrity(
  validationJson: string | null | undefined,
  integrity: DurableFactIntegrity,
) {
  return JSON.stringify({
    ...parseRecord(validationJson),
    integrity,
  });
}

export function mergeDurableEvidenceClusters(
  existing: DurableEvidenceCluster[],
  incoming: DurableEvidenceCluster[],
) {
  const byKey = new Map(existing.map((cluster) => [cluster.key, cluster]));
  for (const cluster of incoming) {
    const current = byKey.get(cluster.key);
    byKey.set(
      cluster.key,
      current
        ? {
            ...current,
            evidenceTraceIds: [
              ...new Set([
                ...current.evidenceTraceIds,
                ...cluster.evidenceTraceIds,
              ]),
            ],
          }
        : cluster,
    );
  }
  return [...byKey.values()];
}

export async function evaluateDurableEligibility(
  prisma: EligibilityPrisma,
  args: {
    userId: string;
    source: string;
    candidate: FactCandidate;
  },
): Promise<DurableEligibilityDecision> {
  const tag = normalizeMemoryTag(args.candidate.tag);
  if (isBlockedDurableFactTag(tag)) {
    return rejected("blocked_development_noise_tag");
  }
  if (!SUPPORTED_DURABLE_FACT_TYPES.has(args.candidate.factType)) {
    return rejected(`unsupported_fact_type:${args.candidate.factType}`);
  }
  if (
    args.candidate.factType !== "preference" &&
    args.candidate.factType !== "strategy" &&
    isCodeShapeOnlyFactTag(tag)
  ) {
    return rejected("code_shape_only");
  }

  const humanLabel = humanLabelFor(args.candidate);
  if (
    !isHumanReadableTeachingText(humanLabel, tag) ||
    !isHumanReadableTeachingText(args.candidate.observedBehavior, tag)
  ) {
    return rejected("missing_human_teaching_text");
  }

  const evidence = await prisma.l1MemoryEvent.findMany({
    where: { id: { in: args.candidate.evidenceTraceIds } },
  });
  if (evidence.length !== args.candidate.evidenceTraceIds.length) {
    const foundIds = new Set(evidence.map((event) => event.id));
    const missingIds = args.candidate.evidenceTraceIds.filter(
      (id) => !foundIds.has(id),
    );
    const directCoachRuns = await prisma.runEvidence.findMany({
      where: {
        id: { in: missingIds },
        source: { in: [...COACH_RUN_STORAGE_SOURCES] },
      },
      select: { id: true },
    });
    if (directCoachRuns.length > 0) {
      return rejected("ineligible_coach_run_code_evidence");
    }
    return rejected("evidence trace ids do not all exist");
  }
  if (evidence.some((event) => event.userId !== args.userId)) {
    return rejected("evidence_owner_mismatch");
  }

  const origins = new Set(evidence.map((event) => event.memoryOrigin));
  if (origins.size !== 1 || !origins.has("learner")) {
    return rejected(`ineligible_origin:${[...origins].sort().join(",")}`);
  }

  for (const event of evidence) {
    if (await hasCoachRunCodeLineage(prisma, event)) {
      return rejected("ineligible_coach_run_code_evidence");
    }
  }

  const learnerEvidence = evidence.filter(isLearnerBehaviorEvidence);
  if (learnerEvidence.length === 0) {
    return rejected("assistant_only_evidence");
  }

  const explicitPreference =
    args.candidate.factType === "preference" &&
    args.candidate.evidenceKind === "preference_set";
  if (args.candidate.factType === "preference") {
    if (
      !explicitPreference ||
      args.source !== "user_explicit" ||
      !learnerEvidence.some(
        (event) =>
          event.eventType === "memory_note" &&
          event.source === "note_memory_tool",
      )
    ) {
      return rejected("preference_requires_user_explicit_evidence");
    }
  } else if (args.candidate.evidenceKind === "preference_set") {
    return rejected("preference_set_requires_preference_fact");
  }

  if (args.candidate.factType === "strategy" && args.source !== "reflection") {
    return rejected("strategy_requires_reflection_source");
  }

  const isMistakeOrWeakness =
    args.candidate.factType === "mistake" ||
    args.candidate.factType === "weakness";
  const requiresFailedReviewEvidence =
    isMistakeOrWeakness && args.candidate.evidenceKind === "reinforce";
  const verifiedFailedRevisionEvidence = requiresFailedReviewEvidence
    ? await filterVerifiedExecutionEvidence(prisma, learnerEvidence, {
        userId: args.userId,
        expectedStatus: "failed",
        requiredCapability: "canWriteMistakeMemory",
      })
    : [];
  const verifiedAssistedRepairEvidence = requiresFailedReviewEvidence
    ? await filterVerifiedAssistedRepairEvidence(
        prisma,
        learnerEvidence,
        args.userId,
      )
    : [];
  if (
    requiresFailedReviewEvidence &&
    verifiedFailedRevisionEvidence.length === 0 &&
    verifiedAssistedRepairEvidence.length === 0
  ) {
    // Preserve the stable rejection code used by existing audits. A verified
    // assisted-repair closure is now an additional accepted proof, but a bare
    // run/chat candidate still fails this same historical gate.
    return rejected("mistake_or_weakness_requires_failed_review_evidence");
  }
  const verifiedPassedRevisionEvidence =
    args.candidate.factType === "strength" || args.candidate.factType === "skill"
      ? await filterVerifiedExecutionEvidence(prisma, learnerEvidence, {
          userId: args.userId,
          expectedStatus: "passed_visible_tests",
          requiredCapability: "canVerdict",
        })
      : [];
  if (
    (args.candidate.factType === "strength" ||
      args.candidate.factType === "skill") &&
    verifiedPassedRevisionEvidence.length === 0
  ) {
    return rejected("strength_or_skill_requires_passed_revision_evidence");
  }
  const explicitConfusionEvidence =
    args.candidate.factType === "unresolved_confusion" &&
    args.candidate.evidenceKind === "reinforce"
      ? learnerEvidence.filter((event) =>
          isExplicitLearnerConfusionEvidence(event, tag),
        )
      : [];
  if (
    args.candidate.factType === "unresolved_confusion" &&
    args.candidate.evidenceKind === "reinforce" &&
    explicitConfusionEvidence.length === 0
  ) {
    return rejected("unresolved_confusion_requires_explicit_learner_turn");
  }

  const subject: DurableFactIntegrity["subject"] = explicitPreference
    ? "user_explicit"
    : "learner_behavior";
  const clusterEvidence = requiresFailedReviewEvidence
    ? [...verifiedFailedRevisionEvidence, ...verifiedAssistedRepairEvidence]
    : verifiedPassedRevisionEvidence.length > 0
      ? verifiedPassedRevisionEvidence
      : explicitConfusionEvidence.length > 0
        ? explicitConfusionEvidence
        : explicitPreference
          ? learnerEvidence.filter(
              (event) =>
                event.eventType === "memory_note" &&
                event.source === "note_memory_tool",
            )
          : learnerEvidence;
  const provisionalEvidenceClusters = buildEvidenceClusters({
    userId: args.userId,
    evidence: clusterEvidence,
    mechanism: tag,
    transition: args.candidate.evidenceKind,
  });
  if (
    MULTI_CLUSTER_FACT_TYPES.has(args.candidate.factType) &&
    provisionalEvidenceClusters.some((cluster) => !cluster.problemId)
  ) {
    return rejected("missing_source_problem");
  }
  const requiresProblemMechanismMatch =
    isMistakeOrWeakness ||
    args.candidate.factType === "strength" ||
    args.candidate.factType === "skill" ||
    args.candidate.factType === "unresolved_confusion";
  const canonicalResolution = requiresProblemMechanismMatch
    ? await resolveMechanismForEverySourceProblem(
        prisma,
        tag,
        provisionalEvidenceClusters,
      )
    : undefined;
  if (canonicalResolution && canonicalResolution.decision !== "canonical") {
    return rejected(canonicalResolution.reason);
  }
  const canonicalMechanism =
    canonicalResolution?.decision === "canonical"
      ? canonicalResolution.key
      : tag;
  const canonicalHumanLabel =
    canonicalResolution?.decision === "canonical"
      ? canonicalResolution.label.en
      : humanLabel;
  const evidenceClusters = buildEvidenceClusters({
    userId: args.userId,
    evidence: clusterEvidence,
    mechanism: canonicalMechanism,
    transition: args.candidate.evidenceKind,
  });

  return {
    eligible: true,
    origin: "learner",
    subject,
    mechanism: canonicalMechanism,
    humanLabel: canonicalHumanLabel,
    requiredClusterCount: MULTI_CLUSTER_FACT_TYPES.has(args.candidate.factType)
      ? 2
      : 1,
    evidenceClusters,
    evidence: clusterEvidence,
  };
}

function rejected(reason: string): DurableEligibilityDecision {
  return { eligible: false, reason };
}

async function filterVerifiedAssistedRepairEvidence(
  prisma: EligibilityPrisma,
  evidence: EligibilityEvidence[],
  userId: string,
) {
  const checks = await Promise.all(
    evidence.map(async (event) => {
      if (event.eventType !== "assisted_repair_chain_closed") return false;
      try {
        const verified = await verifyAssistedRepairChainClosedEvent(
          prisma,
          event.id,
        );
        return verified.userId === userId;
      } catch {
        return false;
      }
    }),
  );
  return evidence.filter((_, index) => checks[index]);
}

function humanLabelFor(candidate: FactCandidate) {
  return candidate.factType === "strategy"
    ? candidate.observedBehavior.trim()
    : candidate.value.trim();
}

function isHumanReadableTeachingText(value: string, normalizedTag: string) {
  const text = value.trim();
  if (!text) return false;
  if (normalizeMemoryTag(text) === normalizedTag) return false;
  if (/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/i.test(text)) return false;
  if (/^(?:\{|\[)/.test(text)) return false;
  if (containsDevelopmentNoiseText(text)) {
    return false;
  }
  return true;
}

function isLearnerBehaviorEvidence(event: EligibilityEvidence) {
  if (!LEARNER_BEHAVIOR_EVENT_TYPES.has(event.eventType)) return false;
  if (event.eventType !== "mock_interview_turn") return true;
  const payload = parseJsonRecord(event.eventJson);
  return payload.role !== "assistant" && payload.role !== "interviewer";
}

async function filterVerifiedExecutionEvidence(
  prisma: EligibilityPrisma,
  evidence: EligibilityEvidence[],
  args: {
    userId: string;
    expectedStatus: "failed" | "passed_visible_tests";
    requiredCapability: "canWriteMistakeMemory" | "canVerdict";
  },
) {
  const checks = await Promise.all(
    evidence.map(async (event) => ({
      event,
      verified: await isRelationallyVerifiedExecutionEvidence(
        prisma,
        event,
        args,
      ),
    })),
  );
  return checks.filter((check) => check.verified).map((check) => check.event);
}

async function isRelationallyVerifiedExecutionEvidence(
  prisma: EligibilityPrisma,
  event: EligibilityEvidence,
  args: {
    userId: string;
    expectedStatus: "failed" | "passed_visible_tests";
    requiredCapability: "canWriteMistakeMemory" | "canVerdict";
  },
) {
  if (
    event.eventType !== "run_evidence" &&
    event.eventType !== "historical_replay_attestation" &&
    event.eventType !== "mock_interview_run_evidence"
  ) {
    return false;
  }
  const payload = parseJsonRecord(event.eventJson);
  const runEvidenceId =
    readString(payload.runEvidenceId) ??
    readString(payload.originalRunEvidenceId);
  if (
    !event.problemId ||
    !runEvidenceId ||
    readString(payload.status) !== args.expectedStatus
  ) {
    return false;
  }

  if (event.eventType === "historical_replay_attestation") {
    return isHistoricalReplayExecutionEvidence(prisma, event, payload, {
      ...args,
      runEvidenceId,
    });
  }

  if (event.eventType === "run_evidence") {
    if (event.source !== "review_pipeline" || !event.reviewAttemptId) {
      return false;
    }
    const executionFingerprint = readExecutionFingerprint(payload);
    if (!executionFingerprint) return false;
    const stored = await prisma.runEvidence.findUnique({
      where: { id: runEvidenceId },
      include: {
        reviewAttempt: {
          select: {
            id: true,
            userId: true,
            problemId: true,
            chatSessionId: true,
            language: true,
            codeSnapshot: true,
            memoryOrigin: true,
          },
        },
      },
    });
    const computedFingerprint =
      stored?.reviewAttempt?.language === "Python"
        ? fingerprintCodeForExecution({
            language: "Python",
            code: stored.reviewAttempt.codeSnapshot,
          })
        : undefined;
    return Boolean(
      stored &&
        stored.source === "review" &&
        stored.memoryOrigin === "learner" &&
        stored.status === args.expectedStatus &&
        stored.executionFingerprint === computedFingerprint &&
        executionFingerprint === computedFingerprint &&
        stored.reviewAttempt?.id === event.reviewAttemptId &&
        stored.reviewAttempt.userId === args.userId &&
        stored.reviewAttempt.problemId === event.problemId &&
        stored.reviewAttempt.chatSessionId === event.chatSessionId &&
        stored.reviewAttempt.language === "Python" &&
        stored.reviewAttempt.memoryOrigin === "learner" &&
        storedRunHasCapability(
          stored.rawResultJson,
          payload,
          args.expectedStatus,
          args.requiredCapability,
        ),
    );
  }

  if (event.source !== "mock_interview:run_code") return false;
  const codeSnapshotId = readString(payload.codeSnapshotId);
  if (!codeSnapshotId) return false;
  const stored = await prisma.mockInterviewRunEvidence.findUnique({
    where: { id: runEvidenceId },
    include: {
      session: { select: { userId: true, problemId: true } },
      codeSnapshot: {
        select: {
          id: true,
          sessionId: true,
          problemId: true,
          language: true,
          code: true,
        },
      },
    },
  });
  const computedFingerprint =
    stored?.codeSnapshot?.language === "Python"
    ? fingerprintCodeForExecution({
        language: "Python",
        code: stored.codeSnapshot.code,
      })
    : undefined;
  return Boolean(
    stored &&
      stored.status === args.expectedStatus &&
      stored.problemId === event.problemId &&
      stored.codeSnapshotId === codeSnapshotId &&
      stored.codeSnapshot?.id === codeSnapshotId &&
      stored.codeSnapshot.sessionId === stored.sessionId &&
      stored.codeSnapshot.problemId === event.problemId &&
      readExecutionFingerprint(payload) === computedFingerprint &&
      stored.session.userId === args.userId &&
      stored.session.problemId === event.problemId &&
      storedRunHasCapability(
        stored.rawResultJson,
        payload,
        args.expectedStatus,
        args.requiredCapability,
      ),
  );
}

async function isHistoricalReplayExecutionEvidence(
  prisma: EligibilityPrisma,
  event: EligibilityEvidence,
  payload: Record<string, unknown>,
  args: {
    userId: string;
    expectedStatus: "failed" | "passed_visible_tests";
    requiredCapability: "canWriteMistakeMemory" | "canVerdict";
    runEvidenceId: string;
  },
) {
  if (
    event.source !== "memory_agent:historical_replay" ||
    !event.reviewAttemptId ||
    readString(payload.originalReviewAttemptId) !== event.reviewAttemptId
  ) {
    return false;
  }
  const stored = await prisma.runEvidence.findUnique({
    where: { id: args.runEvidenceId },
    include: {
      reviewAttempt: {
        select: {
          id: true,
          userId: true,
          problemId: true,
          language: true,
          codeSnapshot: true,
        },
      },
    },
  });
  const status = codeRunStatusSchema.safeParse(stored?.status);
  const computedFingerprint =
    stored?.reviewAttempt?.language === "Python"
      ? fingerprintCodeForExecution({
          language: "Python",
          code: stored.reviewAttempt.codeSnapshot,
        })
      : undefined;
  const raw = parseJsonRecord(stored?.rawResultJson ?? "");
  const rawResult = asRecord(raw.rawResult);
  const providerUsed = readString(rawResult?.providerUsed);
  const verdict = status.success
    ? classifyExecutionEvidence(
        {
          status: status.data,
          failureProvenance:
            typeof raw.failureProvenance === "string"
              ? (raw.failureProvenance as Parameters<
                  typeof classifyExecutionEvidence
                >[0]["failureProvenance"])
              : undefined,
        },
        {
          consumer: "review",
          providerUsed,
          localFallback:
            providerUsed === "piston" || providerUsed === "piston_fallback",
        },
      )
    : undefined;
  const eventVerdict = asRecord(payload.evidenceVerdict);
  const eventCapabilities = asRecord(eventVerdict?.capabilities);
  return Boolean(
    stored &&
      verdict &&
      stored.source === "review" &&
      stored.status === args.expectedStatus &&
      stored.reviewAttempt?.id === event.reviewAttemptId &&
      stored.reviewAttempt.userId === args.userId &&
      stored.reviewAttempt.problemId === event.problemId &&
      stored.reviewAttempt.language === "Python" &&
      readExecutionFingerprint(payload) === computedFingerprint &&
      readString(eventVerdict?.status) === verdict.status &&
      readString(eventVerdict?.providerUsed) === verdict.providerUsed &&
      readString(eventVerdict?.evidenceClass) === verdict.evidenceClass &&
      eventCapabilities?.[args.requiredCapability] === true &&
      verdict.capabilities[args.requiredCapability] === true
  );
}

function storedRunHasCapability(
  rawResultJson: string,
  eventPayload: Record<string, unknown>,
  status: "failed" | "passed_visible_tests",
  capability: "canWriteMistakeMemory" | "canVerdict",
) {
  const raw = parseJsonRecord(rawResultJson);
  const rawResult = asRecord(raw.rawResult);
  const storedVerdict =
    asRecord(rawResult?.evidenceVerdict) ?? asRecord(raw.evidenceVerdict);
  const eventVerdict = asRecord(eventPayload.evidenceVerdict);
  const storedCapabilities = asRecord(storedVerdict?.capabilities);
  const eventCapabilities = asRecord(eventVerdict?.capabilities);
  const providerUsed = readString(storedVerdict?.providerUsed);
  const evidenceClass = readString(storedVerdict?.evidenceClass);
  const capabilityKeys = [
    "canVerdict",
    "canWriteMistakeMemory",
    "canWriteEpisode",
    "canSignalPlanner",
    "canUseFailureSalience",
  ] as const;

  return Boolean(
    storedVerdict &&
      eventVerdict &&
      readString(storedVerdict.status) === status &&
      readString(eventVerdict.status) === status &&
      providerUsed &&
      providerUsed !== "mock" &&
      (evidenceClass === "verdict_bearing" || evidenceClass === "local_only") &&
      readString(eventVerdict.providerUsed) === providerUsed &&
      readString(eventVerdict.evidenceClass) === evidenceClass &&
      capabilityKeys.every(
        (key) =>
          typeof storedCapabilities?.[key] === "boolean" &&
          storedCapabilities[key] === eventCapabilities?.[key],
      ) &&
      storedCapabilities?.[capability] === true,
  );
}

function isExplicitLearnerConfusionEvidence(
  event: EligibilityEvidence,
  mechanism: string,
) {
  if (
    event.eventType !== "chat_user_message" &&
    event.eventType !== "mock_interview_turn"
  ) {
    return false;
  }
  const payload = parseJsonRecord(event.eventJson);
  const role = readString(payload.role);
  if (role === "assistant" || role === "interviewer") return false;
  const content = event.content ?? "";
  return Boolean(
    event.problemId &&
      /(?:不懂|不明白|没明白|仍不清楚|还是不会|还是卡住|搞不清|困惑|confus|don'?t understand|do not understand|still (?:don'?t|do not) understand|still (?:not )?clear)/i.test(
        content,
      ) &&
      mechanismAppearsInLearnerText(content, mechanism),
  );
}

function mechanismAppearsInLearnerText(
  content: string,
  candidateMechanism: string | undefined,
) {
  const mechanism = normalizeMemoryTag(candidateMechanism ?? "");
  if (!mechanism) return false;
  const normalizedContent = normalizeMemoryTag(content);
  const aliases: Record<string, RegExp> = {
    binary_search: /(?:binary[\s_-]*search|二分|off[\s_-]*by[\s_-]*one|\bboundar(?:y|ies)\b|边界|邊界)/i,
    dynamic_programming: /(?:dynamic[\s_-]*programming|\bdp\b|动态规划|動態規劃|状态转移|狀態轉移)/i,
    state_transition_reasoning: /(?:state[\s_-]*transition|状态转移|狀態轉移|转移规则|轉移規則)/i,
  };
  if (
    Object.entries(aliases).some(
      ([topic, pattern]) =>
        (mechanism === topic || mechanism.startsWith(`${topic}_`)) &&
        pattern.test(content),
    )
  ) {
    return true;
  }
  const meaningfulTokens = mechanism
    .split("_")
    .filter(
      (token) =>
        token.length >= 4 &&
        !["reasoning", "approach", "pattern", "confusion", "skill"].includes(
          token,
        ),
    );
  return meaningfulTokens.some((token) => normalizedContent.includes(token));
}

async function hasCoachRunCodeLineage(
  prisma: EligibilityPrisma,
  event: EligibilityEvidence,
) {
  if (COACH_RUN_STORAGE_SOURCES.has(event.source ?? "")) return true;
  const payload = parseJsonRecord(event.eventJson);
  if (payloadContainsCoachRunLineage(payload)) return true;

  if (event.eventType === "chat_user_message" && event.chatSessionId) {
    const previousReply = await prisma.l1MemoryEvent.findFirst({
      where: {
        chatSessionId: event.chatSessionId,
        eventType: "chat_reply",
        occurredAt: { lt: event.occurredAt },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    });
    if (
      previousReply &&
      payloadContainsCoachRunLineage(parseJsonRecord(previousReply.eventJson))
    ) {
      return true;
    }
  }

  if (event.eventType === "memory_note" && event.chatSessionId) {
    const currentTurnStart = await prisma.l1MemoryEvent.findFirst({
      where: {
        chatSessionId: event.chatSessionId,
        eventType: "chat_user_message",
        occurredAt: { lte: event.occurredAt },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    });
    if (currentTurnStart) {
      const sameTurnRun = await prisma.runEvidence.findFirst({
        where: {
          chatSessionId: event.chatSessionId,
          source: {
            in: ["chat_current_tool", "chat_candidate_tool", "chat_tool"],
          },
          createdAt: {
            gte: currentTurnStart.occurredAt,
            lte: event.occurredAt,
          },
        },
      });
      if (sameTurnRun) return true;
    }
  }

  return false;
}

function payloadContainsCoachRunLineage(payload: Record<string, unknown>) {
  const evidenceBoundary = asRecord(payload.evidenceBoundary);
  if (evidenceBoundary?.containsAdvisoryRunObservations === true) return true;

  let containsRunSource = false;
  let containsRunObservation = false;
  visit(payload, (key, value) => {
    if (
      (key === "storageSource" || key === "source") &&
      typeof value === "string" &&
      COACH_RUN_STORAGE_SOURCES.has(value)
    ) {
      containsRunSource = true;
    }
    if (
      key === "observationKind" &&
      typeof value === "string" &&
      value.startsWith("run_code_")
    ) {
      containsRunObservation = true;
    }
  });
  return containsRunObservation || containsRunSource;
}

function buildEvidenceClusters(args: {
  userId: string;
  evidence: EligibilityEvidence[];
  mechanism: string;
  transition: FactCandidate["evidenceKind"];
}) {
  const reviewRevision = new Map<string, string>();
  for (const event of args.evidence) {
    if (!event.reviewAttemptId) continue;
    const revision = readRevisionKey(parseJsonRecord(event.eventJson));
    if (revision) reviewRevision.set(event.reviewAttemptId, revision);
  }

  const clusters = new Map<string, DurableEvidenceCluster>();
  for (const event of args.evidence) {
    const payload = parseJsonRecord(event.eventJson);
    const revisionKey =
      readRevisionKey(payload) ??
      (event.reviewAttemptId
        ? reviewRevision.get(event.reviewAttemptId)
        : undefined) ??
      event.traceRunId ??
      readString(payload.sessionId) ??
      readString(payload.chatMessageId) ??
      event.reviewAttemptId ??
      event.id;
    const problemId = event.problemId ?? null;
    const key = createHash("sha256")
      .update(
        [
          event.memoryOrigin,
          args.userId,
          problemId ?? "no_problem",
          revisionKey,
          args.mechanism,
          args.transition,
        ].join("|"),
      )
      .digest("hex");
    const existing = clusters.get(key);
    clusters.set(key, {
      key,
      problemId,
      reviewAttemptId: event.reviewAttemptId ?? null,
      revisionKey,
      transition: args.transition,
      evidenceTraceIds: existing
        ? [...new Set([...existing.evidenceTraceIds, event.id])]
        : [event.id],
    });
  }
  return [...clusters.values()];
}

function readRevisionKey(payload: Record<string, unknown>) {
  const workspace = asRecord(payload.workspace);
  return (
    // executionFingerprint intentionally precedes the raw code hash: it
    // collapses comment/whitespace-only edits into the same evidence cluster.
    readExecutionFingerprint(payload) ??
    readString(payload.repairKey) ??
    readString(payload.codeSnapshotId) ??
    readString(payload.executedCodeHash) ??
    readString(payload.currentCodeHash) ??
    readString(payload.codeHash) ??
    readString(workspace?.currentCodeHash) ??
    undefined
  );
}

function readExecutionFingerprint(payload: Record<string, unknown>) {
  const workspace = asRecord(payload.workspace);
  return (
    readString(payload.executionFingerprint) ??
    readString(workspace?.currentExecutionFingerprint)
  );
}

async function resolveMechanismForEverySourceProblem(
  prisma: EligibilityPrisma,
  rawTag: string,
  clusters: DurableEvidenceCluster[],
): Promise<CanonicalMechanismResolution> {
  const problemIds = [
    ...new Set(
      clusters.flatMap((cluster) =>
        cluster.problemId ? [cluster.problemId] : [],
      ),
    ),
  ];
  const problems = await prisma.problem.findMany({
    where: { id: { in: problemIds } },
    select: { id: true, tags: true },
  });
  if (problems.length !== problemIds.length) {
    return {
      decision: "drop",
      reason: "mechanism_not_supported_by_source_problem",
    };
  }

  const resolutions = problems.map((problem) =>
    resolveCanonicalMechanismSignal({
      rawTag,
      problemTags: parseStringArray(problem.tags),
    }),
  );
  const rejectedResolution = resolutions.find(
    (resolution) => resolution.decision !== "canonical",
  );
  if (rejectedResolution) return rejectedResolution;

  const canonical = resolutions.filter(
    (resolution): resolution is Extract<
      CanonicalMechanismResolution,
      { decision: "canonical" }
    > => resolution.decision === "canonical",
  );
  if (
    canonical.length === 0 ||
    new Set(canonical.map((resolution) => resolution.key)).size !== 1
  ) {
    return {
      decision: "drop",
      reason: "mechanism_not_supported_by_source_problem",
    };
  }
  return canonical[0]!;
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function visit(value: unknown, visitor: (key: string, value: unknown) => void) {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, visitor);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    visitor(key, child);
    visit(child, visitor);
  }
}

function parseJsonRecord(value: string) {
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function parseRecord(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  return parseJsonRecord(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

const DEVELOPMENT_NOISE_TEXT_PATTERNS = [
  /\b(?:no|missing|unimplemented)[\s_-]+search[\s_-]+logic\b/gi,
  /\bsearch[\s_-]+logic[\s_-]+(?:is[\s_-]+)?(?:missing|unimplemented|not[\s_-]+implemented)\b/gi,
  /\bhard[\s_-]*coded[\s_-]+(?:return|return[\s_-]+value|returns)\b/gi,
  /\breturn(?:[\s_-]+value)?[\s_-]+(?:is[\s_-]+)?hard[\s_-]*coded\b/gi,
  /\b(?:constant|fixed|placeholder|dummy)[\s_-]+returns?\b/gi,
  /\breturns?[\s_-]+(?:a[\s_-]+)?(?:constant|fixed|placeholder|dummy)(?:[\s_-]+value)?\b/gi,
  /\b(?:ignores?|does\s+not\s+use)\s+(?:the\s+)?input\b/gi,
  /(?:未|尚未|还未|還未|没有|沒有|没|沒)(?:实现|實現)[^，。；;]{0,8}(?:搜索逻辑|搜尋邏輯)/g,
  /(?:搜索逻辑|搜尋邏輯)[^，。；;]{0,8}(?:(?:尚|还|還)?未(?:实现|實現)|(?:没有|沒有|没|沒)(?:实现|實現))/g,
  /(?:搜索|搜尋|检索|檢索)(?:逻辑|邏輯|功能|部分)[^，。；;]{0,8}(?:(?:尚|还|還)?未(?:实现|實現|完成|写|寫)|(?:没有|沒有|没|沒)(?:实现|實現|完成|做|写|寫)|(?:还|還)?没(?:有)?(?:做|写|寫)|缺失)/g,
  /(?:(?:尚|还|還)?未(?:实现|實現|完成|写|寫)|(?:没有|沒有|没|沒)(?:实现|實現|完成|做|写|寫)|(?:还|還)?没(?:有)?(?:做|写|寫))[^，。；;]{0,8}(?:搜索|搜尋|检索|檢索)(?:逻辑|邏輯|功能|部分)/g,
  /(?:返回值?|回傳值?)[^，。；;]{0,8}(?:写死|寫死|硬编码|硬編碼)/g,
  /(?:写死|寫死|硬编码|硬編碼)[^，。；;]{0,8}(?:返回值?|回傳值?)/g,
  /(?:返回值?|回傳值?)[^，。；;]{0,8}(?:固定值?|常量|占位值?|佔位值?)/g,
  /(?:直接)?(?:返回|回傳)[^，。；;]{0,8}(?:固定值?|常量|占位值?|佔位值?)/g,
  /(?:答案|结果|結果)[^，。；;]{0,8}(?:写死|寫死|硬编码|硬編碼)/g,
] as const;
