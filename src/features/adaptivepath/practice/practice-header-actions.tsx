"use client";
import Link from "next/link";
import { BookOpen, UserRound, GraduationCap } from "lucide-react";

const HEADER_LINK = "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-muted";

export function PracticeHeaderActions({ liveTutor }: { liveTutor: boolean }) {
  return <div className="flex items-center gap-2">
    <span data-testid="tutor-status" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] text-slate-600">
      {liveTutor ? "Live tutor: On" : "Live tutor: Off · no model key"}
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${liveTutor ? "bg-emerald-500" : "bg-slate-300"}`} />
    </span>
    <Link href="/adaptivepath/onboarding" className={HEADER_LINK}><GraduationCap size={14} />Onboarding</Link>
    <Link href="/adaptivepath/textbook" className={HEADER_LINK}><BookOpen size={14} />Textbook §12.2</Link>
    <Link href="/adaptivepath/profile" className={HEADER_LINK}><UserRound size={14} />Learner Profile</Link>
  </div>;
}
