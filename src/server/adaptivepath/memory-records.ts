/**
 * Boundary mapping between persisted rows and the pure memory domain.
 * Persisted JSON is external input: it is validated, never trusted.
 */
import { z } from "zod";
import type { BiologyMasteryJudgment, BiologyMasteryLedgerRow, L1MemoryEvent } from "@prisma/client";
import type { ProfileCard } from "@/features/adaptivepath/memory/profile-card";
import type { TutorEvidence } from "@/features/adaptivepath/memory/tutor-context";
import type { AttemptEvidence, JudgmentState, LedgerRow, MasteryLevel } from "@/features/adaptivepath/memory/types";

export const BIOLOGY_DOMAIN = "adaptivepath:biology:12.2";
export const ATTEMPT_EVENT_TYPE = "biology_attempt";
export const ATTEMPT_SCHEMA_VERSION = 1;
export const ATTEMPT_SOURCE = "adaptivepath_biology";

const condition = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const level = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const attemptEventSchema = z.object({
  domain: z.literal(BIOLOGY_DOMAIN),
  schemaVersion: z.literal(ATTEMPT_SCHEMA_VERSION),
  attemptId: z.string().min(1),
  questionId: z.string().min(1),
  questionType: z.enum(["single_concept", "integrated"]),
  conceptIds: z.array(z.string()),
  difficulty: z.enum(["easy", "medium", "hard"]),
  selectedOption: z.string(),
  correct: z.boolean(),
  tutorUsed: z.boolean(),
  referenceUsed: z.boolean(),
  condition,
  submittedAt: z.string(),
});
export type AttemptEventJson = z.infer<typeof attemptEventSchema>;

const cardSchema = z.object({
  sectionId: z.string(),
  basedOnRuleVersion: z.string(),
  concepts: z.array(z.object({ conceptId: z.string(), level: level.nullable(), stability: z.number().nullable(), evidenceCount: z.number() })),
  levelDistribution: z.object({ unassessed: z.number(), level0: z.number(), level1: z.number(), level2: z.number(), level3: z.number() }),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  prerequisiteGaps: z.array(z.object({ conceptId: z.string(), prerequisiteId: z.string() })),
});

/** The L1 fields shared by the persisted event JSON and the domain evidence. */
export function attemptFields(source: Omit<AttemptEvidence, "l1EventId">): Omit<AttemptEvidence, "l1EventId"> {
  return {
    attemptId: source.attemptId,
    questionId: source.questionId,
    questionType: source.questionType,
    conceptIds: source.conceptIds,
    difficulty: source.difficulty,
    selectedOption: source.selectedOption,
    correct: source.correct,
    tutorUsed: source.tutorUsed,
    referenceUsed: source.referenceUsed,
    condition: source.condition,
    submittedAt: source.submittedAt,
  };
}

export function toTutorEvidence(event: L1MemoryEvent): TutorEvidence {
  const payload = attemptEventSchema.parse(JSON.parse(event.eventJson));
  if (event.content === null) throw new Error(`biology_attempt ${event.id} has no explanation content`);
  return { ...attemptFields(payload), l1EventId: event.id, explanation: event.content };
}

export function toJudgmentState(row: BiologyMasteryJudgment): JudgmentState {
  return {
    conceptId: row.conceptId,
    level: level.parse(row.level),
    stability: row.stability,
    supportStreak: row.supportStreak,
    ruleVersion: row.ruleVersion,
  };
}

export type StoredLedgerRow = LedgerRow & Readonly<{ occurredAt: string }>;

export function toLedgerRow(row: BiologyMasteryLedgerRow): StoredLedgerRow {
  return {
    conceptId: row.conceptId,
    l1EventId: row.l1EventId,
    condition: condition.parse(row.condition),
    result: z.enum(["S", "F"]).parse(row.result),
    effect: z.enum(["first", "support", "counter_down", "counter_up", "neutral", "ineligible"]).parse(row.effect),
    reason: row.reason,
    levelBefore: row.levelBefore === null ? null : (level.parse(row.levelBefore) as MasteryLevel),
    levelAfter: row.levelAfter === null ? null : (level.parse(row.levelAfter) as MasteryLevel),
    stabilityBefore: row.stabilityBefore,
    stabilityAfter: row.stabilityAfter,
    ruleVersion: row.ruleVersion,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function parseProfileCard(json: string): ProfileCard {
  return cardSchema.parse(JSON.parse(json));
}
