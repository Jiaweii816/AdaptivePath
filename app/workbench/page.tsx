import { redirect } from "next/navigation";
import { WorkbenchClient } from "@/features/workbench/workbench-client";
import { getWorkbenchData } from "@/features/workbench/workbench-data";
import { resolveLastWorkbenchContext } from "@/features/workbench/workbench-restore";
import { loadWorkbenchSession } from "@/features/workbench/workbench-session";
import { isTraceUiEnabled } from "@/server/observability/trace-ui-config";
import type { WorkbenchLanguage } from "@/features/workbench/types";
import { resolveCampaignWorkbenchContext } from "@/server/campaign/services";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";
import prisma from "@/server/db/prisma";

type WorkbenchPageProps = {
  searchParams?: Promise<{
    language?: string;
    planItemId?: string;
    problem?: string;
    campaignAttempt?: string;
  }>;
};

function parseWorkbenchLanguage(value?: string): WorkbenchLanguage | undefined {
  return value === "Python" || value === "C++" ? value : undefined;
}

export default async function WorkbenchPage({
  searchParams,
}: WorkbenchPageProps) {
  const params = await searchParams;
  const requestedSlug = params?.problem?.trim();
  const campaignContext = params?.campaignAttempt
    ? await resolveCampaignWorkbenchContext(prisma, {
        userId: await resolveLocalTraceUserId(prisma),
        attemptId: params.campaignAttempt,
      })
    : null;

  if (campaignContext && requestedSlug !== campaignContext.problemSlug) {
    redirect(`/workbench?problem=${encodeURIComponent(campaignContext.problemSlug)}&language=Python&campaignAttempt=${encodeURIComponent(campaignContext.attemptId)}`);
  }

  if (!requestedSlug) {
    const restoredContext = await resolveLastWorkbenchContext();
    if (restoredContext) {
      redirect(restoredContext.href);
    }
  }

  const { profile, problems, hasLeetCodeSession } = await getWorkbenchData({
    requestedSlug,
  });
  const target = requestedSlug
    ? problems.find((problem) => problem.slug === requestedSlug)
    : undefined;
  const initialSession = target
    ? await loadWorkbenchSession(target.id)
    : null;

  return (
    <WorkbenchClient
      hasLeetCodeSession={hasLeetCodeSession}
      initialLanguage={parseWorkbenchLanguage(params?.language)}
      initialProblems={problems}
      initialPlanItemId={params?.planItemId}
      initialProblemSlug={target?.slug}
      initialSession={initialSession}
      campaignContext={campaignContext}
      profile={profile}
      traceUiEnabled={isTraceUiEnabled()}
    />
  );
}
