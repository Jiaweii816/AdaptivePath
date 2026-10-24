import { cn } from "@/lib/utils";
import { LEDGER_GROUP_LABELS } from "../fact-display";
import type {
  LedgerFactGroup,
  LedgerLadder,
  LedgerSlotPolarity,
} from "../ledger-types";

const GROUP_CLASS: Record<LedgerFactGroup, string> = {
  can: "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
  wrong: "bg-rose-50 text-rose-800 ring-rose-200/70",
  work: "bg-amber-50 text-amber-800 ring-amber-200/70",
};

export function GroupPill({ group }: { group: LedgerFactGroup }) {
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ring-1",
        GROUP_CLASS[group],
      )}
    >
      {LEDGER_GROUP_LABELS[group]}
    </span>
  );
}

const SLOT_POLARITY_CLASS: Record<LedgerSlotPolarity, string> = {
  positive: "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
  negative: "bg-rose-50 text-rose-800 ring-rose-200/70",
  neutral: "bg-muted text-muted-foreground ring-border",
  mixed: "bg-amber-50 text-amber-800 ring-amber-200/70",
};

export function SlotKindPill({
  slot,
  polarity,
}: {
  slot: string;
  polarity: LedgerSlotPolarity;
}) {
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] ring-1",
        SLOT_POLARITY_CLASS[polarity],
      )}
    >
      {slot}
    </span>
  );
}

const RUNG_HEIGHTS = ["h-2", "h-2.5", "h-3", "h-3.5", "h-4", "h-[1.15rem]"];

const LADDER_ON_CLASS: Record<"can" | "wrong" | "work", string> = {
  can: "bg-emerald-600 border-emerald-600",
  wrong: "bg-rose-600 border-rose-600",
  work: "bg-amber-500 border-amber-500",
};

const LADDER_TEXT_CLASS: Record<"can" | "wrong" | "work", string> = {
  can: "text-emerald-700",
  wrong: "text-rose-700",
  work: "text-amber-700",
};

/**
 * The ladder is the evidence count made visible: one rung per independent
 * sighting, with the last rung as the cap. It exists so the confidence number
 * reads as computed rather than as a model's opinion.
 */
export function ConfidenceLadder({
  confidence,
  ladder,
  group,
}: {
  confidence: number;
  ladder: LedgerLadder;
  group: LedgerFactGroup;
}) {
  return (
    <div className="grid justify-items-end gap-1.5">
      <span
        className={cn(
          "font-mono text-base font-bold tabular-nums tracking-tight",
          LADDER_TEXT_CLASS[group],
        )}
      >
        {confidence.toFixed(2)}
      </span>
      <span
        aria-label={`${ladder.filled} of ${ladder.rungs} evidence rungs filled`}
        className="flex items-end gap-0.5"
        role="img"
      >
        {RUNG_HEIGHTS.map((height, index) => (
          <span
            className={cn(
              "w-[7px] rounded-sm border",
              height,
              index < ladder.filled
                ? LADDER_ON_CLASS[group]
                : "border-border bg-muted",
            )}
            key={height}
          />
        ))}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {ladder.capped
          ? `capped${ladder.beyondCap > 0 ? ` · +${ladder.beyondCap} past cap` : ""}`
          : `${ladder.filled} of ${ladder.rungs} rungs`}
      </span>
    </div>
  );
}

/**
 * The acceptance gate values for a synthesis slot. These are the numbers the
 * memory system actually enforces, unlike the model's proposed confidence.
 */
export function GateReadout({
  clusterCount,
  problemCount,
  tight,
}: {
  clusterCount: number;
  problemCount: number;
  tight: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-0.5 rounded border px-2.5 py-1.5 text-right",
        tight
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
    >
      <span className="font-mono text-sm font-bold tabular-nums tracking-tight">
        {clusterCount} · {problemCount}
      </span>
      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] opacity-80">
        clusters · problems
      </span>
    </div>
  );
}

export function MechanismChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block max-w-full truncate rounded border border-emerald-200 bg-emerald-50/70 px-1.5 py-0.5 align-[2px] font-mono text-[10.5px] text-emerald-900">
      {children}
    </span>
  );
}

export function ReviewFlag({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex gap-2.5 rounded border border-amber-200 border-l-[3px] border-l-amber-500 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground/80">
      <span className="pt-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.09em] text-amber-700">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
