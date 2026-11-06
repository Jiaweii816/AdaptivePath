"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import chunks from "./data/biology-12-2/chunks.json";
import retrievalIndex from "./data/biology-12-2/retrieval-index.json";
import { CONCEPTS, getConcept, OPENSTAX_URL } from "./concepts";

const FIRST_PRINTED_PAGE = 316;
const PAGE_COUNT = 12;
const linkedQuestions = retrievalIndex.chunk_to_question_ids as Record<string, string[]>;

export function AdaptiveTextbookBrowser() {
  const [concept, setConcept] = useState("all");
  const [page, setPage] = useState("all");
  const [search, setSearch] = useState("");
  const shown = useMemo(() => chunks.filter((c) =>
    (concept === "all" || c.concept_ids.includes(concept)) &&
    (page === "all" || String(c.printed_page) === page) &&
    (!search.trim() || `${c.normalized_text} ${c.subsection}`.toLowerCase().includes(search.trim().toLowerCase())),
  ), [concept, page, search]);
  const linkedCount = Object.values(linkedQuestions).filter((ids) => ids.length > 0).length;
  return <main className="min-h-screen bg-background px-4 py-6 text-foreground lg:px-8">
    <div className="mx-auto max-w-6xl">
      <Link href="/adaptivepath" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft size={16} />Back to Biology Workbench
      </Link>
      <PageHeader title="Biology 2e · Section 12.2"
        description="Source text chunks with page locations and sub-topic links · Characteristics and Traits"
        actions={<span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"><BookOpen size={15} />{chunks.length} indexed chunks</span>} />
      <div className="mt-5 rounded-md border border-border bg-card p-4">
        <p className="text-sm font-semibold">Source and coverage</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Section 12.2 spans printed pages 316–327. Each chunk keeps its page, layout box and the sub-topics it supports; figures are shown in the PDF reader on the practice page.</p>
        <p className="mt-2 text-xs text-muted-foreground">Credit: OpenStax, Biology 2e, §12.2. <a className="text-primary underline" href={OPENSTAX_URL} target="_blank" rel="noreferrer">Open original section</a></p>
      </div>
      <div className="mt-5 grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-[1fr_260px_135px]">
        <div className="relative"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
          <input aria-label="Search textbook passages" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search full textbook text…" className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm" /></div>
        <select aria-label="Filter textbook concept" value={concept} onChange={(e) => setConcept(e.target.value)} className="rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">All sub-topics</option>{CONCEPTS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Filter printed page" value={page} onChange={(e) => setPage(e.target.value)} className="rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">All pages</option>{Array.from({ length: PAGE_COUNT }, (_, i) => FIRST_PRINTED_PAGE + i).map((p) => <option key={p} value={p}>Page {p}</option>)}</select>
      </div>
      <p className="my-4 font-mono text-xs text-muted-foreground">{shown.length} passage chunks shown · {linkedCount} referenced by the question bank</p>
      <div className="space-y-3">
        {shown.map((chunk) => <article key={chunk.id} id={chunk.id} className="scroll-mt-6 rounded-md border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className="rounded bg-muted px-2 py-1">p. {chunk.printed_page}</span>
            {chunk.concept_ids.map((id) => <span key={id} className="rounded bg-muted px-2 py-1">{getConcept(id).name}</span>)}
            <span className="rounded bg-muted px-2 py-1">{chunk.kind}</span>
            {(linkedQuestions[chunk.id]?.length ?? 0) > 0 && <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">{linkedQuestions[chunk.id].length} questions linked</span>}
          </div>
          <h2 className="mt-3 text-base font-semibold">{chunk.subsection}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{chunk.normalized_text}</p>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">{chunk.id}</p>
        </article>)}
      </div>
      {!shown.length && <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No passages match these filters.</div>}
    </div>
  </main>;
}
