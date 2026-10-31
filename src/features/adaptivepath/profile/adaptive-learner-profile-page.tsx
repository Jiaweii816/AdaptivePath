"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ConceptMasteryCard } from "./concept-mastery-card";
import { ProfileSummaryCard } from "./profile-summary-card";
import type { ProfileData } from "./profile-types";

async function loadProfile(): Promise<ProfileData> {
  const response = await fetch("/api/adaptivepath/profile", { cache: "no-store" });
  const body = await response.json() as ProfileData & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export function AdaptiveLearnerProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadProfile().then((result) => { if (active) setData(result); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, []);
  return <main className="min-h-screen bg-background px-4 py-6 text-foreground lg:px-8">
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/adaptivepath" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><ArrowLeft size={16} />Back to practice</Link>
      <PageHeader title="Learner Profile" description="L2 mastery per sub-topic (level, stability, evidence ledger) and the derived L3 section profile." />
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && <>
        <ProfileSummaryCard profile={data.latestProfile} />
        <div className="grid gap-3 md:grid-cols-2">
          {data.concepts.map((concept) => <ConceptMasteryCard key={concept.id} concept={concept}
            state={data.states.find((s) => s.conceptId === concept.id)}
            rows={data.rows.filter((r) => r.conceptId === concept.id)} />)}
        </div>
      </>}
    </div>
  </main>;
}
