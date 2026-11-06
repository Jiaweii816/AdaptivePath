"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { BIOLOGY_UNITS,FAMILIARITY,ONBOARDING_QUESTIONS,SUPPORT_PREFERENCES,type BiologyUnitId,type Familiarity,type SupportPreference } from "./catalog";
import type { BiologyOnboardingMetadata } from "./types";
type Reply={onboarding:BiologyOnboardingMetadata|null;error?:string};
async function api(payload:object,method:"GET"|"POST"):Promise<Reply>{
  const res=await fetch("/api/adaptivepath/onboarding",{
    method,cache:"no-store",headers:{"Content-Type":"application/json"},
    ...(method==="POST"?{body:JSON.stringify(payload)}:{}),
  });
  const body=await res.json() as Reply;
  if(!res.ok)throw new Error(body.error??"Onboarding request failed");
  return body;
}
const style:Record<SupportPreference,string>={
  socratic:"Guiding questions",
  step_by_step:"Small step-by-step hints",
  worked_example:"Worked examples on different problems",
  visual:"Textbook diagrams and references",
};
export function BiologyOnboardingPage(){
  const [units,setUnits]=useState<BiologyUnitId[]>([]);
  const [familiarity,setFamiliarity]=useState<Familiarity>("some");
  const [support,setSupport]=useState<SupportPreference>("socratic");
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [done,setDone]=useState<BiologyOnboardingMetadata|null>(null);
  const [error,setError]=useState("");
  const [pending,setPending]=useState(false);
  useEffect(()=>{
    let active=true;
    api({},"GET").then(result=>{if(active)setDone(result.onboarding)})
      .catch(e=>{if(active)setError(String(e))});
    return ()=>{active=false};
  },[]);
  const completed=ONBOARDING_QUESTIONS.filter(q=>Boolean(answers[q.id])).length;
  async function submit(skip:boolean){
    setPending(true);setError("");
    try{
      const payload=skip?{action:"skip"}:{action:"submit",submission:{
        studiedUnits:units,geneticsFamiliarity:familiarity,
        supportPreference:support,responses:answers,
      }};
      setDone((await api(payload,"POST")).onboarding);
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setPending(false)}
  }
  return <main className="min-h-screen bg-background px-4 py-7 text-foreground">
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/adaptivepath" className="text-sm text-primary underline">Back to Biology Workbench</Link>
      <header><h1 className="text-2xl font-semibold">Your Biology learning starting point</h1>
        <p className="mt-2 text-sm text-muted-foreground">About five minutes. This is not a whole-book mastery exam.</p>
      </header>
      <aside className="rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
        <strong>Privacy first.</strong> No name, email, or free-text personal details are requested.
        Only structured learning metadata is saved in the local database.
        Raw onboarding answers are not sent to an external AI. This step is optional.
      </aside>
      {error&&<p role="alert" className="rounded-md border border-red-300 p-3 text-sm text-red-700">{error}</p>}
      {done?<section aria-label="Onboarding complete" className="space-y-4 rounded-md border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">{done.status==="skipped"?"Onboarding skipped":"Initial learning context saved"}</h2>
        <p className="text-sm text-muted-foreground">Your Coach can now use the initial context for its local teaching policy.
          All existing L2 mastery levels remain unassessed until regular practice.</p>
        <p className="text-sm">Initial prerequisite checks: {done.diagnosticCount} · Concept signals: {done.conceptSignals.length}</p>
        <div className="flex flex-wrap gap-3">
          <Link className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white" href="/adaptivepath/profile">Open learner profile</Link>
          <Link className="rounded-md border border-border px-4 py-2 text-sm" href="/adaptivepath">Start practice</Link>
          <button className="text-sm underline" type="button" onClick={()=>setDone(null)}>Update</button>
        </div>
      </section>:<form className="space-y-5" onSubmit={e=>{e.preventDefault();if(completed===5)void submit(false)}}>
        <section className="space-y-4 rounded-md border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">1. Whole-book background</h2>
          <p className="text-sm text-muted-foreground">Which Biology 2e units have you studied? Choose any, or leave blank if unsure.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {BIOLOGY_UNITS.map(u=><label key={u.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm">
              <input type="checkbox" checked={units.includes(u.id)} onChange={e=>setUnits(xs=>e.target.checked?[...xs,u.id]:xs.filter(x=>x!==u.id))}/>
              <span>{u.title} <span className="text-xs text-muted-foreground">Ch. {u.chapters}</span></span>
            </label>)}
          </div>
          <label className="block space-y-2 text-sm"><span className="font-semibold">Genetics familiarity</span>
            <select aria-label="Genetics familiarity" className="block w-full rounded-md border border-input bg-background p-2" value={familiarity} onChange={e=>setFamiliarity(e.target.value as Familiarity)}>
              {FAMILIARITY.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="block space-y-2 text-sm"><span className="font-semibold">Preferred teaching style</span>
            <select aria-label="Preferred teaching style" className="block w-full rounded-md border border-input bg-background p-2" value={support} onChange={e=>setSupport(e.target.value as SupportPreference)}>
              {SUPPORT_PREFERENCES.map(v=><option key={v} value={v}>{style[v]}</option>)}
            </select>
          </label>
        </section>
        <section className="space-y-5 rounded-md border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">2. Five quick §12.2 prerequisite checks</h2>
          <p className="text-sm text-muted-foreground">Based on Biology 2e Chapters 3, 4, 11 and 12. {completed}/5 answered.</p>
          {ONBOARDING_QUESTIONS.map((q,i)=><fieldset key={q.id} className="rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">Question {i+1}</legend>
            <p className="mb-3 text-sm font-semibold">{q.prompt}</p>
            <div className="space-y-2">{q.choices.map(c=><label key={c.id} className="flex cursor-pointer gap-3 rounded-md bg-muted p-2 text-sm">
              <input type="radio" name={q.id} checked={answers[q.id]===c.id} onChange={()=>setAnswers(a=>({...a,[q.id]:c.id}))}/>
              <span>{c.id}. {c.text}</span>
            </label>)}</div>
            <p className="mt-2 text-xs text-muted-foreground">Source: {q.source} ({q.sourcePages})</p>
          </fieldset>)}
        </section>
        <div className="flex justify-between gap-3">
          <button type="button" disabled={pending} onClick={()=>void submit(true)} className="rounded-md border border-border px-4 py-2 text-sm">Skip</button>
          <button type="submit" disabled={pending||completed!==5} className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40">{pending?"Saving…":"Save initial context"}</button>
        </div>
      </form>}
    </div>
  </main>;
}
