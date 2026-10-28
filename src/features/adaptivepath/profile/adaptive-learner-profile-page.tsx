"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, BrainCircuit, ChevronRight, ClipboardList, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { LedgerStrip, type LedgerStripCell } from "@/features/profile/ledger/components/ledger-strip";
import { LedgerTier } from "@/features/profile/ledger/components/ledger-tier";
import { PagedList } from "@/features/profile/ledger/components/paged-list";
import { BIOLOGY_QUESTIONS, getQuestion, getReference, type BiologyTopic } from "../content";
import { deriveProfile, MISCONCEPTION_LABELS, type AttemptEvidence, type LearnerProfile, type MisconceptionStatus } from "../profile";

const SESSION_KEY = "adaptivepath.demo.session.v1";
const TOPIC_NAMES: Record<BiologyTopic,string> = {
  genotype_phenotype: "Genotype & phenotype",
  allele_segregation: "Allele segregation",
};
const FILTERS = [
  { key: "all", label: "All evidence" },
  { key: "diagnostic", label: "Diagnostic" },
  { key: "guided_practice", label: "Guided practice" },
  { key: "transfer", label: "Transfer" },
];
const human = (value:string) => value.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase());
type SessionView = {
  sessionId: string;
  attempts: AttemptEvidence[];
  profile: LearnerProfile;
  question: { id:string } | null;
  error?:string;
};

function pillClass(status:string) {
  if (status==="stable" || status==="resolved" || status==="strong")
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status==="confirmed" || status==="limited")
    return "border-rose-200 bg-rose-50 text-rose-800";
  if (status==="suspected" || status==="emerging" || status==="partial")
    return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}
function Status({value}:{value:string}) {
  return <span className={"inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize " + pillClass(value)}>{human(value)}</span>;
}
function summaryCells(attempts:AttemptEvidence[],profile:LearnerProfile):LedgerStripCell[] {
  const independent=attempts.filter(a=>!a.assisted);
  const transfer=attempts.filter(a=>getQuestion(a.questionId)?.mode==="transfer");
  const successful=transfer.filter(a=>!a.assisted&&a.evaluation.successful);
  const assisted=attempts.filter(a=>a.assisted);
  const unresolved=Object.values(profile.misconceptions).filter(x=>x==="suspected"||x==="confirmed").length;
  const average=attempts.length
    ? Number((attempts.reduce((n,a)=>n+a.evaluation.reasoningScore,0)/attempts.length).toFixed(1)) : 0;
  return [
    {label:"Evidence",value:attempts.length,note:"submitted attempts",tone:"primary"},
    {label:"Independent",value:independent.length,note:"without reference or hint"},
    {label:"Assisted",value:assisted.length,note:"reference or hint used"},
    {label:"Transfer",value:successful.length,note:"successful independent tasks",tone:"primary"},
    {label:"CER mean",value:average,note:attempts.length?"out of 4 · provisional":"no responses yet"},
    {label:"Open signals",value:unresolved,note:"suspected or confirmed",tone:unresolved?"warn":undefined},
    {label:"Practice",value:attempts.filter(a=>getQuestion(a.questionId)?.mode==="guided_practice").length,note:"guided activity attempts"},
  ];
}

function LearningField({label,value,detail}:{label:string;value:string;detail:string}) {
  return <div className="rounded-md border border-border bg-card p-4">
    <dt className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[.09em] text-muted-foreground">{label}</dt>
    <dd className="text-base font-semibold">{value}</dd>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
  </div>;
}

function TopicCard({topic,profile,attempts}:{topic:BiologyTopic;profile:LearnerProfile;attempts:AttemptEvidence[]}) {
  const current=profile.mastery[topic];
  const evidence=attempts.filter(a=>getQuestion(a.questionId)?.topic===topic);
  const completed=Math.min(current.independentTransferSuccesses,2);
  return <div className="rounded-md border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{TOPIC_NAMES[topic]}</h3>
      <Status value={current.mastery}/>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{current.evidenceCount} recorded answers · {evidence.filter(a=>a.assisted).length} assisted</p>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100" role="progressbar" aria-label={TOPIC_NAMES[topic]+" independent transfer evidence"} aria-valuemin={0} aria-valuemax={2} aria-valuenow={completed}>
      <div className="h-full rounded-full bg-emerald-700 transition-all" style={{width:String(completed/2*100)+"%"}}/>
    </div>
    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
      <span>Independent transfer evidence</span><span className="font-mono font-semibold">{completed}/2 tasks</span>
    </div>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">Stable requires two distinct successful independent transfer tasks for this topic. Assisted work is shown but not counted.</p>
  </div>;
}

