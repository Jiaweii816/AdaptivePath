import type { PrismaClient } from "@prisma/client";
import prisma from "@/server/db/prisma";
import { attachCodeRunErrorDetail } from "@/lib/code-run-error-detail";
import {
  classifyExecutionEvidence,
  readEvidenceVerdict,
} from "@/lib/evidence-trust";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";
import { hashSelectedTestSuite } from "@/server/code/code-hash";
import {
  pickBestAlignedEvidence,
  type CurrentEvidenceScope,
  type EvidenceAlignment,
} from "./evidence-alignment";
import {
  codeRunResultSchema,
  type CodeRunResult,
} from "@/types/code-runner";
import type {
  CoachRunEvidenceView,
  EvidenceOracle,
  InternalRunEvidenceEnvelope,
} from "./coach-agent.types";

type AuthoritativeRunDb = Pick<
  PrismaClient,
  "chatSession" | "practiceRunLog" | "runEvidence"
>;

const EVIDENCE_SCAN_LIMIT = 20;

export async function resolveAuthoritativeRunContext(
  args: { chatSessionId: string; currentScope?: CurrentEvidenceScope },
  db: AuthoritativeRunDb = prisma,
): Promise<InternalRunEvidenceEnvelope | undefined> {
  const chatSession = await db.chatSession.findUnique({
    where: { id: args.chatSessionId },
    select: { userId: true, problemId: true, memoryOrigin: true },
  });

  if (!chatSession) {
    return undefined;
  }

  const [practiceRuns, reviewRuns] = await Promise.all([
    db.practiceRunLog.findMany({
      where: {
        userId: chatSession.userId,
        problemId: chatSession.problemId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: EVIDENCE_SCAN_LIMIT,
    }),
    db.runEvidence.findMany({
      where: {
        source: "review",
        memoryOrigin: chatSession.memoryOrigin,
        reviewAttempt: {
          is: {
            userId: chatSession.userId,
            problemId: chatSession.problemId,
            memoryOrigin: chatSession.memoryOrigin,
          },
        },
      },
      include: {
        reviewAttempt: {
          select: {
            id: true,
            selectedTestCaseIds: true,
            selectedTestsJson: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: EVIDENCE_SCAN_LIMIT,
    }),
  ]);

  const candidates = [
    ...practiceRuns.map((row) => envelopeFromPracticeRun(row)),
    ...reviewRuns.map((row) => envelopeFromReviewRun(row)),
  ]
    .filter((value): value is InternalRunEvidenceEnvelope => Boolean(value))
    .sort(compareEvidenceRecency);

  return args.currentScope
    ? pickBestAlignedEvidence(candidates, args.currentScope).evidence
    : candidates[0];
}

export async function resolveWorkingRunContext(
  args: { chatSessionId: string; currentScope: CurrentEvidenceScope },
  db: Pick<PrismaClient, "chatSession" | "runEvidence"> = prisma,
): Promise<{ evidence?: InternalRunEvidenceEnvelope; alignment: EvidenceAlignment }> {
  const chatSession = await db.chatSession.findUnique({
    where: { id: args.chatSessionId },
    select: { clearedBeforeSequence: true, clearedAt: true },
  });
  if (!chatSession) return { alignment: "none" };

  const rows = await db.runEvidence.findMany({
    where: { chatSessionId: args.chatSessionId, source: "chat_current_tool" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: EVIDENCE_SCAN_LIMIT,
  });
  return pickBestAlignedEvidence(
    rows
      .filter((row) => isVisibleWorkingRun(row, chatSession))
      .map((row) => envelopeFromChatToolRun(row)),
    args.currentScope,
  );
}

/**
 * The only supported LLM projection for run evidence. Keep this positive list
 * deliberately small so future DB/runner metadata cannot leak by default.
 */
export function toCoachRunEvidenceView(
  evidence: InternalRunEvidenceEnvelope,
): CoachRunEvidenceView {
  const result = evidence.result;
  const errorDetail = result.errorDetail
    ? {
        kind: result.errorDetail.kind,
        title: result.errorDetail.title,
        summary: result.errorDetail.summary,
        likelyCauses: result.errorDetail.likelyCauses,
        nextStep: result.errorDetail.nextStep,
      }
    : undefined;

  return {
    source: modelSource(evidence),
    producer: evidence.producer,
    subject: evidence.subject,
    authority: evidence.authority,
    scope: evidence.scope,
    oracle: evidence.oracle,
    createdAt: evidence.createdAt,
    status: result.status,
    passedCount: result.passedCount,
    failedCount: result.failedCount,
    totalCount: evidence.scope.totalCount,
    durationMs: result.durationMs,
    failureProvenance: result.failureProvenance,
    firstFailedCase: result.firstFailedCase
      ? {
          id: result.firstFailedCase.id,
          label:
            compactModelText(result.firstFailedCase.label, 160) ??
            "failed case",
          actualOutput: compactModelValue(result.firstFailedCase.actual),
          expectedOutput: compactModelValue(result.firstFailedCase.expected),
          errorSummary: compactModelText(result.firstFailedCase.error, 400),
          errorLocation: result.firstFailedCase.errorLocation,
        }
      : undefined,
    errorLocation: result.errorLocation,
    errorDetail,
    evidenceVerdict: evidence.evidenceVerdict,
    candidateDescription: evidence.candidateDescription,
  };
}

function envelopeFromPracticeRun(
  row: Awaited<
    ReturnType<AuthoritativeRunDb["practiceRunLog"]["findFirst"]>
  >,
): InternalRunEvidenceEnvelope | undefined {
  if (!row) {
    return undefined;
  }

  const parsed = parseStoredCodeRunResult(row.rawResultJson);
  const result = parsed ?? unreadablePracticeRunResult();

  return {
    id: row.id,
    storageSource: "practice_run",
    producer: "user_action",
    subject: "current_user_code",
    authority: "authoritative",
    scope: { kind: "selected_suite", totalCount: row.totalCount },
    oracle: oracleForResult(result, "stored_expected"),
    createdAt: row.createdAt.toISOString(),
    codeHash: parsed ? row.codeHash : null,
    executionFingerprint: parsed ? row.executionFingerprint : null,
    suiteFingerprint: hashSelectedTestSuite(
      parseJsonArray(row.selectedTestCaseIds).filter(
        (value): value is string => typeof value === "string",
      ),
    ),
    result,
    evidenceVerdict: evidenceVerdictForResult(result, "practice_run"),
  };
}

function unreadablePracticeRunResult(): CodeRunResult {
  return attachCodeRunErrorDetail({
    status: "runner_error",
    failureProvenance: "unknown",
    passedCount: 0,
    failedCount: 0,
    stdout: "",
    stderr: "Stored practice-run evidence could not be parsed.",
    testResults: [],
  });
}

function envelopeFromReviewRun(
  row: NonNullable<
    Awaited<ReturnType<AuthoritativeRunDb["runEvidence"]["findFirst"]>>
  > & {
    reviewAttempt: {
      id: string;
      selectedTestCaseIds: string;
      selectedTestsJson: string;
    } | null;
  },
): InternalRunEvidenceEnvelope {
  const parsed = parseStoredCodeRunResult(row.rawResultJson);
  const result = parsed ?? resultFromReviewColumns(row);
  const selectedTests = parseJsonArray(row.reviewAttempt?.selectedTestsJson);
  const selectedIds = parseJsonArray(row.reviewAttempt?.selectedTestCaseIds);
  const totalCount = Math.max(
    selectedTests.length,
    selectedIds.length,
    result.testResults.length,
    result.passedCount + result.failedCount,
  );

  return {
    id: row.id,
    storageSource: "review",
    producer: "user_action",
    subject: "current_user_code",
    authority: "authoritative",
    scope: { kind: "selected_suite", totalCount },
    oracle: oracleForResult(result, "stored_expected"),
    createdAt: row.createdAt.toISOString(),
    codeHash: row.codeHash,
    executionFingerprint: row.executionFingerprint,
    suiteFingerprint: hashSelectedTestSuite(
      selectedIds.filter((value): value is string => typeof value === "string"),
    ),
    result,
    evidenceVerdict: evidenceVerdictForResult(result, "review"),
    reviewAttemptId: row.reviewAttemptId,
  };
}

function envelopeFromChatToolRun(row: {
  id: string;
  codeHash: string | null;
  executionFingerprint: string | null;
  createdAt: Date;
  rawResultJson: string;
}): InternalRunEvidenceEnvelope {
  const parsed = parseStoredCodeRunResult(row.rawResultJson);
  const result = parsed ?? unreadablePracticeRunResult();
  const chatRunContext = readChatRunContext(row.rawResultJson);
  return {
    id: row.id,
    storageSource: "chat_current_tool",
    producer: "assistant_tool",
    subject: "current_user_code",
    authority: "advisory",
    scope: {
      kind: "selected_suite",
      totalCount: result.passedCount + result.failedCount,
    },
    oracle: oracleForResult(result, "stored_expected"),
    createdAt: row.createdAt.toISOString(),
    codeHash: row.codeHash,
    executionFingerprint: row.executionFingerprint,
    suiteFingerprint:
      typeof chatRunContext.suiteFingerprint === "string"
        ? chatRunContext.suiteFingerprint
        : null,
    result,
    evidenceVerdict: evidenceVerdictForResult(result, "practice_run"),
  };
}

function isVisibleWorkingRun(
  row: { createdAt: Date; rawResultJson: string },
  chatSession: { clearedBeforeSequence: number; clearedAt: Date | null },
) {
  if (chatSession.clearedBeforeSequence === 0) return true;

  const sequence = readChatRunMessageSequence(row.rawResultJson);
  if (sequence !== undefined) return sequence > chatSession.clearedBeforeSequence;

  return chatSession.clearedAt !== null && row.createdAt > chatSession.clearedAt;
}

function readChatRunMessageSequence(rawResultJson: string) {
  const value = readChatRunContext(rawResultJson).userMessageSequence;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function readChatRunContext(rawResultJson: string) {
  const raw = rawResultRecord(parseJson(rawResultJson));
  return rawResultRecord(rawResultRecord(raw.rawResult).chatRunContext);
}

function resultFromReviewColumns(row: {
  status: string;
  passedCount: number;
  failedCount: number;
  stdout: string | null;
  stderr: string | null;
  durationMs: number | null;
  actualOutput: string | null;
  expectedOutput: string | null;
  firstFailedCaseJson: string | null;
}): CodeRunResult {
  return attachCodeRunErrorDetail(
    codeRunResultSchema.parse({
      status: row.status,
      passedCount: row.passedCount,
      failedCount: row.failedCount,
      stdout: row.stdout ?? "",
      stderr: row.stderr ?? "",
      durationMs: row.durationMs ?? undefined,
      actualOutput: row.actualOutput ?? undefined,
      expectedOutput: row.expectedOutput ?? undefined,
      firstFailedCase: row.firstFailedCaseJson
        ? parseJson(row.firstFailedCaseJson)
        : undefined,
      testResults: [],
    }),
  );
}

function parseStoredCodeRunResult(value: string | null | undefined) {
  const parsed = codeRunResultSchema.safeParse(parseJson(value ?? ""));
  return parsed.success ? attachCodeRunErrorDetail(parsed.data) : undefined;
}

function evidenceVerdictForResult(
  result: CodeRunResult,
  source: "practice_run" | "review",
) {
  return (
    readEvidenceVerdict(rawResultRecord(result.rawResult).evidenceVerdict) ??
    classifyExecutionEvidence(result, {
      consumer: source === "review" ? "review" : "practice_run",
      providerUsed: readProviderUsed(result),
    })
  );
}

function oracleForResult(
  result: CodeRunResult,
  fallback: EvidenceOracle,
): EvidenceOracle {
  const provider = readProviderUsed(result)?.toLowerCase() ?? "";
  return provider.includes("leetcode") ? "runner" : fallback;
}

function modelSource(
  evidence: InternalRunEvidenceEnvelope,
): CoachRunEvidenceView["source"] {
  if (evidence.storageSource === "practice_run") {
    return "practice_run";
  }
  if (evidence.storageSource === "review") {
    return "review";
  }
  return "chat_tool";
}

function compareEvidenceRecency(
  left: InternalRunEvidenceEnvelope,
  right: InternalRunEvidenceEnvelope,
) {
  const timeDifference =
    Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  if (left.storageSource !== right.storageSource) {
    return left.storageSource === "review" ? -1 : 1;
  }
  return right.id.localeCompare(left.id);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  const parsed = value ? parseJson(value) : undefined;
  return Array.isArray(parsed) ? parsed : [];
}

function rawResultRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactModelValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "[unserializable value]";
  }
  return compactModelText(serialized, 500);
}

function compactModelText(
  value: string | undefined,
  limit: number,
): string | undefined {
  if (!value) {
    return undefined;
  }
  if (
    /\b(system|developer|assistant|tool)\s*:/i.test(value) ||
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i.test(value) ||
    /系统提示|开发者消息|忽略.*(之前|以上|系统|指令)/.test(value)
  ) {
    return "[untrusted content redacted]";
  }
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
