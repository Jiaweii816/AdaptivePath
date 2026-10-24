import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import type { WorkbenchActionOutcome } from "./types";

export function ActionOutcomeCard({
  outcomes,
  onOpen,
}: {
  outcomes: WorkbenchActionOutcome[];
  onOpen: (href: string) => Promise<void>;
}) {
  return (
    <div
      aria-label="Backend-confirmed save status"
      className="mt-3 rounded-md border border-border bg-background/70 p-3"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        Save status (backend confirmed)
      </div>
      <ul className="space-y-2 text-xs">
        {outcomes.map((outcome) => {
          const completed = outcome.status === "completed";
          const destination = completed
            ? destinationFor(outcome.toolName)
            : undefined;
          return (
            <li
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
              data-status={outcome.status}
              key={outcome.toolName}
            >
              {completed ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-emerald-600"
                />
              ) : (
                <AlertCircle
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-amber-600"
                />
              )}
              <span className="font-medium text-foreground">
                {completed ? "Saved" : "Not saved"}: {outcome.displayName}
              </span>
              <span className="text-muted-foreground">{outcome.message}</span>
              {destination ? (
                <button
                  className="text-primary hover:underline"
                  onClick={() => void onOpen(destination.href)}
                  type="button"
                >
                  {destination.label}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function destinationFor(toolName: WorkbenchActionOutcome["toolName"]) {
  if (toolName === "save_mistake_book_entry") {
    return { href: "/notebook", label: "View Mistake Book" };
  }
  if (toolName === "save_knowledge_note") {
    return { href: "/handbook", label: "View Knowledge Handbook" };
  }
  return undefined;
}
