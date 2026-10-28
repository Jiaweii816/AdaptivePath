"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { BookOpen,MessageCircle,Send,RotateCcw,ChevronRight } from "lucide-react";
import { CoachMarkdown } from "@/components/coach/coach-markdown";
import { Sidebar } from "@/components/layout/sidebar";
import { AppShell } from "@/components/layout/app-shell";
import { BiologyWorkbenchGrid } from "@/components/workbench/workbench-grid";
import { AssistantBubble, UserBubble } from "@/components/workbench/coach-bubbles";
import { ProblemStatement } from "@/components/workbench/problem-statement";
import { OPENSTAX_URL,type BiologyQuestion } from "./content";
import type { AttemptEvidence,LearnerProfile } from "./profile";
import { TextbookViewer } from "./textbook-viewer";
type SessionView={sessionId:string;attempts:AttemptEvidence[];messages:Array<{role:"student"|"tutor";content:string}>;
  profile:LearnerProfile;question:BiologyQuestion|null;completed:boolean;questionCount:number;feedback?:AttemptEvidence["evaluation"];
  reply?:string;provider?:"offline_rules"|"live_llm";tool?:string;modelReady:boolean;referenceUsed?:string[];error?:string};
const storageKey="adaptivepath.demo.session.v1";
export function AdaptivePathClient(){
  const [view,setView]=useState<SessionView|null>(null);
  const [option,setOption]=useState("");
  const [reasoning,setReasoning]=useState("");
  const [chat,setChat]=useState("");
  const [referenceOverride,setReferenceOverride]=useState<boolean|null>(null);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [lastFeedback,setLastFeedback]=useState<AttemptEvidence["evaluation"]|null>(null);
  const [providerStatus,setProviderStatus]=useState<"offline_rules"|"live_llm">("offline_rules");
  const [selectedTeachingTool,setSelectedTeachingTool]=useState("");
  const request=useCallback(async(payload:Record<string,unknown>):Promise<SessionView>=>{
    const response=await fetch("/api/adaptivepath",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json() as SessionView;
    if(!response.ok) throw new Error(result.error??"Request failed");
    return result;
  },[]);
  useEffect(()=>{let active=true;const saved=window.sessionStorage.getItem(storageKey);
    const task=saved?fetch("/api/adaptivepath?sessionId="+encodeURIComponent(saved)).then(async res=>{
      if(!res.ok) throw new Error("expired session");return await res.json() as SessionView;
    }).catch(()=>request({action:"start"})):request({action:"start"});
    task.then(result=>{if(active){setView(result);window.sessionStorage.setItem(storageKey,result.sessionId);}})
      .catch(e=>{if(active)setError(String(e));});
    return ()=>{active=false;};
  },[request]);
  const current=view?.question;
  const last=view?.attempts.at(-1);
  async function submit(){
    if(!view||!current||pending)return;
    setPending(true);setError("");
    try{
      const attemptId=crypto.randomUUID();
      const result=await request({action:"submit",sessionId:view.sessionId,questionId:current.id,
        selectedOption:option,studentReasoning:reasoning,attemptId});
      setView(result);setLastFeedback(result.feedback??null);setOption("");setReasoning("");setReferenceOverride(null);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
  }
  async function ask(){
    if(!view||!chat.trim()||pending)return;
    setPending(true);setError("");
    try{const result=await request({action:"chat",sessionId:view.sessionId,message:chat.trim()});setView(result);setProviderStatus(result.provider??"offline_rules");setSelectedTeachingTool(result.tool??"");setChat("");}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
  }
  async function toggleReference(){
    if(!view||!current||pending)return;
    if(referenceVisible){setReferenceOverride(false);return;}
    // The reference was already accessed for this activity (possibly before
    // a refresh). Visibility is purely UI state; assistance remains recorded.
    if(current.mode==="guided_practice" || view.referenceUsed?.includes(current.id)){
      setReferenceOverride(true);
      return;
    }
    setPending(true);setError("");
    try{
      const result=await request({action:"reference",sessionId:view.sessionId,questionId:current.id});
      setView(result);setReferenceOverride(true);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setPending(false);}
  }
  async function reset(){
    if(pending)return;setPending(true);setError("");
    try{const result=await request({action:"start"});setView(result);window.sessionStorage.setItem(storageKey,result.sessionId);
      setLastFeedback(null);setOption("");setReasoning("");setChat("");setSelectedTeachingTool("");setReferenceOverride(null);}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
  }
  const referenceVisible=referenceOverride??(current?.mode==="guided_practice");
  const referencePreviouslyAccessed=Boolean(current && view?.referenceUsed?.includes(current.id));
  return (
    <div className="pl-14">
      <Sidebar displayName="AdaptivePath" mode="overlay"/>
      <AppShell
        mode="biology"
        currentProblemLabel={current?.objective??"Characteristics and Traits"}
        headerActions={<div className="flex items-center gap-2">
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
            {view?.modelReady?"Live model configured":"Offline mode · model key not configured"}
          </span>
          <Link href="/adaptivepath/textbook" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Full textbook §12.2</Link>
          <Link href="/adaptivepath/profile" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">
            Learner Profile
          </Link>
          <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-muted">
            <RotateCcw size={14}/> Reset
          </button>
        </div>}
      >
        {error&&<p role="alert" className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <BiologyWorkbenchGrid
          left={
      <section aria-label="Problem Panel" className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:min-h-0">
        <div className="border-b border-slate-200 p-5"><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700"><BookOpen size={15}/> Question</div>
          <div className="mb-2 flex justify-between gap-2 text-xs text-slate-500"><span>{current?.id??"Complete"} · {current?.mode?.replace("_"," ")??"Session"}</span><span>{view?.attempts.length??0} submitted</span></div>
          <ProblemStatement dense problem={{slug:current?.id??"biology-complete",title:current?.id??"Completed",statementMarkdown:current?.prompt??"All available activities completed.",tags:current?[current.topic.replaceAll("_"," ")]:[],examples:[],constraints:[]}} />
          <p className="text-sm leading-6 text-slate-600">{current?.objective??"Review your learner profile and evidence history."}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-5"><div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">Textbook Reference</h3>
          {current&&<button type="button" onClick={()=>void toggleReference()} disabled={pending}
            aria-expanded={referenceVisible} aria-controls="adaptivepath-reference-content"
            className="text-xs font-semibold text-teal-700 underline disabled:opacity-50">
            {referenceVisible?"Hide reference":current.mode==="guided_practice" || referencePreviouslyAccessed?"Show reference":"Reveal reference (assisted)"}
          </button>}
        </div>
        <div id="adaptivepath-reference-content">
        {!referenceVisible?<p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          {referencePreviouslyAccessed
            ?"Reference hidden. It was already revealed for this question, so the attempt remains assisted."
            :"Reference hidden for independent assessment. Revealing it will mark this attempt as assisted."}
        </p>:
          <>
          {current?.mode!=="guided_practice"&&referencePreviouslyAccessed&&<p className="mb-3 text-xs font-medium text-amber-700">
            Reference accessed — this attempt is marked assisted, even if you hide the passage.
          </p>}
          {current && <TextbookViewer key={current.id} referenceIds={current.referenceIds}/> }

          </>}
        </div>
        <p className="mt-3 text-xs text-slate-500">Source: OpenStax Biology 2e, Section 12.2. Access for free at <a href={OPENSTAX_URL} target="_blank" rel="noreferrer" className="text-teal-700 underline">openstax.org</a>. CC BY-NC-SA 4.0.</p>
        </div>
      </section>
          }
          middle={
      <section aria-label="Student Workspace Panel" className="flex min-h-[720px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:mx-1 lg:min-h-0">
        <div className="border-b border-slate-200 p-5"><p className="text-xs font-bold uppercase tracking-wider text-teal-700">Student Workspace</p>
          <h2 className="mt-2 text-xl font-semibold">Think, select, and explain</h2>
          <p className="mt-1 text-sm text-slate-500">Your reasoning matters as much as your option.</p></div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {!view?<p className="text-sm">Loading session…</p>:current?<><fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Choose an answer</legend>
            {current.options.map(o=><label key={o.id} className={"flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm "+(option===o.id?"border-teal-600 bg-teal-50":"border-slate-200 hover:bg-slate-50")}>
              <input type="radio" name="biology-answer" checked={option===o.id} onChange={()=>setOption(o.id)}/>{o.text}</label>)}</fieldset>
            <label className="block text-sm font-semibold" htmlFor="reasoning">Explain your reasoning (Claim · Evidence · Reasoning)</label>
            <textarea id="reasoning" value={reasoning} onChange={e=>setReasoning(e.target.value)}
              placeholder="State your claim, use evidence about the alleles, and explain the mechanism…" rows={7}
              className="w-full resize-y rounded-lg border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-teal-600"/>
            <button onClick={submit} disabled={!option||reasoning.trim().length<12||pending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              Submit Answer <ChevronRight size={17}/></button></>:<div className="rounded-xl bg-teal-50 p-5 text-teal-900"><h3 className="font-semibold">Learning session completed</h3><p className="mt-2 text-sm">Open Learner Profile to inspect the independent transfer evidence.</p></div>}
          {lastFeedback&&<div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm"><p className="font-semibold">Previous evaluation · CER {lastFeedback.reasoningScore}/4</p><p className="mt-2">{lastFeedback.feedback}</p><p className="mt-2 text-xs text-slate-500">Evaluator: {lastFeedback.evaluator==="live_llm"?"Live model with deterministic guards":"Offline rules (not an AI assessment)"}</p></div>}
          {last&&<p className="text-xs text-slate-500">Latest submission: {last.questionId} · {last.assisted?"Assisted":"Independent"} · {last.evaluation.successful?"Reasoning supported":"Needs follow-up"}</p>}
        </div>
      </section>
          }
          right={
      <section aria-label="Coach Panel" className="flex min-h-[560px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:min-h-0">
        <div className="border-b border-slate-200 p-5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700"><MessageCircle size={16}/> AI Tutor Workspace</div>
          <h2 className="mt-2 text-lg font-semibold">Adaptive guidance</h2>
          <p className="mt-1 text-xs text-slate-500">Provider: {providerStatus==="live_llm"?"Live model":"Offline rules"} · Teaching tool: {selectedTeachingTool?selectedTeachingTool.replaceAll("_"," "):"evidence-based selection pending"}</p></div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="rounded-lg bg-slate-100 p-3 text-sm leading-6">Hi! Explain how you reached your answer. For independent questions, I can clarify instructions but will not reveal the solution.</div>
          {view?.messages.map((m,i)=>m.role==="student"?
            <UserBubble key={i}>{m.content}</UserBubble>:
            <AssistantBubble key={i}><CoachMarkdown markdown={m.content}/></AssistantBubble>)}
        </div>
        <form className="flex gap-2 border-t border-slate-200 p-4" onSubmit={e=>{e.preventDefault();void ask();}}>
          <input value={chat} onChange={e=>setChat(e.target.value)} aria-label="Message to tutor" placeholder="Ask your tutor a question…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600"/>
          <button type="submit" disabled={!chat.trim()||pending} aria-label="Send" className="rounded-lg bg-teal-700 px-3 text-white disabled:opacity-50"><Send size={17}/></button>
        </form>
      </section>
          }
        />
      </AppShell>
    </div>
  );
}
