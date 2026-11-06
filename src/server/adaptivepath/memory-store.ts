/**
 * Persistence for Biology L1/L2/L3 (spec §10). One attempt is written in one
 * transaction: L1 event → ledger rows → judgments → new L3 profile version.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { BIOLOGY_SECTION_ID, CONCEPTS } from "@/features/adaptivepath/concepts";
import { applyAttempt, replayLearner } from "@/features/adaptivepath/memory/mastery-engine";
import { buildProfileCard, PROFILE_NOTE_PENDING, type ProfileCard } from "@/features/adaptivepath/memory/profile-card";
import type { TutorEvidence } from "@/features/adaptivepath/memory/tutor-context";
import type { AttemptEvidence, JudgmentState, LedgerRow, MasteryContext } from "@/features/adaptivepath/memory/types";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import { ACTIVE_RULE_VERSION,getRuleset } from "@/features/adaptivepath/memory/rules";
import { QUESTION_LOOKUP } from "@/features/adaptivepath/question-bank";
import {
  ATTEMPT_EVENT_TYPE, ATTEMPT_SCHEMA_VERSION, ATTEMPT_SOURCE, BIOLOGY_DOMAIN, attemptFields,
  parseProfileCard, toJudgmentState, toLedgerRow, toTutorEvidence, type StoredLedgerRow,
} from "./memory-records";

type Tx = Prisma.TransactionClient;
export type LearnerScope = Readonly<{ userId: string; problemId: string; chatSessionId: string; memoryOrigin: MemoryOrigin }>;
type OwnerScope = Pick<LearnerScope, "userId" | "memoryOrigin">;
export type AttemptInput = Omit<AttemptEvidence, "l1EventId"> & Readonly<{ explanation: string }>;
export type LatestProfile = Readonly<{ version: number; card: ProfileCard; noteStatus: string; noteText: string | null }>;
export type LearnerMemory = Readonly<{
  states: ReadonlyMap<string, JudgmentState>;
  rows: readonly StoredLedgerRow[];
  attempts: readonly TutorEvidence[];
  latestProfile: LatestProfile | null;
}>;

const owner = (scope: OwnerScope) => ({ userId: scope.userId, memoryOrigin: scope.memoryOrigin });
const section = (scope: OwnerScope) => ({ ...owner(scope), sectionId: BIOLOGY_SECTION_ID });

async function loadAttempts(db: Tx | PrismaClient, scope: OwnerScope): Promise<TutorEvidence[]> {
  const events = await db.l1MemoryEvent.findMany({ where: { ...owner(scope), eventType: ATTEMPT_EVENT_TYPE }, orderBy: { occurredAt: "asc" } });
  return events.map(toTutorEvidence);
}

async function loadStates(db: Tx | PrismaClient, scope: OwnerScope): Promise<Map<string, JudgmentState>> {
  const rows = await db.biologyMasteryJudgment.findMany({ where: section(scope) });
  return new Map(rows.map((r) => [r.conceptId, toJudgmentState(r)]));
}

async function loadRows(db: Tx | PrismaClient, scope: OwnerScope): Promise<StoredLedgerRow[]> {
  const rows = await db.biologyMasteryLedgerRow.findMany({ where: section(scope), orderBy: [{ occurredAt: "asc" }, { sequence: "asc" }] });
  return rows.map(toLedgerRow);
}

async function latestProfile(db: Tx | PrismaClient, scope: OwnerScope): Promise<LatestProfile | null> {
  const row = await db.biologyLearnerProfile.findFirst({ where: section(scope), orderBy: { version: "desc" } });
  return row && { version: row.version, card: parseProfileCard(row.cardJson), noteStatus: row.noteStatus, noteText: row.noteText };
}

async function writeL1(tx: Tx, scope: LearnerScope, attempt: AttemptInput): Promise<string> {
  const event = await tx.l1MemoryEvent.create({
    data: {
      userId: scope.userId, problemId: scope.problemId, chatSessionId: scope.chatSessionId, memoryOrigin: scope.memoryOrigin,
      eventType: ATTEMPT_EVENT_TYPE, source: ATTEMPT_SOURCE, content: attempt.explanation, occurredAt: new Date(attempt.submittedAt),
      eventJson: JSON.stringify({ domain: BIOLOGY_DOMAIN, schemaVersion: ATTEMPT_SCHEMA_VERSION, ...attemptFields(attempt) }),
    },
  });
  return event.id;
}

async function writeRows(tx: Tx, scope: OwnerScope, input: { rows: readonly LedgerRow[]; occurredAt: Date }) {
  for (const row of input.rows) {
    const where = { ...section(scope), conceptId: row.conceptId };
    const last = await tx.biologyMasteryLedgerRow.aggregate({ where, _max: { sequence: true } });
    await tx.biologyMasteryLedgerRow.create({
      data: { ...where, ...row, sequence: (last._max.sequence ?? 0) + 1, occurredAt: input.occurredAt },
    });
  }
}

async function writeStates(tx: Tx, scope: OwnerScope, states: ReadonlyMap<string, JudgmentState>) {
  for (const state of states.values()) {
    const key = { ...section(scope), conceptId: state.conceptId };
    const values = { level: state.level, stability: state.stability, supportStreak: state.supportStreak, ruleVersion: state.ruleVersion };
    await tx.biologyMasteryJudgment.upsert({
      where: { userId_sectionId_conceptId_memoryOrigin: key },
      create: { ...key, ...values },
      update: values,
    });
  }
}

async function writeProfile(tx: Tx, scope: OwnerScope, ctx: MasteryContext): Promise<number> {
  const [states, rows, prior] = await Promise.all([loadStates(tx, scope), loadRows(tx, scope), latestProfile(tx, scope)]);
  const card = buildProfileCard({ states, rows, concepts: CONCEPTS, rules: ctx.rules });
  const version = (prior?.version ?? 0) + 1;
  await tx.biologyLearnerProfile.create({
    data: { ...section(scope), version, cardJson: JSON.stringify(card), noteStatus: PROFILE_NOTE_PENDING, ruleVersion: ctx.rules.version },
  });
  return version;
}

/** Seed the real L3 baseline without pretending the student's survey is mastery. */
export async function ensureInitialLearnerProfile(db:PrismaClient,scope:OwnerScope):Promise<number>{
  return db.$transaction(async tx=>{
    const prior=await latestProfile(tx,scope);
    if(prior)return prior.version;
    return writeProfile(tx,scope,{
      rules:getRuleset(ACTIVE_RULE_VERSION),lookup:QUESTION_LOOKUP,
    });
  });
}
export async function recordAttempt(
  db: PrismaClient,
  input: { scope: LearnerScope; attempt: AttemptInput; ctx: MasteryContext },
): Promise<{ l1EventId: string; rows: readonly LedgerRow[]; profileVersion: number; duplicate: boolean }> {
  const { scope, attempt, ctx } = input;
  return db.$transaction(async (tx) => {
    const prior = await loadAttempts(tx, scope);
    const existing = prior.find((a) => a.attemptId === attempt.attemptId);
    if (existing) {
      return { l1EventId: existing.l1EventId, rows: [], profileVersion: (await latestProfile(tx, scope))?.version ?? 0, duplicate: true };
    }
    // A question is answered once; a concurrent second submit must not count twice.
    if (prior.some((a) => a.questionId === attempt.questionId)) throw new Error("This is not the current activity");
    const l1EventId = await writeL1(tx, scope, attempt);
    const applied = applyAttempt(await loadStates(tx, scope), { ...attemptFields(attempt), l1EventId }, ctx);
    await writeRows(tx, scope, { rows: applied.rows, occurredAt: new Date(attempt.submittedAt) });
    await writeStates(tx, scope, applied.states);
    const profileVersion = await writeProfile(tx, scope, ctx);
    return { l1EventId, rows: applied.rows, profileVersion, duplicate: false };
  });
}

