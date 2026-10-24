import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import type { TraceContext } from "@/server/llm/trace-context";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";

export const OPERATIONAL_CONTRACT_VERSION = "chat-tools-v1";
export const OPERATIONAL_NOTE_KIND = "tool_non_verdict";
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVIDENCE_IDS = 20;
const MAX_INJECTED_NOTES = 2;
const MAX_INJECTED_CHARS = 240;
const MIN_SUPPORT = 5;
const MIN_DISTINCT_PROBLEMS = 2;
const MIN_DISTINCT_SESSIONS = 2;
const COUNTER_INVALIDATE_THRESHOLD = 3;

export type OperationalPrecondition = {
  selectedSuiteHasVisibleTests: boolean;
  executionInputMode: "selected_suite" | "caller_tests" | "raw_input";
  executorProviderFamily: "leetcode" | "piston" | "mock";
};

export type OperationalNotePrompt = {
  toolName: "run_current_code" | "verify_proposed_repair";
  text: string;
};

export function normalizeProviderFamily(providerUsed: string | undefined) {
  if (providerUsed === "lc_run") return "leetcode" as const;
  if (["piston", "piston_fallback", "local_hot150", "remote_unavailable_local_fallback"].includes(providerUsed ?? "")) return "piston" as const;
  if (providerUsed === "mock") return "mock" as const;
  return undefined;
}

export function hashOperationalPrecondition(value: OperationalPrecondition) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function classifyOperationalOutcome(toolName: string, result: unknown) {
  if (toolName === "run_current_code") {
    const status = readExecutionStatus(result);
    return ["passed_visible_tests", "failed", "compile_error", "syntax_error", "runtime_error", "timeout"].includes(status ?? "")
      ? "useful" as const
      : "non_verdict" as const;
  }
  if (toolName === "verify_proposed_repair") {
    const value = asRecord(result);
    if (value?.repairValidated !== true) return "not_applicable" as const;
    return readCanVerdict(value) ? "useful" as const : "non_verdict" as const;
  }
  return "not_applicable" as const;
}

export function operationalPreconditionForResult(args: {
  toolName: string;
  toolArguments: unknown;
  result: unknown;
  selectedSuiteHasVisibleTests: boolean;
}): OperationalPrecondition | undefined {
  if (args.toolName !== "run_current_code" && args.toolName !== "verify_proposed_repair") return undefined;
  const provider = readProviderUsedFromToolResult(args.result);
  const executorProviderFamily = normalizeProviderFamily(provider);
  if (!executorProviderFamily) return undefined;
  const argumentsValue = asRecord(args.toolArguments);
  const executionInputMode = argumentsValue && (hasNonEmptyArray(argumentsValue.tests) || hasNonEmptyArray(argumentsValue.testCases))
    ? "caller_tests"
    : argumentsValue && ("input" in argumentsValue || "dataInput" in argumentsValue)
      ? "raw_input"
      : "selected_suite";
  return { selectedSuiteHasVisibleTests: args.selectedSuiteHasVisibleTests, executionInputMode, executorProviderFamily };
}

/** Current route configuration is only trusted when it maps to a known family. */
export function operationalPreconditionForRecall(args: {
  selectedSuiteHasVisibleTests: boolean;
  providerOverride?: string;
}): OperationalPrecondition | undefined {
  const configured = args.providerOverride?.trim().toLowerCase();
  const executorProviderFamily = configured
    ? configured === "leetcode" || configured === "lc" ? "leetcode"
      : configured === "piston" || configured === "local_hot150" ? "piston"
      : configured === "mock" ? "mock" : undefined
    : "piston"; // Chat's default local visible-test route.
  return executorProviderFamily
    ? { selectedSuiteHasVisibleTests: args.selectedSuiteHasVisibleTests, executionInputMode: "selected_suite", executorProviderFamily }
    : undefined;
}

