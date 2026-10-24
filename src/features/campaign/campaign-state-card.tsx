import Link from "next/link";

export function CampaignStateCard({
  kind,
}: {
  kind: "empty" | "conflict" | "error";
}) {
  const content = kind === "empty"
    ? {
        title: "No Campaign has been created",
        detail: "Set an end date, daily task budget, and optional learning priorities to create your first route.",
      }
    : kind === "conflict"
      ? {
          title: "Multiple active Campaigns were found",
          detail: "To avoid reading the wrong route, the system did not choose one automatically. Use a future management surface to resolve the conflict.",
        }
      : {
          title: "The Campaign could not be loaded",
          detail: "No task was modified. Refresh the page and try again shortly.",
        };
  return (
    <section
      aria-live={kind === "error" ? "assertive" : "polite"}
      className="mx-auto mt-16 max-w-2xl rounded-xl border border-border bg-card p-8 shadow-sm"
    >
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Campaign</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{content.title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{content.detail}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {kind === "empty" ? (
          <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href="/campaign/onboarding">
            Create Campaign
          </Link>
        ) : (
          <Link className="rounded-md border border-border px-4 py-2 text-sm font-medium" href="/campaign/today">
            Check again
          </Link>
        )}
      </div>
    </section>
  );
}