export async function loadLearnerMemory(db: PrismaClient, scope: OwnerScope): Promise<LearnerMemory> {
  const [states, rows, attempts, profile] = await Promise.all([
    loadStates(db, scope), loadRows(db, scope), loadAttempts(db, scope), latestProfile(db, scope),
  ]);
  return { states, rows, attempts, latestProfile: profile };
}

/** Rebuilds every judgment and ledger row from L1 under `ctx.rules`. */
export async function replayLearnerMemory(
  db: PrismaClient,
  input: { scope: OwnerScope; ctx: MasteryContext },
): Promise<{ rowCount: number }> {
  const { scope, ctx } = input;
  return db.$transaction(async (tx) => {
    const attempts = await loadAttempts(tx, scope);
    const replayed = replayLearner(attempts, ctx);
    await tx.biologyMasteryLedgerRow.deleteMany({ where: section(scope) });
    await tx.biologyMasteryJudgment.deleteMany({ where: section(scope) });
    const occurredAt = new Map(attempts.map((a) => [a.l1EventId, new Date(a.submittedAt)]));
    for (const row of replayed.rows) {
      await writeRows(tx, scope, { rows: [row], occurredAt: occurredAt.get(row.l1EventId)! });
    }
    await writeStates(tx, scope, replayed.states);
    await writeProfile(tx, scope, ctx);
    return { rowCount: replayed.rows.length };
  });
}