export async function recallOperationalNotes(args: {
  prisma: PrismaClient;
  memoryOrigin: string;
  candidateTools: readonly string[];
  precondition?: OperationalPrecondition;
  traceContext: TraceContext;
}) : Promise<OperationalNotePrompt[]> {
  const names = args.candidateTools.filter(isOperationalTool);
  if (!args.precondition || names.length === 0) {
    await appendTraceEventBestEffort(args.traceContext, {
      stage: "operational_memory_recall",
      kind: "retrieval",
      title: "Operational note recall",
      status: "skipped",
      details: {
        metadata: {
          contractVersion: OPERATIONAL_CONTRACT_VERSION,
          candidateToolCount: names.length,
          recalledNoteCount: 0,
          reason: args.precondition ? "no_candidate_execution_tool" : "unknown_precondition",
        },
      },
    });
    return [];
  }
  const notes = await args.prisma.operationalNote.findMany({
    where: { memoryOrigin: args.memoryOrigin, kind: OPERATIONAL_NOTE_KIND, scopeKind: "tool", scopeKey: { in: names }, signalKey: "non_verdict", preconditionHash: hashOperationalPrecondition(args.precondition), contractVersion: OPERATIONAL_CONTRACT_VERSION, status: "validated", invalidAt: null },
    orderBy: [{ supportCount: "desc" }, { lastEvidenceAt: "desc" }],
    take: 2,
  });
  const result: OperationalNotePrompt[] = [];
  let chars = 0;
  for (const note of notes.slice(0, MAX_INJECTED_NOTES)) {
    const text = `${note.scopeKey}: this exact visible-test setup can be non-verdict; state that boundary and never infer official acceptance.`;
    if (chars + text.length > MAX_INJECTED_CHARS) break;
    result.push({ toolName: note.scopeKey as OperationalNotePrompt["toolName"], text });
    chars += text.length;
  }
  await appendTraceEventBestEffort(args.traceContext, { stage: "operational_memory_recall", kind: "retrieval", title: "Operational note recall", status: "succeeded", details: { metadata: { contractVersion: OPERATIONAL_CONTRACT_VERSION, candidateToolCount: names.length, recalledNoteCount: result.length } } });
  return result;
}

