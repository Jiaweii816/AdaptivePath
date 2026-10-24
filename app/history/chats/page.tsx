import { History, MessageSquare, Wrench } from "lucide-react";
import Link from "next/link";
import { CoachMarkdown } from "@/components/coach/coach-markdown";
import { AppLayout } from "@/components/layout/app-layout";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TagChip } from "@/components/shared/tag-chip";
import { Button } from "@/components/ui/button";
import { irisDefaultProfile } from "@/features/onboarding/profile-defaults";
import {
  getChatHistoryPageData,
  type ChatHistorySession,
  type ChatHistorySnapshot,
  type ChatReplayItem,
  type ChatSessionStatus,
} from "@/features/chat-history/chat-history-data";
import { difficultyBadgeClass } from "@/lib/ui-status";
import { cn } from "@/lib/utils";

type ChatHistoryPageProps = {
  searchParams?: Promise<{ session?: string }>;
};

const STATUS_META: Record<
  ChatSessionStatus,
  { label: string; badge: string; dot: string }
> = {
  resolved: {
    label: "Resolved",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
  },
  in_progress: {
    label: "In Progress",
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
};

export default async function ChatHistoryPage({
  searchParams,
}: ChatHistoryPageProps) {
  const params = await searchParams;
  const data = await getChatHistoryPageData({ sessionId: params?.session });

  return (
    <AppLayout displayName={irisDefaultProfile.displayName}>
      <PageHeader
        title="Chat History"
        description="Pick a past session and restore the exact workbench context."
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="grid gap-4 self-start">
          {data.buckets.length > 0 ? (
            data.buckets.map((bucket) => (
              <div key={bucket.label}>
                <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {bucket.label}
                </p>
                <div className="mt-2 grid gap-2">
                  {bucket.sessions.map((session) => (
                    <SessionCard
                      active={session.id === data.selectedSessionId}
                      key={session.id}
                      session={session}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-sm text-muted-foreground">
              No chat sessions recorded yet.
            </div>
          )}
        </aside>

        {data.selected ? (
          <SessionDetail
            session={data.selected}
            snapshot={data.selectedSnapshot}
          />
        ) : (
          <div className="grid place-items-center rounded-lg border border-dashed border-border bg-card px-4 py-16 text-sm text-muted-foreground">
            Pick a session to preview and restore its workspace.
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function SessionCard({
  active,
  session,
}: {
  active: boolean;
  session: ChatHistorySession;
}) {
  const meta = STATUS_META[session.status];
  const preview = previewOf(session.replay);

  return (
    <Link
      className={cn(
        "block rounded-lg border bg-card px-3 py-2.5",
        active
          ? "border-primary/40 ring-1 ring-primary/30"
          : "border-border hover:border-primary/30",
      )}
      href={`/history/chats?session=${session.id}`}
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
        <span className="truncate text-sm font-semibold">
          {session.problem.leetcodeNumber
            ? `LC ${session.problem.leetcodeNumber} · `
            : ""}
          {session.problem.title}
        </span>
      </div>
      {preview ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">{preview}</p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {formatDateTime(session.updatedAt)} · {session.messageCount} messages
      </p>
    </Link>
  );
}

function SessionDetail({
  session,
  snapshot,
}: {
  session: ChatHistorySession;
  snapshot: ChatHistorySnapshot | null;
}) {
  const meta = STATUS_META[session.status];

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">
              {session.problem.leetcodeNumber
                ? `LC ${session.problem.leetcodeNumber} · `
                : ""}
              {session.problem.title}
            </h2>
            <StatusBadge className={meta.badge} label={meta.label} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(session.updatedAt)} · {session.messageCount} messages
            {session.primaryLanguage ? ` · ${session.primaryLanguage}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {session.problemHistoryHref ? (
            <Button asChild size="sm" variant="outline">
              <Link href={session.problemHistoryHref}>Problem Record</Link>
            </Button>
          ) : null}
          <Button asChild size="sm">
            <Link href={`/workbench?problem=${session.problem.slug}`}>
              <History className="h-4 w-4" aria-hidden="true" />
              Restore Workspace
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-3">
        <SnapshotPanel title="Problem Snapshot">
          {snapshot ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    difficultyBadgeClass(snapshot.difficulty),
                  )}
                >
                  {snapshot.difficulty ?? "Demo"}
                </span>
                {snapshot.tags.slice(0, 3).map((tag) => (
                  <TagChip key={tag} label={tag} />
                ))}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {snapshot.statementExcerpt || "No statement available."}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No snapshot.</p>
          )}
        </SnapshotPanel>

        <SnapshotPanel
          title="Code Draft Snapshot"
          caption={snapshot?.draftLanguage ? `current draft · ${snapshot.draftLanguage}` : "current draft"}
        >
          {snapshot?.draftContent ? (
            <pre className="max-h-56 overflow-auto rounded-md bg-[#101418] p-3 text-xs leading-5 text-white">
              {snapshot.draftContent}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No saved draft yet.</p>
          )}
        </SnapshotPanel>

        <SnapshotPanel title="Conversation Preview">
          {session.replay.length > 0 ? (
            <div className="grid gap-3">
              {session.replay.slice(0, 4).map((item) => (
                <ReplayItem item={item} key={item.id} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No replayable messages yet.
            </p>
          )}
        </SnapshotPanel>
      </div>
    </section>
  );
}

function SnapshotPanel({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {caption ? (
          <span className="text-xs text-muted-foreground">{caption}</span>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function previewOf(replay: ChatReplayItem[]): string | null {
  const firstUser = replay.find(
    (item) => item.kind === "message" && item.role === "user",
  );
  if (firstUser && firstUser.kind === "message") {
    return firstUser.contentMarkdown.replace(/\s+/g, " ").trim();
  }
  return null;
}

function ReplayItem({ item }: { item: ChatReplayItem }) {
  if (item.kind === "tool") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-950">
        <div className="flex flex-wrap items-center gap-2">
          <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
          <h4 className="text-xs font-semibold">{item.displayName}</h4>
        </div>
        <p className="mt-1 text-xs leading-5">{item.resultSummary}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border p-2.5",
        item.role === "user"
          ? "border-sky-200 bg-sky-50"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        {item.role === "assistant" ? (
          <MessageSquare className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        ) : null}
        <h4 className="text-xs font-semibold">{item.label}</h4>
      </div>
      <div className="mt-1">
        <MarkdownBlock markdown={item.contentMarkdown} />
      </div>
    </div>
  );
}

function MarkdownBlock({ markdown }: { markdown: string }) {
  return <CoachMarkdown density="compact" markdown={markdown} />;
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
