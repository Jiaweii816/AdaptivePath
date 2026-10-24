import { cn } from "@/lib/utils";

/**
 * One tier on the provenance spine. The rail carries a continuous line so
 * descending the hierarchy reads as a physical move down the page; each tier
 * states how its rows are produced, because that is what makes the layer
 * distinctions legible rather than decorative.
 */
export function LedgerTier({
  id,
  title,
  count,
  terminal,
  last,
  children,
}: {
  id: string;
  title: string;
  count: string;
  terminal?: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="relative grid gap-x-6 md:grid-cols-[64px_minmax(0,1fr)]">
      <div className="relative row-span-full hidden md:block">
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-[31px] top-0 w-0.5 bg-emerald-200",
            last ? "h-11" : "-bottom-px",
          )}
        />
        <span
          className={cn(
            "absolute left-[11px] top-[30px] grid h-[41px] w-[41px] place-items-center rounded-full border-2 bg-background font-mono text-xs font-bold text-primary",
            terminal ? "border-dashed border-emerald-200" : "border-primary",
          )}
        >
          {id}
        </span>
      </div>
      <div className="min-w-0 border-t border-border py-6 md:border-t-0 md:pb-8 md:pt-7">
        <div className="mb-4">
          <span className="mb-2 inline-block rounded border border-primary px-2 py-0.5 font-mono text-[10.5px] font-bold tracking-[0.07em] text-primary md:hidden">
            {id}
          </span>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
            <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
              {count}
            </span>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
