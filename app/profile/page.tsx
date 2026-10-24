import Link from "next/link";
import { AppLayout } from "@/components/layout/app-layout";
import { PageHeader } from "@/components/shared/page-header";
import { CandidateBand } from "@/features/profile/ledger/components/candidate-band";
import { EpisodeRow } from "@/features/profile/ledger/components/episode-row";
import { FactRow } from "@/features/profile/ledger/components/fact-row";
import { LedgerStrip } from "@/features/profile/ledger/components/ledger-strip";
import { LedgerTier } from "@/features/profile/ledger/components/ledger-tier";
import { PagedList } from "@/features/profile/ledger/components/paged-list";
import { SelfReportedPanel } from "@/features/profile/ledger/components/self-reported-panel";
import { SignalEditor } from "@/features/profile/ledger/components/signal-editor";
import { SlotCard } from "@/features/profile/ledger/components/slot-card";
import { formatLedgerWindow } from "@/features/profile/ledger/format-day";
import { getEvidenceLedgerData } from "@/features/profile/ledger/load-evidence-ledger";
import { findTwoSidedMechanismNotes } from "@/features/profile/ledger/two-sided-mechanisms";

type ProfilePageProps = {
  searchParams?: Promise<{ saved?: string }>;
};

const GROUP_FILTERS = [
  { key: "all", label: "everything" },
  { key: "can", label: "can do" },
  { key: "wrong", label: "gets wrong" },
  { key: "work", label: "how you work" },
];


export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const [data, params] = await Promise.all([
    getEvidenceLedgerData(),
    searchParams,
  ]);
  const twinNotes = findTwoSidedMechanismNotes(data.facts);
  const window = formatLedgerWindow(data.firstObservedAt, data.lastObservedAt);

  return (
    <AppLayout displayName={data.displayName}>
      <PageHeader
        title="Evidence Ledger"
        description="Everything the coach believes about you, newest first — and the receipts underneath each claim."
        actions={
          <div className="flex items-center gap-2 font-mono text-[11.5px]">
            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">
              learner
            </span>
            {window ? (
              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">
                {window}
              </span>
            ) : null}
          </div>
        }
      />

      {params?.saved === "1" ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Profile preferences saved.
        </div>
      ) : null}

      <LedgerStrip totals={data.totals} />

      <main className="mt-2">
        <LedgerTier
          count={`${data.slots.length} active ${data.slots.length === 1 ? "slot" : "slots"} · newest first`}
          id="L3"
          title="Cross-problem synthesis"
        >
          {data.slots.length > 0 ? (
            <PagedList noun="slots">
              {data.slots.map((slot) => (
                <SlotCard key={slot.id} slot={slot} twinNotes={twinNotes} />
              ))}
            </PagedList>
          ) : (
            <EmptyTier>
              No cross-problem synthesis has cleared the evidence gate yet.
            </EmptyTier>
          )}
        </LedgerTier>

        <LedgerTier
          count={`${data.totals.activeFacts} active · ${data.totals.candidateFacts} candidate · newest first`}
          id="L2"
          title="Established facts"
        >
          {data.facts.length > 0 ? (
            <PagedList
              filters={GROUP_FILTERS}
              groupOf={data.facts.map((fact) => fact.group)}
              noun="facts"
            >
              {data.facts.map((fact) => (
                <FactRow
                  fact={fact}
                  key={fact.id}
                  twin={twinNotes.get(fact.id)}
                />
              ))}
            </PagedList>
          ) : (
            <EmptyTier>No established facts yet.</EmptyTier>
          )}

          <CandidateBand
            candidates={data.candidates}
            total={data.totals.candidateFacts}
          />
        </LedgerTier>

        <LedgerTier
          count={`${data.totals.episodes} · ${data.totals.reviewEpisodes} reviews / ${data.totals.chatEpisodes} chat segments · newest first`}
          id="EP"
          title="Episodes"
        >
          {data.episodes.length > 0 ? (
            <PagedList noun="episodes">
              {data.episodes.map((episode) => (
                <EpisodeRow episode={episode} key={episode.id} />
              ))}
            </PagedList>
          ) : (
            <EmptyTier>No episodes recorded yet.</EmptyTier>
          )}
        </LedgerTier>

        <LedgerTier
          count={`${data.totals.traceEvents.toLocaleString("en")} events`}
          id="L1"
          last
          terminal
          title="Raw trace"
        >
          <div className="flex flex-wrap items-center justify-between gap-3.5 rounded-md border border-dashed border-border bg-muted/30 px-4 py-4">
            <p className="max-w-[62ch] text-[13px] text-foreground/80">
              The deepest link on this page ends in a run, a diff, and a
              timestamp. Nothing here is a summary of a summary with no bottom.
            </p>
            <Link
              className="font-mono text-[11px] text-primary hover:underline"
              href="/history/problems"
            >
              Open problem history →
            </Link>
          </div>
        </LedgerTier>

        <SelfReportedPanel
          audits={data.selfReported}
          preferences={data.preferences}
        />
      </main>

      <SignalEditor selections={data.selections} />
    </AppLayout>
  );
}

function EmptyTier({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