/** Rebuild rather than increment so retries and duplicate events cannot inflate confidence. */
export async function recomputeOperationalNotes(prisma: PrismaClient, now = new Date()) {
  const events = await prisma.agentTraceEvent.findMany({
    where: { kind: "tool", stage: "bounded_agent_loop", occurredAt: { gte: new Date(now.getTime() - LOOKBACK_MS) } },
    select: { eventId: true, occurredAt: true, metadataJson: true, workspaceSession: { select: { id: true, problemId: true } }, traceRun: { select: { memoryOrigin: true } } },
    orderBy: { occurredAt: "asc" },
  });
  const groups = new Map<string, { origin: string; tool: string; precondition: OperationalPrecondition; support: typeof events; counter: typeof events }>();
  for (const event of events) {
    const meta = parseMetadata(event.metadataJson);
    if (!event.workspaceSession || meta.eventRole !== "result" || meta.runtimeDisposition !== "executed" || meta.operationalContractVersion !== OPERATIONAL_CONTRACT_VERSION || !isOperationalTool(meta.toolName) || typeof meta.operationalPreconditionJson !== "string" || (meta.outcomeUtility !== "useful" && meta.outcomeUtility !== "non_verdict")) continue;
    const precondition = parsePrecondition(meta.operationalPreconditionJson);
    if (!precondition || precondition.executionInputMode !== "selected_suite" || !precondition.selectedSuiteHasVisibleTests) continue;
    const origin = event.traceRun.memoryOrigin;
    const key = [origin, meta.toolName, hashOperationalPrecondition(precondition)].join("|");
    const group = groups.get(key) ?? { origin, tool: meta.toolName, precondition, support: [], counter: [] };
    (meta.outcomeUtility === "non_verdict" ? group.support : group.counter).push(event);
    groups.set(key, group);
  }
  const invalidated = new Set((await prisma.operationalNote.findMany({
    where: { kind: OPERATIONAL_NOTE_KIND, contractVersion: OPERATIONAL_CONTRACT_VERSION, invalidAt: { not: null } },
    select: { memoryOrigin: true, scopeKey: true, preconditionHash: true },
  })).map((note) => [note.memoryOrigin, note.scopeKey, note.preconditionHash].join("|")));
  for (const group of groups.values()) {
    const supportProblems = new Set(group.support.map((event) => event.workspaceSession!.problemId));
    const supportSessions = new Set(group.support.map((event) => event.workspaceSession!.id));
    const preconditionHash = hashOperationalPrecondition(group.precondition);
    if (invalidated.has([group.origin, group.tool, preconditionHash].join("|"))) continue;
    const counterCount = group.counter.length;
    const status = counterCount >= COUNTER_INVALIDATE_THRESHOLD ? "invalidated" : group.support.length >= MIN_SUPPORT && supportProblems.size >= MIN_DISTINCT_PROBLEMS && supportSessions.size >= MIN_DISTINCT_SESSIONS ? "validated" : "candidate";
    const lastEvidenceAt = group.support.at(-1)?.occurredAt ?? now;
    await prisma.operationalNote.upsert({
      where: { memoryOrigin_kind_scopeKind_scopeKey_signalKey_preconditionHash_contractVersion: { memoryOrigin: group.origin, kind: OPERATIONAL_NOTE_KIND, scopeKind: "tool", scopeKey: group.tool, signalKey: "non_verdict", preconditionHash, contractVersion: OPERATIONAL_CONTRACT_VERSION } },
      create: { memoryOrigin: group.origin, kind: OPERATIONAL_NOTE_KIND, scopeKind: "tool", scopeKey: group.tool, signalKey: "non_verdict", preconditionJson: JSON.stringify(group.precondition), preconditionHash, contractVersion: OPERATIONAL_CONTRACT_VERSION, status, supportCount: group.support.length, counterCount, distinctProblemCount: supportProblems.size, distinctSessionCount: supportSessions.size, evidenceEventIdsJson: JSON.stringify(group.support.slice(-MAX_EVIDENCE_IDS).map((event) => event.eventId)), validatedAt: status === "validated" ? now : null, invalidAt: status === "invalidated" ? now : null, lastEvidenceAt },
      update: { status, supportCount: group.support.length, counterCount, distinctProblemCount: supportProblems.size, distinctSessionCount: supportSessions.size, evidenceEventIdsJson: JSON.stringify(group.support.slice(-MAX_EVIDENCE_IDS).map((event) => event.eventId)), validatedAt: status === "validated" ? now : null, invalidAt: status === "invalidated" ? now : null, lastEvidenceAt },
    });
  }
  await prisma.operationalNote.updateMany({ where: { kind: OPERATIONAL_NOTE_KIND, contractVersion: OPERATIONAL_CONTRACT_VERSION, status: "candidate", invalidAt: null, lastEvidenceAt: { lt: new Date(now.getTime() - STALE_MS) } }, data: { status: "invalidated", invalidAt: now } });
}

function readExecutionStatus(result: unknown) { const value = asRecord(result); const run = asRecord(value?.result); return typeof run?.status === "string" ? run.status : typeof value?.status === "string" ? value.status : undefined; }
function readCanVerdict(value: Record<string, unknown>) { const verdict = asRecord(value.evidenceVerdict); const capabilities = asRecord(verdict?.capabilities); return capabilities?.canVerdict === true; }
function readProviderUsedFromToolResult(result: unknown) { const value = asRecord(result); const run = asRecord(value?.result); return run ? readProviderUsed(run as Parameters<typeof readProviderUsed>[0]) : undefined; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function hasNonEmptyArray(value: unknown) { return Array.isArray(value) && value.length > 0; }
function isOperationalTool(value: unknown): value is "run_current_code" | "verify_proposed_repair" { return value === "run_current_code" || value === "verify_proposed_repair"; }
function parseMetadata(value: string | null) { try { return asRecord(value ? JSON.parse(value) : {}) ?? {}; } catch { return {}; } }
function parsePrecondition(value: string): OperationalPrecondition | undefined { try { const parsed = asRecord(JSON.parse(value)); return parsed && typeof parsed.selectedSuiteHasVisibleTests === "boolean" && (parsed.executionInputMode === "selected_suite" || parsed.executionInputMode === "caller_tests" || parsed.executionInputMode === "raw_input") && (parsed.executorProviderFamily === "leetcode" || parsed.executorProviderFamily === "piston" || parsed.executorProviderFamily === "mock") ? parsed as OperationalPrecondition : undefined; } catch { return undefined; } }
