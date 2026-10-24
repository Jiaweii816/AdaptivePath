import { AppLayout } from "@/components/layout/app-layout";
import { MockInterviewClient } from "@/features/mock-interview/mock-interview-client";
import { getMockInterviewPageData } from "@/features/mock-interview/mock-interview-data";

type MockInterviewPageProps = {
  searchParams?: Promise<{ problem?: string; planItemId?: string }>;
};

export default async function MockInterviewPage({
  searchParams,
}: MockInterviewPageProps) {
  const params = await searchParams;
  const data = await getMockInterviewPageData({
    requestedSlug: params?.problem,
  });

  return (
    <AppLayout
      contentClassName="max-w-[1800px] px-3 py-4 lg:px-5"
      displayName={data.displayName}
    >
      <MockInterviewClient
        hasLeetCodeSession={data.hasLeetCodeSession}
        initialPlanItemId={params?.planItemId}
        initialProblemSlug={params?.problem}
        initialTargetLabel={data.targetLabel}
        problems={data.problems}
      />
    </AppLayout>
  );
}
