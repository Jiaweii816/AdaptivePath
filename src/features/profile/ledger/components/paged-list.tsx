"use client";

import { Children, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const PER_PAGE = 10;

type Filter = { key: string; label: string };

function Pager({
  page,
  pages,
  from,
  shown,
  total,
  noun,
  onSelect,
}: {
  page: number;
  pages: number;
  from: number;
  shown: number;
  total: number;
  noun: string;
  onSelect: (page: number) => void;
}) {
  if (pages <= 1) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-auto font-mono text-[11px] tabular-nums text-muted-foreground">
        {from + 1}–{from + shown} of {total} {noun}
      </span>
      <PageButton
        disabled={page === 1}
        label="Previous page"
        onSelect={() => onSelect(page - 1)}
      >
        ‹
      </PageButton>
      {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
        <PageButton
          current={number === page}
          key={number}
          label={`Page ${number}`}
          onSelect={() => onSelect(number)}
        >
          {number}
        </PageButton>
      ))}
      <PageButton
        disabled={page === pages}
        label="Next page"
        onSelect={() => onSelect(page + 1)}
      >
        ›
      </PageButton>
    </div>
  );
}

function PageButton({
  children,
  current,
  disabled,
  label,
  onSelect,
}: {
  children: ReactNode;
  current?: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-current={current ? "true" : undefined}
      aria-label={label}
      className={cn(
        "min-w-[30px] rounded border px-2 py-1 font-mono text-[11.5px] tabular-nums",
        current
          ? "border-primary bg-primary font-bold text-primary-foreground"
          : "border-border bg-card text-foreground/80 hover:border-primary hover:text-primary",
        disabled && "opacity-40",
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Pages server-rendered rows ten at a time, with an optional group filter.
 *
 * Rows arrive already rendered; `groupOf` is a parallel array of plain strings
 * so filtering never needs the row data on the client.
 */
export function PagedList({
  children,
  noun,
  filters,
  groupOf,
}: {
  children: ReactNode;
  noun: string;
  filters?: Filter[];
  groupOf?: string[];
}) {
  const [page, setPage] = useState(1);
  const [active, setActive] = useState("all");
  const rows = useMemo(() => Children.toArray(children), [children]);

  const visible = useMemo(
    () =>
      active === "all" || !groupOf
        ? rows
        : rows.filter((_, index) => groupOf[index] === active),
    [active, groupOf, rows],
  );

  const pages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const safePage = Math.min(page, pages);
  const from = (safePage - 1) * PER_PAGE;
  const slice = visible.slice(from, from + PER_PAGE);

  function selectFilter(key: string) {
    setActive(key);
    setPage(1);
  }

  return (
    <div>
      {filters && groupOf ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {filters.map((filter) => {
            const count =
              filter.key === "all"
                ? rows.length
                : groupOf.filter((group) => group === filter.key).length;
            return (
              <button
                aria-pressed={active === filter.key}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-mono text-[11px]",
                  active === filter.key
                    ? "border-primary bg-primary font-semibold text-primary-foreground"
                    : "border-border bg-card text-foreground/80 hover:border-primary hover:text-primary",
                )}
                key={filter.key}
                onClick={() => selectFilter(filter.key)}
                type="button"
              >
                {filter.label} <span className="font-bold tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="grid gap-2">{slice}</div>

      <Pager
        from={from}
        noun={noun}
        onSelect={setPage}
        page={safePage}
        pages={pages}
        shown={slice.length}
        total={visible.length}
      />
    </div>
  );
}