function MisconceptionCard({tag,status,attempts}:{tag:string;status:MisconceptionStatus;attempts:AttemptEvidence[]}) {
  const sources=attempts.filter(a=>a.evaluation.misconceptionTags.includes(tag));
  return <details className="group rounded-md border border-l-[3px] border-border border-l-amber-500 bg-card">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
      <div><p className="text-sm font-semibold">{MISCONCEPTION_LABELS[tag]??human(tag)}</p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{sources.length} flagged answer(s) · inspect evidence</p></div>
      <div className="flex items-center gap-2"><Status value={status}/><ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"/></div>
    </summary>
    <div className="space-y-2 border-t border-border p-4">
      <p className="text-xs leading-5 text-muted-foreground">One signal may be suspected. Confirmation requires sufficient explicit or repeated evidence; resolving it needs independent evidence.</p>
      {sources.map(a=><div key={a.id} className="rounded border border-border bg-muted/20 p-3 text-xs">
        <span className="font-semibold">{a.questionId} · {a.assisted?"Assisted":"Independent"} · CER {a.evaluation.reasoningScore}/4</span>
        <p className="mt-2 whitespace-pre-wrap text-foreground/80">{a.studentReasoning}</p>
      </div>)}
    </div>
  </details>;
}

function EvidenceRow({attempt,index,previous,current}:{attempt:AttemptEvidence;index:number;previous:LearnerProfile;current:LearnerProfile}) {
  const question=getQuestion(attempt.questionId);
  const chosen=question?.options.find(x=>x.id===attempt.selectedOption);
  const topic=question?.topic ?? "genotype_phenotype";
  const changed:string[]=[];
  if(previous.priorKnowledge!==current.priorKnowledge) changed.push("Prior knowledge: "+human(previous.priorKnowledge)+" → "+human(current.priorKnowledge));
  if(previous.mastery[topic].mastery!==current.mastery[topic].mastery)
    changed.push("Mastery: "+human(previous.mastery[topic].mastery)+" → "+human(current.mastery[topic].mastery));
  if(previous.support!==current.support) changed.push("Support: "+human(previous.support)+" → "+human(current.support));
  if(previous.certainty!==current.certainty) changed.push("Certainty: "+human(previous.certainty)+" → "+human(current.certainty));
  for(const tag of Object.keys(current.misconceptions)){
    if(current.misconceptions[tag]!==previous.misconceptions[tag])
      changed.push((MISCONCEPTION_LABELS[tag]??tag)+": "+human(previous.misconceptions[tag])+" → "+human(current.misconceptions[tag]));
  }
  return <details className="group rounded-md border border-border bg-card">
    <summary className="cursor-pointer list-none px-4 py-3 hover:bg-muted/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] text-muted-foreground">EVIDENCE #{index+1} · {question?.mode?human(question.mode):"Unknown mode"} · {TOPIC_NAMES[topic]}</p>
          <p className="mt-1.5 text-sm font-semibold">{attempt.questionId}: {question?.prompt??"Activity not found"}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">{attempt.submittedAt?new Date(attempt.submittedAt).toLocaleString("en-US")+" · ":""}{attempt.assisted?"Assisted attempt":"Independent attempt"} · {attempt.evaluation.evaluator==="live_llm"?"LLM-evaluated":"Rule-evaluated (provisional)"} · {attempt.evaluation.successful?"Reasoning supported":"Needs more evidence"}</p>
        </div>
        <div className="flex items-center gap-3"><span className="rounded border border-border px-2 py-1 font-mono text-xs font-bold">CER {attempt.evaluation.reasoningScore}/4</span><ChevronRight className="h-4 w-4 text-primary transition-transform group-open:rotate-90"/></div>
      </div>
    </summary>
    <div className="space-y-4 border-t border-border px-4 pb-4 pt-4 text-sm">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected answer</p>
        <p className="mt-1">{chosen?.text??attempt.selectedOption}</p></div>
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Student reasoning · CER evidence</p>
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/30 p-3 leading-6">{attempt.studentReasoning}</p></div>
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feedback</p>
        <p className="mt-1 leading-6 text-foreground/80">{attempt.evaluation.feedback}</p></div>
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profile transition after this attempt</p>
        {changed.length?<ul className="mt-2 list-inside list-disc space-y-1 text-xs">{changed.map(item=><li key={item}>{item}</li>)}</ul>:
          <p className="mt-1 text-xs text-muted-foreground">No status change. The attempt still contributes evidence and may affect future decisions.</p>}
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">Linked textbook: {question?.referenceIds.map(id=>{
        const source=getReference(id);return source?"§"+source.section+" printed p. "+source.page:"Reference unavailable";
      }).join(" · ")??"Unknown"} · Source text remains in the Workbench.</p>
    </div>
  </details>;
}

