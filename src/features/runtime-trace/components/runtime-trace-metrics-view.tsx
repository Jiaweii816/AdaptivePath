import { AlertTriangle, CircleGauge, Database, TimerReset } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildRuntimeTraceMetricsViewModel,
  formatBytes,
  formatDuration,
  formatTokens,
  type RuntimeTraceMetricRow,
  type RuntimeTraceMetricsEvent,
  type RuntimeTraceMetricsRun,
  type RuntimeTraceMetricsSession,
} from "./runtime-trace-presentation";

export type RuntimeTraceMetricsViewProps = {
  session: RuntimeTraceMetricsSession;
  runs: readonly RuntimeTraceMetricsRun[];
  events: readonly RuntimeTraceMetricsEvent[];
  nowMs?: number;
  className?: string;
};

export function RuntimeTraceMetricsView({
  session,
  runs,
  events,
  nowMs,
  className,
}: RuntimeTraceMetricsViewProps) {
  const model = buildRuntimeTraceMetricsViewModel({ session, runs, events, nowMs });
  const totals = model.totals;

  return (
    <section
      aria-labelledby="runtime-trace-metrics-heading"
      className={cn("space-y-5", className)}
      data-testid="runtime-trace-metrics"
    >
      <div className="space-y-1">
        <h2 id="runtime-trace-metrics-heading" className="text-sm font-semibold text-foreground">
          Metrics
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          Provider usage, known pricing coverage, and wall-clock timing are kept separate.
        </p>
      </div>

      <TokenLedger row={totals} />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Per-turn comparison
          </h3>
          <span className="text-[11px] text-muted-foreground">Background usage is attributed to its originating Turn.</span>
        </div>

        {model.turnRows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground">
            No foreground Turns have been recorded yet.
          </div>
        ) : (
          <>
            <div
              className="hidden overflow-x-auto rounded-md border border-border md:block"
              role="region"
              aria-label="Runtime Trace per-turn metrics table"
              tabIndex={0}
            >
              <table className="w-full min-w-[760px] border-collapse text-left text-xs tabular-nums">
                <thead className="bg-muted/70 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Turn</th>
                    <th className="px-3 py-2.5 font-medium">Busy</th>
                    <th className="px-3 py-2.5 font-medium">LLM / tokens</th>
                    <th className="px-3 py-2.5 font-medium">Known cost</th>
                    <th className="px-3 py-2.5 font-medium">Tools</th>
                    <th className="px-3 py-2.5 font-medium">Memory Δ</th>
                    <th className="px-3 py-2.5 font-medium">Overhead</th>
                    <th className="px-3 py-2.5 font-medium">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {model.turnRows.map((row) => (
                    <tr key={row.key} className="bg-card align-top">
                      <td className="px-3 py-3">
                        <span className="font-semibold text-foreground">{row.label}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{humanize(row.path)}</span>
                      </td>
                      <td className="px-3 py-3 text-foreground">{formatDuration(row.durationMs)}</td>
                      <td className="px-3 py-3">
                        <span className="text-foreground">{row.llmCallCount} / {formatTokens(row.tokens.providerTotalTokens)}</span>
                        <TokenSubsetsCompact row={row} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-foreground">{row.cost.label}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{pricingCoverageLabel(row.cost.coverage)}</span>
                      </td>
                      <td className="px-3 py-3 text-foreground">{row.toolCallCount}</td>
                      <td className="px-3 py-3 text-foreground">{formatMemoryDelta(row)}</td>
                      <td className="px-3 py-3 text-foreground">{formatDuration(row.traceOverheadMs)}</td>
                      <td className="px-3 py-3">
                        <StateText status={row.status} completeness={row.completeness} errors={row.errorCount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-2 md:hidden" aria-label="Runtime Trace per-turn metrics cards">
              {model.turnRows.map((row) => (
                <article key={row.key} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{row.label}</h4>
                      <p className="text-xs text-muted-foreground">{humanize(row.path)}</p>
                    </div>
                    <StateText status={row.status} completeness={row.completeness} errors={row.errorCount} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs tabular-nums">
                    <CompactDatum label="Busy" value={formatDuration(row.durationMs)} />
                    <CompactDatum label="Provider tokens" value={formatTokens(row.tokens.providerTotalTokens)} />
                    <CompactDatum label="Known cost" value={row.cost.label} />
                    <CompactDatum label="Tools" value={String(row.toolCallCount)} />
                    <CompactDatum label="Memory Δ" value={formatMemoryDelta(row)} />
                    <CompactDatum label="Trace overhead" value={formatDuration(row.traceOverheadMs)} />
                  </dl>
                  <TokenSubsetsCompact row={row} className="mt-3 border-t border-border pt-2" />
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      {model.processSamples.length > 0 ? (
        <section className="rounded-md border border-border bg-muted/30 p-3" aria-labelledby="runtime-trace-process-samples">
          <div className="flex items-start gap-2">
            <CircleGauge aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h3 id="runtime-trace-process-samples" className="text-xs font-semibold text-foreground">
                Process-wide resource samples
              </h3>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                These are whole-process snapshots, not exact memory allocated by a Session or Turn.
              </p>
              <ul className="mt-2 grid gap-1 text-xs tabular-nums text-foreground sm:grid-cols-2">
                {model.processSamples.map((sample) => (
                  <li key={sample.eventId} className="rounded border border-border bg-card px-2.5 py-2">
                    RSS {formatBytes(sample.rssBytes)} · heap {formatBytes(sample.heapUsedBytes)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function TokenLedger({ row }: { row: RuntimeTraceMetricRow }) {
  const tokens = row.tokens;
  return (
    <section className="rounded-md border border-border bg-card p-3" aria-labelledby="runtime-trace-token-ledger">
      <div className="flex items-center gap-2">
        <Database aria-hidden="true" className="size-4 text-primary" />
        <h3 id="runtime-trace-token-ledger" className="text-xs font-semibold text-foreground">
          Provider token ledger
        </h3>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        Cached tokens are a subset of input; reasoning tokens are a subset of output. Neither is added again to the total.
      </p>
      <dl className="mt-3 grid gap-2 text-xs tabular-nums sm:grid-cols-3">
        <TokenDatum label="Provider total" value={formatTokens(tokens.providerTotalTokens)} strong />
        <TokenDatum label="Input" value={formatTokens(tokens.providerInputTokens)} subsetLabel="↳ cached subset" subsetValue={formatTokens(tokens.providerCachedTokens)} />
        <TokenDatum label="Output" value={formatTokens(tokens.providerOutputTokens)} subsetLabel="↳ reasoning subset" subsetValue={formatTokens(tokens.providerReasoningTokens)} />
      </dl>
      {tokens.integrityWarnings.length > 0 ? (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-900" role="status">
          <span className="font-semibold">Provider usage needs review.</span>{" "}
          {tokens.integrityWarnings.join(" ")}
        </div>
      ) : null}
    </section>
  );
}

function TokenDatum({ label, value, subsetLabel, subsetValue, strong = false }: { label: string; value: string; subsetLabel?: string; subsetValue?: string; strong?: boolean }) {
  return (
    <div className="rounded border border-border bg-muted/25 px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-foreground", strong && "font-semibold")}>{value}</dd>
      {subsetLabel ? (
        <div className="mt-1.5 border-l border-border pl-2 text-[10px] text-muted-foreground">
          <dt>{subsetLabel}</dt>
          <dd className="tabular-nums text-foreground">{subsetValue}</dd>
        </div>
      ) : null}
    </div>
  );
}

function TokenSubsetsCompact({ row, className }: { row: RuntimeTraceMetricRow; className?: string }) {
  return (
    <span className={cn("mt-0.5 block text-[10px] leading-4 text-muted-foreground", className)}>
      in {formatTokens(row.tokens.providerInputTokens)}
      {row.tokens.providerCachedTokens !== null ? ` (cached ${formatTokens(row.tokens.providerCachedTokens)})` : ""}
      {" · "}out {formatTokens(row.tokens.providerOutputTokens)}
      {row.tokens.providerReasoningTokens !== null ? ` (reasoning ${formatTokens(row.tokens.providerReasoningTokens)})` : ""}
    </span>
  );
}

function StateText({ status, completeness, errors }: { status: string; completeness: string; errors: number }) {
  const warning = status === "failed" || status === "degraded" || completeness !== "complete" || errors > 0;
  return (
    <span className={cn("inline-flex max-w-32 items-center gap-1 text-[11px] font-medium", warning ? "text-amber-800" : "text-emerald-700")}>
      {warning ? <AlertTriangle aria-hidden="true" className="size-3 shrink-0" /> : <TimerReset aria-hidden="true" className="size-3 shrink-0" />}
      <span>{humanize(status)} · {humanize(completeness)}</span>
    </span>
  );
}

function CompactDatum({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}

function pricingCoverageLabel(status: RuntimeTraceMetricRow["cost"]["coverage"]) {
  if (status === "priced") return "Complete pricing coverage";
  if (status === "partial") return "Partial pricing coverage";
  if (status === "unpriced") return "No defensible rate available";
  return "No LLM pricing applies";
}

function formatMemoryDelta(row: RuntimeTraceMetricRow) {
  const { addedCount, removedCount, durableRowCount } = row.memory;
  if (addedCount > 0 || removedCount > 0) return `+${addedCount} / −${removedCount}`;
  if (durableRowCount > 0) return `${durableRowCount} row${durableRowCount === 1 ? "" : "s"}`;
  return "No durable delta";
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
