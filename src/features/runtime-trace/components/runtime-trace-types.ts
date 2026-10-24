/**
 * Pure view-model type declarations for the Runtime Trace drawer: the shapes
 * `runtime-trace-view-model.ts`'s functions build and the components under
 * this directory render. Kept apart from that file's logic (timeline
 * grouping, formatting, tool-call pairing) so both stay focused and under
 * the file-size limit.
 */

export type RuntimeTraceDrawerView = "timeline" | "metrics" | "raw";

export type RuntimeTraceSessionMode = "current" | "history";

export type RuntimeTraceStatus =
  | "started"
  | "running"
  | "succeeded"
  | "failed"
  | "degraded"
  | "skipped"
  | "active"
  | "closed"
  | "abandoned"
  | "idle"
  | "pending"
  | "settled"
  | "complete"
  | "incomplete"
  | "open"
  | string;

export type RuntimeTracePayloadState =
  | "captured"
  | "summary_only"
  | "pruned"
  | "unavailable"
  | string;

export interface RuntimeTracePromptPart {
  role: string;
  content: unknown;
  estimatedTokens?: number | null;
}

export interface RuntimeTracePayloadViewModel {
  prompt?: RuntimeTracePromptPart[] | null;
  input?: unknown;
  output?: unknown;
  retrieval?: unknown;
  stateDelta?: unknown;
  memoryDelta?: unknown;
  metadata?: unknown;
  stdout?: string | null;
  stderr?: string | null;
  byteSize?: number | null;
}

export interface RuntimeTraceEventViewModel {
  id: string;
  eventId?: string;
  seq?: number | null;
  traceRunId: string;
  turnOrdinal?: number | null;
  stepId?: string | null;
  parentStepId?: string | null;
  agentIteration?: number | null;
  stage: string;
  kind: string;
  title: string;
  status: RuntimeTraceStatus;
  occurredAt?: string | null;
  durationMs?: number | null;
  model?: string | null;
  providerInputTokens?: number | null;
  providerOutputTokens?: number | null;
  providerTotalTokens?: number | null;
  providerCachedTokens?: number | null;
  providerReasoningTokens?: number | null;
  estimatedCostUsd?: number | null;
  pricingVersion?: string | null;
  pricingStatus?: string | null;
  usageSource?: "provider" | "missing" | string | null;
  payloadState?: RuntimeTracePayloadState;
  detailLevel?: string | null;
  redactedFields?: string[];
  truncatedFields?: string[];
  unavailableFields?: string[];
  metadata?: unknown;
  payload?: RuntimeTracePayloadViewModel | null;
}

export interface RuntimeTraceRunViewModel {
  id: string;
  parentTraceRunId?: string | null;
  turnOrdinal?: number | null;
  originatingTurnOrdinal?: number | null;
  path: string;
  actionKind?: string | null;
  status: RuntimeTraceStatus;
  traceCompleteness: RuntimeTraceStatus;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  providerTotalTokens?: number | null;
  estimatedCostUsd?: number | null;
  pricingStatus?: string | null;
  llmCallCount?: number;
  toolCallCount?: number;
  errorCount?: number;
  traceOverheadMs?: number | null;
}

export interface RuntimeTraceSessionViewModel {
  id: string;
  problemId?: string;
  problemTitle?: string;
  startTrigger?: string;
  foregroundStatus: RuntimeTraceStatus;
  backgroundStatus: RuntimeTraceStatus;
  startedAt?: string | null;
  foregroundEndedAt?: string | null;
  settledAt?: string | null;
  captureLevel?: string;
  sharedChatSessionId?: string | null;
}

export interface RuntimeTraceSessionOptionViewModel {
  id: string;
  label: string;
  status?: RuntimeTraceStatus;
  payloadState?: RuntimeTracePayloadState;
}

export interface RuntimeTraceSummaryViewModel {
  visitElapsed?: string;
  agentBusy?: string;
  turnCount?: number;
  llmCallCount?: number;
  providerTotalTokens?: number | null;
  knownCostUsd?: number | null;
  unpricedCallCount?: number;
  toolCallCount?: number;
  memoryAdded?: number;
  memoryRemoved?: number;
  errorCount?: number;
}

export interface RuntimeTraceTurnGroup {
  key: string;
  turnOrdinal: number;
  rootRun?: RuntimeTraceRunViewModel;
  runs: RuntimeTraceRunViewModel[];
  events: RuntimeTraceEventViewModel[]; // seq ascending — the real execution order.
  autoExpand: boolean;
  isLatest: boolean;
}
