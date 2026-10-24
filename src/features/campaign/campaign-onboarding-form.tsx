"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Check, Loader2 } from "lucide-react";
import { englishSystemText } from "@/lib/system-copy";

type NodeOption = Readonly<{
  nodeId: string;
  name: string;
  mechanism: string;
  requiredPrerequisites: readonly string[];
}>;

type FieldErrors = Readonly<Record<string, readonly string[]>>;

function browserCampaignDate(timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
  } catch {
    return null;
  }
}

export function CampaignOnboardingForm({
  nodes,
  conflict,
}: {
  nodes: readonly NodeOption[];
  conflict: boolean;
}) {
  const router = useRouter();
  const idempotencyToken = useRef(crypto.randomUUID());
  const [endDate, setEndDate] = useState("");
  const [dailyQuestionBudget, setDailyQuestionBudget] = useState("3");
  const [timezone, setTimezone] = useState("");
  const [weakNodes, setWeakNodes] = useState<readonly string[]>([]);
  const [preferredNodes, setPreferredNodes] = useState<readonly string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
      setClientReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggle(values: readonly string[], nodeId: string, checked: boolean) {
    return checked
      ? [...new Set([...values, nodeId])]
      : values.filter((value) => value !== nodeId);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    const budget = Number(dailyQuestionBudget);
    const currentCampaignDate = browserCampaignDate(timezone);
    const clientErrors: Record<string, string[]> = {};
    if (!endDate) clientErrors.endDate = ["Choose an interview-preparation end date."];
    else if (currentCampaignDate && endDate < currentCampaignDate) clientErrors.endDate = ["The end date cannot be before today."];
    if (!Number.isInteger(budget) || budget < 3) clientErrors.dailyQuestionBudget = ["The daily task budget must be a whole number of at least 3."];
    if (!currentCampaignDate) clientErrors.timezone = ["Enter a valid IANA time zone."];
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setFormError("Correct the marked fields before creating a Campaign.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/campaign/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endDate,
          dailyQuestionBudget: budget,
          language: "Python",
          timezone,
          selfReportedWeakNodes: weakNodes,
          preferredNodes,
          idempotencyToken: idempotencyToken.current,
        }),
      });
      const result = await response.json() as {
        ok: boolean;
        error?: string;
        fieldErrors?: FieldErrors;
      };
      if (!response.ok || !result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(englishSystemText(result.error, "The Campaign could not be created. Check the input and try again."));
        return;
      }
      router.push("/campaign/today");
      router.refresh();
    } catch {
      setFormError("The Campaign could not be created right now. Your input is still on this page; try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  if (conflict) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <section aria-live="assertive" className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">A new Campaign cannot be created</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Multiple active Campaigns were found. The system will not choose one at random or create another.</p>
          <Link className="mt-6 inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium" href="/campaign/today">Back to Campaign Today</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Campaign Onboarding</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Create Campaign</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">PatternCoach builds a route from your end date, daily task budget, and learning nodes. Every plan is measured in tasks.</p>
      </header>

      <form className="mt-8 space-y-6" onSubmit={submit}>
        <section aria-labelledby="campaign-basics" className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <h2 id="campaign-basics" className="text-lg font-semibold">Campaign basics</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Field label="Preparation end date" error={fieldErrors.endDate?.[0]} htmlFor="campaign-end-date">
              <div className="relative">
                <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input aria-describedby="campaign-end-date-description" aria-invalid={Boolean(fieldErrors.endDate)} className="min-h-10 w-full rounded-md border border-border bg-background pl-10 pr-3 text-sm" id="campaign-end-date" name="endDate" onChange={(event) => setEndDate(event.target.value)} required type="date" value={endDate} />
              </div>
            </Field>
            <Field label="Daily task budget" error={fieldErrors.dailyQuestionBudget?.[0]} help="Enter a whole number of tasks; the minimum is 3." htmlFor="campaign-budget">
              <input aria-describedby="campaign-budget-description" aria-invalid={Boolean(fieldErrors.dailyQuestionBudget)} className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" id="campaign-budget" inputMode="numeric" min={3} name="dailyQuestionBudget" onChange={(event) => setDailyQuestionBudget(event.target.value)} required step={1} type="number" value={dailyQuestionBudget} />
            </Field>
            <Field label="Programming language" error={fieldErrors.language?.[0]} help="Campaign currently supports Python only." htmlFor="campaign-language">
              <input aria-describedby="campaign-language-description" className="min-h-10 w-full rounded-md border border-border bg-muted/40 px-3 text-sm" id="campaign-language" readOnly value="Python" />
            </Field>
            <Field label="Time zone" error={fieldErrors.timezone?.[0]} help="Used to calculate each Campaign date consistently. Confirm the browser-detected value." htmlFor="campaign-timezone">
              <input aria-describedby="campaign-timezone-description" aria-invalid={Boolean(fieldErrors.timezone)} className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" id="campaign-timezone" name="timezone" onChange={(event) => setTimezone(event.target.value)} placeholder="For example: America/Chicago" required value={timezone} />
            </Field>
          </div>
        </section>

        <NodeSelection title="Self-reported weak areas (optional)" description="These nodes receive a limited initial priority increase; they are not recorded as weakness facts." name="weakNodes" nodes={nodes} selected={weakNodes} onToggle={(nodeId, checked) => setWeakNodes(toggle(weakNodes, nodeId, checked))} error={fieldErrors.selfReportedWeakNodes?.[0]} />
        <NodeSelection title="Preferred learning nodes (optional)" description="These are scheduled earlier when possible while always respecting required prerequisites." name="preferredNodes" nodes={nodes} selected={preferredNodes} onToggle={(nodeId, checked) => setPreferredNodes(toggle(preferredNodes, nodeId, checked))} error={fieldErrors.preferredNodes?.[0]} />

        {formError ? <p aria-live="assertive" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{formError}</p> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">LeetCode history import will be available later. This setup does not fabricate exposure or mastery evidence.</p>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60" disabled={!clientReady || submitting} type="submit">
            {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
            {submitting ? "Creating…" : "Create Campaign"}
            {!submitting ? <ArrowRight aria-hidden="true" className="h-4 w-4" /> : null}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({ children, label, htmlFor, error, help }: { children: React.ReactNode; label: string; htmlFor: string; error?: string; help?: string }) {
  const descriptionId = `${htmlFor}-description`;
  return <div><label className="mb-2 block text-sm font-medium" htmlFor={htmlFor}>{label}</label>{children}<p className={`mt-1.5 text-xs ${error ? "text-red-700" : "text-muted-foreground"}`} id={descriptionId}>{error ?? help}</p></div>;
}

function NodeSelection({ title, description, name, nodes, selected, onToggle, error }: { title: string; description: string; name: string; nodes: readonly NodeOption[]; selected: readonly string[]; onToggle: (nodeId: string, checked: boolean) => void; error?: string }) {
  return (
    <fieldset className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <legend className="px-1 text-lg font-semibold">{title}</legend>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map((node) => {
          const inputId = `${name}-${node.nodeId}`;
          return (
            <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/30 has-[:checked]:border-primary has-[:checked]:bg-primary/5" htmlFor={inputId} key={node.nodeId}>
              <input checked={selected.includes(node.nodeId)} className="mt-1 h-4 w-4 accent-primary" id={inputId} name={name} onChange={(event) => onToggle(node.nodeId, event.target.checked)} type="checkbox" value={node.nodeId} />
              <span className="min-w-0"><span className="block text-sm font-medium">{node.name}</span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{node.mechanism}</span>{node.requiredPrerequisites.length ? <span className="mt-1 block text-xs text-amber-700">Prerequisites: {node.requiredPrerequisites.join(", ")}</span> : null}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
