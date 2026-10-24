import Link from "next/link";
import { Flag } from "lucide-react";
import { englishSystemText } from "@/lib/system-copy";
import type { CampaignWorkbenchContextView } from "@/server/campaign";

export function WorkbenchCampaignBanner({ context }: { context: CampaignWorkbenchContextView }) {
  return (
    <aside className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3" aria-label="Campaign task context">
      <div className="flex min-w-0 items-center gap-3">
        <Flag className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Campaign task · Task {context.taskOrder}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {context.mixedHidden
              ? "Mixed practice: the learning node reveals after settlement."
              : context.nodeName
                ? `Learning node: ${englishSystemText(context.nodeName, "Current route")}`
                : "Campaign task context is linked."}
          </p>
        </div>
      </div>
      <Link className="text-sm font-medium text-primary hover:underline" href="/campaign/today">Back to Campaign Today</Link>
    </aside>
  );
}