function EmptyState({title,body}:{title:string;body:string}) {
  return <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
    <p className="font-semibold text-foreground">{title}</p><p className="mt-2 leading-6">{body}</p>
  </div>;
}

export function AdaptiveLearnerProfilePage() {
  const [session,setSession]=useState<SessionView|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    const id=window.sessionStorage.getItem(SESSION_KEY);
    if(!id){setLoading(false);return;}
    fetch("/api/adaptivepath?sessionId="+encodeURIComponent(id),{cache:"no-store"})
      .then(async response=>{
        if(!response.ok)throw new Error("Unable to read this learner session ("+response.status+").");
        return response.json() as Promise<SessionView>;
      }).then(data=>{if(active)setSession(data);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);
  const attempts=session?.attempts??[];
  const profile=session?.profile;
  const snapshots=useMemo(()=>attempts.map((a,index)=>({
    attempt:a,
    previous:deriveProfile(attempts.slice(0,index)),
    current:deriveProfile(attempts.slice(0,index+1)),
  })),[attempts]);
  const stats=useMemo(()=>profile?summaryCells(attempts,profile):[],[attempts,profile]);
  const signals=profile?Object.entries(profile.misconceptions).filter(([,status])=>status!=="none"):[];
  const filters=snapshots.map(row=>getQuestion(row.attempt.questionId)?.mode??"diagnostic");
  const latest=attempts.at(-1);
  return <div className="min-h-screen bg-background text-foreground">
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 lg:px-8">
      <nav className="mb-6 flex items-center justify-between gap-3">
        <Link href="/adaptivepath" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="h-4 w-4"/> Back to Biology Workbench</Link>
        <span className="font-mono text-xs text-muted-foreground">AdaptivePath · Biology 2e §12.2</span>
      </nav>
      <PageHeader title="Dynamic Learner Profile"
        description="An evidence-linked view of what the system currently knows, how it learned it, and what support comes next."
        actions={<span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-mono text-xs font-semibold text-emerald-800">
          <ShieldCheck className="h-3.5 w-3.5"/> Deterministic profile rules
        </span>}/>
      {loading?<EmptyState title="Loading learner evidence…" body="Reading this tab's Biology session from the existing API."/>:
        error?<EmptyState title="Unable to load the session" body={error}/>:
        !session?<div className="mt-5"><EmptyState title="No Biology session in this tab" body="Start answering Biology questions in the Workbench, then return here. This page never invents a learner profile."/></div>:
        profile&&<div>
          <LedgerStrip cells={stats}/>
          <div className="mt-5 rounded-md border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold">Current instructional decision</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">Support is selected from persisted response evidence, not a demo account or fixed script.</p></div>
              <div className="flex flex-wrap items-center gap-2"><Status value={profile.support}/><Status value={profile.certainty}/></div>
            </div>
            <p className="mt-3 text-sm leading-6">
              {profile.support==="probe"?"Collect additional independent diagnostic evidence before increasing certainty.":
                profile.support==="guided_hint"?"Offer a targeted hint based on the most recent evidence, then request reasoning again.":
                profile.support==="worked_example"?"Provide a worked example during practice, then reassess with an independent transfer.":
                profile.support==="extra_practice"?"Schedule another practice opportunity before an independent assessment.":
                "Continue with independent practice or transfer, and only promote mastery after the evidence threshold is met."}
            </p>
          </div>

          <div className="mt-6">
            <LedgerTier id="L3" title="Validated learner state" count="five pitch fields · topic-level mastery">
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <LearningField label="Prior knowledge" value={attempts.length===0?"Not assessed":human(profile.priorKnowledge)} detail="Updated from diagnostic performance, not inferred from a single choice."/>
                <LearningField label="Mastery" value={Object.values(profile.mastery).filter(x=>x.mastery==="stable").length+" / "+Object.keys(profile.mastery).length+" topics stable"} detail="Per-topic status · see independent transfer gates below."/>
                <LearningField label="Misconceptions" value={String(signals.filter(([,s])=>s==="suspected"||s==="confirmed").length)+" open signals"} detail="Suspected, confirmed and resolved evidence are distinguished."/>
                <LearningField label="Support" value={human(profile.support)} detail="Current adaptive instructional strategy."/>
                <div className="sm:col-span-2 xl:col-span-4"><LearningField label="Certainty" value={human(profile.certainty)} detail="Confidence label from the rules, not a calibrated probability or AI self-rating."/></div>
              </dl>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {(Object.keys(profile.mastery) as BiologyTopic[]).map(topic=>
                  <TopicCard key={topic} topic={topic} profile={profile} attempts={attempts}/>)}
              </div>
            </LedgerTier>

            <LedgerTier id="L2" title="Misconception evidence" count={String(signals.length)+" tagged mechanisms · no unsupported confirmations"}>
              {signals.length?<div className="grid gap-2">{signals.map(([tag,status])=>
                <MisconceptionCard key={tag} tag={tag} status={status} attempts={attempts}/>)}</div>:
                <EmptyState title="No misconception tags recorded" body="This does not prove misconception-free mastery. The system needs actual student responses before making stronger claims."/>}
            </LedgerTier>

            <LedgerTier id="EP" title="Evidence episodes" count={String(attempts.length)+" submitted answer(s) · chronological order"}>
              {attempts.length?<PagedList filters={FILTERS} groupOf={filters} noun="attempts">
                {snapshots.map((row,i)=><EvidenceRow key={row.attempt.id} attempt={row.attempt} index={i} previous={row.previous} current={row.current}/>)}
              </PagedList>:<EmptyState title="No answer episodes yet" body="Return to the Workbench and submit a question with both an option and a written CER explanation."/>}
            </LedgerTier>

            <LedgerTier id="L1" title="Rule and source audit" count="explicit transition gates · reconstructed evidence" terminal last>
              <div className="grid gap-3 rounded-md border border-border bg-card p-5 text-sm leading-6 md:grid-cols-2">
                <div><p className="mb-2 flex items-center gap-2 font-semibold"><BrainCircuit className="h-4 w-4 text-primary"/> Evidence-based promotion</p>
                  <p>Stable Mastery requires <strong>two distinct successful independent transfers</strong> in the same topic. Assisted attempts and repeated questions cannot satisfy that gate.</p>
                </div>
                <div><p className="mb-2 flex items-center gap-2 font-semibold"><ClipboardList className="h-4 w-4 text-primary"/> Transparent limitations</p>
                  <p>Historical transitions are recalculated from persisted attempts using current rules. CER is {attempts.some(a=>a.evaluation.evaluator==="live_llm")?"a mix of model and offline-rule evaluations":"currently an offline heuristic"}; a score is not a validated measure of understanding.</p>
                </div>
                <div><p className="mb-2 flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4 text-primary"/> Most recent evidence</p>
                  <p>{latest?latest.questionId+" · "+(latest.assisted?"assisted":"independent")+" · CER "+latest.evaluation.reasoningScore+"/4":"No completed activity."}</p>
                </div>
                <div><p className="mb-2 flex items-center gap-2 font-semibold"><ArrowUpRight className="h-4 w-4 text-primary"/> Next activity</p>
                  <p>{session.question?session.question.id+": "+(BIOLOGY_QUESTIONS.find(q=>q.id===session.question?.id)?.objective??"Continue learning"):"Current activity sequence complete."}</p>
                </div>
              </div>
            </LedgerTier>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">Interface design reused from PatternCoach's Evidence Ledger components. Biology profile data comes from this session's persisted submissions, not the original LeetCode learner ledger.</p>
        </div>}
    </main>
  </div>;
}
