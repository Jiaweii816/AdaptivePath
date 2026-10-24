"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleGauge, Flag, LockKeyhole, Route, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { englishSystemText } from "@/lib/system-copy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CampaignRoadmapNodeView } from "@/server/campaign";

const OUTCOME_LABELS = {
  positive: "Positive",
  negative: "Negative",
  neutral: "Neutral",
} as const;

function healthLabel(node: CampaignRoadmapNodeView) {
  if (node.masteryHealth === "watch") return "Watch";
  if (node.masteryHealth === "needs_reinforcement") return "Needs recovery";
  return "Stable";
}

export function CampaignNodeDrawer({
  node,
  onOpenChange,
  open,
}: {
  node: CampaignRoadmapNodeView | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {node ? (
        <DialogContent className="left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-xl translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-y-0 border-r-0 p-0 sm:w-[min(92vw,36rem)]">
          <DialogHeader className="border-b border-border bg-muted/30 px-6 py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{node.nodeId}</p>
            <DialogTitle className="text-2xl tracking-tight">{englishSystemText(node.nodeName, "Learning node")}</DialogTitle>
            <DialogDescription className="max-w-prose leading-6">{englishSystemText(node.coreInvariant, "This node builds a transferable interview skill.")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 px-6 py-6">
            <section aria-labelledby="drawer-state-heading">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="sr-only" id="drawer-state-heading">Node status</h3>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-sm font-medium">
                  {node.locked ? <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> : node.pendingRepairCount > 0 ? <Wrench className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleGauge className="h-3.5 w-3.5" aria-hidden="true" />}
                  {node.current ? "In progress" : englishSystemText(node.statusLabel, "Available")}
                </span>
                {node.current ? <span className="inline-flex items-center gap-1 text-sm font-medium text-primary"><Flag className="h-4 w-4" aria-hidden="true" /> Today&apos;s primary node</span> : null}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Mastery state" value={node.masteryState === "mastered" ? "Mastered" : "Learning"} />
                <Stat label="Mastery health" value={healthLabel(node)} />
                <Stat label="Practice progress" value={`${node.attemptedProblemCount} / ${node.totalProblems}`} />
                <Stat label="Unseen problems" value={String(node.neverSeenProblemCount)} />
                <Stat label="Mastery progress" value={`${node.masteryProgressCurrent} / ${node.masteryProgressRequired}`} />
                <Stat label="Recent positive streak" value={String(node.latestPositiveStreak)} />
                <Stat label="Recovery" value={`${node.pendingRepairCount} items`} />
              </dl>
            </section>

            <section aria-labelledby="drawer-prerequisite-heading" className="rounded-xl border border-border p-4">
              <h3 className="flex items-center gap-2 font-semibold" id="drawer-prerequisite-heading"><Route className="h-4 w-4 text-primary" aria-hidden="true" /> Prerequisites</h3>
              {node.requiredPrerequisites.length ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {node.requiredPrerequisites.map((item) => (
                    <li className="flex items-center gap-2" key={item.nodeId}>
                      <CheckCircle2 className={`h-4 w-4 ${item.satisfied ? "text-emerald-600" : "text-muted-foreground"}`} aria-hidden="true" />
                      Required: {englishSystemText(item.nodeName, "Learning node")} · {item.satisfied ? "Met" : "Not met"}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-muted-foreground">No required prerequisite blocks this node.</p>}
              {node.recommendedPrerequisites.length ? (
                <p className="mt-3 text-sm text-muted-foreground">Recommended first: {node.recommendedPrerequisites.map((item) => englishSystemText(item.nodeName, "Learning node")).join(", ")} (does not lock this node)</p>
              ) : null}
              {node.lockedReason ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{englishSystemText(node.lockedReason, "This node is locked until its required prerequisites are met.")}</p> : null}
            </section>

            <section aria-labelledby="drawer-settlements-heading">
              <h3 className="font-semibold" id="drawer-settlements-heading">Recent settlements</h3>
              {node.recentSettlements.length ? (
                <ol className="mt-3 space-y-3">
                  {node.recentSettlements.map((settlement) => (
                    <li className="rounded-xl border border-border bg-muted/20 p-4" key={`${settlement.problemTitle}-${settlement.settledAt}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{settlement.problemTitle}</p>
                        <span className="rounded-full bg-background px-2 py-1 text-xs font-medium">{OUTCOME_LABELS[settlement.outcome]}</span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{englishSystemText(settlement.slotRoleLabel, "Campaign task")} · Self-rating: {englishSystemText(settlement.selfRatingLabel, "Not recorded")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{englishSystemText(settlement.evidenceLabel, "Evidence recorded")}</p>
                      <time className="mt-2 block text-xs text-muted-foreground" dateTime={settlement.settledAt}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(settlement.settledAt))}</time>
                    </li>
                  ))}
                </ol>
              ) : <p className="mt-2 text-sm text-muted-foreground">No Campaign settlement has been recorded yet.</p>}
            </section>

            {node.current && !node.locked ? (
              <Button asChild className="w-full">
                <Link href="/campaign/today">{node.status === "learning" ? "Continue learning" : "Open today&apos;s task"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </Button>
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-muted/20 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>;
}
