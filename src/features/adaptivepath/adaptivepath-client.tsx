"use client";
import { useCallback,useEffect,useState } from "react";
import { BookOpen,Brain,MessageCircle,Send,RotateCcw,ChevronRight } from "lucide-react";
import { CoachMarkdown } from "@/components/coach/coach-markdown";
import { OPENSTAX_URL,TEXTBOOK_CHUNKS,type BiologyQuestion } from "./content";
import type { AttemptEvidence,LearnerProfile } from "./profile";
type SessionView={sessionId:string;attempts:AttemptEvidence[];messages:Array<{role:"student"|"tutor";content:string}>;
  profile:LearnerProfile;question:BiologyQuestion|null;completed:boolean;questionCount:number;feedback?:AttemptEvidence["evaluation"];
  reply?:string;provider?:"offline_rules"|"live_llm";modelReady:boolean;error?:string};
const storageKey="adaptivepath.demo.session.v1";
const human=(s:string)=>s.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
export function AdaptivePathClient(){
  const [view,setView]=useState<SessionView|null>(null);
  const [option,setOption]=useState("");
  const [reasoning,setReasoning]=useState("");
  const [chat,setChat]=useState("");
  const [profileOpen,setProfileOpen]=useState(false);
  const [referenceOpen,setReferenceOpen]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [lastFeedback,setLastFeedback]=useState<AttemptEvidence["evaluation"]|null>(null);
  const [providerStatus,setProviderStatus]=useState<"offline_rules"|"live_llm">("offline_rules");
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
      setView(result);setLastFeedback(result.feedback??null);setOption("");setReasoning("");setReferenceOpen(false);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
  }
  async function ask(){
    if(!view||!chat.trim()||pending)return;
    setPending(true);setError("");
    try{const result=await request({action:"chat",sessionId:view.sessionId,message:chat.trim()});setView(result);setProviderStatus(result.provider??"offline_rules");setChat("");}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
  }
  async function revealReference(){
    if(!view||!current||pending)return;setPending(true);setError("");
    try{const result=await request({action:"reference",sessionId:view.sessionId,questionId:current.id});setView(result);setReferenceOpen(true);}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
  }
  async function reset(){
    if(pending)return;setPending(true);setError("");
    try{const result=await request({action:"start"});setView(result);window.sessionStorage.setItem(storageKey,result.sessionId);
      setLastFeedback(null);setOption("");setReasoning("");setChat("");setReferenceOpen(false);}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
  }
  const refs=current?.referenceIds.map(id=>TEXTBOOK_CHUNKS.find(chunk=>chunk.id===id)).filter(chunk=>chunk!==undefined)??[];
  const diagnosticLocked=current?.mode!=="guided_practice"&&!referenceOpen;
  return <main className="min-h-screen bg-[#f6f8fa] text-slate-900">
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-7">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-700 text-white"><Brain size={22}/></div>
      <div><h1 className="text-lg font-bold tracking-tight">AdaptivePath</h1>
      <p className="text-xs text-slate-500">Biology 2e · Section 12.2 · Characteristics and Traits</p></div></div>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800">{view?.modelReady?"Live model configured":"Offline mode · model key not configured"}</span>
        <button onClick={()=>setProfileOpen(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">Learner Profile</button>
        <button onClick={reset} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"><RotateCcw size={14}/> Reset</button>
      </div>
    </header>
    {error&&<p role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="grid min-h-[calc(100vh-5rem)] grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(250px,1fr)_minmax(330px,1.25fr)_minmax(280px,1fr)] lg:gap-4 lg:p-5">
      <section className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5"><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700"><BookOpen size={15}/> Question</div>
          <div className="mb-2 flex justify-between gap-2 text-xs text-slate-500"><span>{current?.id??"Complete"} · {current?.mode?.replace("_"," ")??"Session"}</span><span>{view?.attempts.length??0} submitted</span></div>
          <h2 className="mb-3 text-lg font-semibold leading-7">{current?.prompt??"All available activities completed."}</h2>
          <p className="text-sm leading-6 text-slate-600">{current?.objective??"Review your learner profile and evidence history."}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-5"><div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">Textbook Reference</h3>
          {diagnosticLocked&&<button onClick={()=>void revealReference()} className="text-xs font-semibold text-teal-700 underline">Reveal reference (assisted)</button>}
        </div>
        {diagnosticLocked?<p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Reference hidden for independent assessment. You may reveal it, but this will mark the attempt as assisted.</p>:
          refs.map(ref=><article key={ref.id} className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-xs font-semibold text-teal-700">{ref.subtitle} · Printed p. {ref.page} · PDF p. {ref.pdfPage}</p>
            <p className="text-sm leading-6 text-slate-700">{ref.original}</p>
          </article>)}
        <p className="mt-3 text-xs text-slate-500">Source: OpenStax Biology 2e, Section 12.2. Access for free at <a href={OPENSTAX_URL} target="_blank" rel="noreferrer" className="text-teal-700 underline">openstax.org</a>. CC BY-NC-SA 4.0.</p>
        </div>
      </section>
      <section className="flex min-h-[480px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
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
      <section className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700"><MessageCircle size={16}/> AI Tutor Workspace</div>
          <h2 className="mt-2 text-lg font-semibold">Adaptive guidance</h2>
          <p className="mt-1 text-xs text-slate-500">Provider: {providerStatus==="live_llm"?"Live model":"Offline rules"} · independent-mode answer guard</p></div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="rounded-lg bg-slate-100 p-3 text-sm leading-6">Hi! Explain how you reached your answer. For independent questions, I can clarify instructions but will not reveal the solution.</div>
          {view?.messages.map((m,i)=><div key={i} className={"rounded-lg p-3 text-sm "+(m.role==="student"?"ml-6 bg-teal-100":"mr-6 bg-slate-100")}>
            <p className="mb-1 text-[11px] font-semibold uppercase text-slate-500">{m.role==="student"?"You":"Tutor · offline"}</p>
            {m.role==="tutor"?<CoachMarkdown markdown={m.content}/>:<p className="whitespace-pre-wrap">{m.content}</p>}</div>)}
        </div>
        <form className="flex gap-2 border-t border-slate-200 p-4" onSubmit={e=>{e.preventDefault();void ask();}}>
          <input value={chat} onChange={e=>setChat(e.target.value)} aria-label="Message to tutor" placeholder="Ask your tutor a question…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600"/>
          <button type="submit" disabled={!chat.trim()||pending} aria-label="Send" className="rounded-lg bg-teal-700 px-3 text-white disabled:opacity-50"><Send size={17}/></button>
        </form>
      </section>
    </div>
    {profileOpen&&<div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={()=>setProfileOpen(false)}>
      <aside aria-label="Learner Profile" className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">Dynamic Learner Profile</h2>
        <button onClick={()=>setProfileOpen(false)} className="text-sm text-teal-700">Close</button></div>
        {view&&<><p className="mb-5 text-sm text-slate-600">Derived from actual submitted answers and persisted attempt evidence.</p>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-slate-500">Prior Knowledge</dt><dd className="font-semibold">{human(view.profile.priorKnowledge)}</dd></div>
            <div><dt className="text-slate-500">Support</dt><dd className="font-semibold">{human(view.profile.support)}</dd></div>
            <div><dt className="text-slate-500">Certainty</dt><dd className="font-semibold">{human(view.profile.certainty)}</dd></div>
          </dl><h3 className="mb-2 mt-6 font-semibold">Mastery by topic</h3>
          {Object.entries(view.profile.mastery).map(([topic,p])=><div key={topic} className="mb-2 rounded-lg border p-3 text-sm">
            <p className="font-semibold">{human(topic)}: {human(p.mastery)}</p>
            <p className="text-xs text-slate-500">{p.independentTransferSuccesses}/2 distinct successful independent transfers · {p.evidenceCount} attempts</p></div>)}
          <h3 className="mb-2 mt-6 font-semibold">Misconceptions</h3>{Object.entries(view.profile.misconceptions).map(([key,status])=>
            status!=="none"?<p key={key} className="mb-2 rounded-lg border p-3 text-sm">{human(key)} · {human(status)}</p>:null)}
          <h3 className="mb-2 mt-6 font-semibold">Evidence history</h3>
          {view.profile.latestEvidence.length?view.profile.latestEvidence.map((s,i)=><p key={i} className="mb-2 rounded-lg bg-slate-50 p-3 text-sm">{s}</p>):<p className="text-sm text-slate-500">No submissions yet</p>}
          </>}
      </aside></div>}
  </main>;
}
