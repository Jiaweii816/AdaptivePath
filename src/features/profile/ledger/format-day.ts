/**
 * Short day label for ledger rows.
 *
 * Deliberately renders in the server's local zone, not UTC. Timestamps are
 * stored as UTC, but they were produced by this learner on this machine, so the
 * local day is the one they lived: a review written at `2026-08-10T01:30Z` in
 * `America/Chicago` happened on the evening of Aug 9 for them. Reading the same
 * row with SQLite's `date()` prints Aug 10, which is the misleading view — do
 * not "fix" this to UTC to make the two agree.
 */
export function formatLedgerDay(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatLedgerWindow(from: Date | null, to: Date | null) {
  if (!from || !to) return null;
  return `${formatLedgerDay(from)} – ${formatLedgerDay(to)}, ${to.getFullYear()}`;
}
