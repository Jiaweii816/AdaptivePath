"use client";
import Link from "next/link";
import { useMemo,useState } from "react";
import { ArrowLeft,BookOpen,Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { BIOLOGY_QUESTIONS,TEXTBOOK_CHUNKS,OPENSTAX_URL } from "./content";
import { BIOLOGY_TOPICS,type BiologyTopic } from "./textbook-chunks";

const label=(t:string)=>t.replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());
export function AdaptiveTextbookBrowser(){
  const [topic,setTopic]=useState<"all"|BiologyTopic>("all");
  const [page,setPage]=useState("all");
  const [search,setSearch]=useState("");
  const shown=useMemo(()=>TEXTBOOK_CHUNKS.filter(c=>
    (topic==="all"||c.topic===topic)&&
    (page==="all"||String(c.page)===page)&&
    (!search.trim()||(c.original+" "+c.subtitle+" "+c.summary)
      .toLowerCase().includes(search.trim().toLowerCase()))
  ),[topic,page,search]);
  const linkedIds=useMemo(()=>new Set(BIOLOGY_QUESTIONS.flatMap(q=>q.referenceIds)),[]);
  return <main className="min-h-screen bg-background px-4 py-6 text-foreground lg:px-8">
    <div className="mx-auto max-w-6xl">
      <Link href="/adaptivepath" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft size={16}/>Back to Biology Workbench
      </Link>
      <PageHeader title="Biology 2e · Section 12.2"
        description="Complete extracted text · paragraph-level references · Characteristics and Traits"
        actions={<span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"><BookOpen size={15}/>{TEXTBOOK_CHUNKS.length} indexed chunks</span>}/>
      <div className="mt-5 rounded-md border border-border bg-card p-4">
        <p className="text-sm font-semibold">Source and coverage</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">The full supplied Section 12.2 extraction spans printed pages 316–327 (PDF 336–347). Passage text, learning objectives, tables, figures captions, visual questions and examples are indexed. Figure images themselves are not embedded; inspect the original textbook for diagrams.</p>
        <p className="mt-2 text-xs text-muted-foreground">Credit: OpenStax, Biology 2e, §12.2. <a className="text-primary underline" href={OPENSTAX_URL} target="_blank" rel="noreferrer">Open original section</a></p>
      </div>
      <div className="mt-5 grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-[1fr_210px_135px]">
        <div className="relative"><Search size={16} className="absolute left-3 top-3 text-muted-foreground"/>
          <input aria-label="Search textbook passages" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search full textbook text…" className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm"/></div>
        <select aria-label="Filter textbook topic" value={topic} onChange={e=>setTopic(e.target.value as typeof topic)} className="rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">All topics</option>{BIOLOGY_TOPICS.map(x=><option key={x} value={x}>{label(x)}</option>)}</select>
        <select aria-label="Filter printed page" value={page} onChange={e=>setPage(e.target.value)} className="rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">All pages</option>{Array.from({length:12},(_,i)=>316+i).map(p=><option key={p} value={p}>Page {p}</option>)}</select>
      </div>
      <p className="my-4 font-mono text-xs text-muted-foreground">{shown.length} passage chunks shown · {linkedIds.size} referenced by the question bank</p>
      <div className="space-y-3">
        {shown.map(chunk=><article key={chunk.id} id={chunk.id} className="scroll-mt-6 rounded-md border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className="rounded bg-muted px-2 py-1">p. {chunk.page} · PDF {chunk.pdfPage}</span>
            <span className="rounded bg-muted px-2 py-1">{label(chunk.topic)}</span>
            <span className="rounded bg-muted px-2 py-1">{chunk.kind}</span>
            {linkedIds.has(chunk.id)&&<span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">Question linked</span>}
          </div>
          <h2 className="mt-3 text-base font-semibold">{chunk.subtitle}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{chunk.original}</p>
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground"><strong>Extractive summary:</strong> {chunk.summary}</p>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">{chunk.id} · extracted source lines {chunk.sourceLineStart}–{chunk.sourceLineEnd}</p>
        </article>)}
      </div>
      {!shown.length&&<div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No passages match these filters.</div>}
    </div>
  </main>;
}
