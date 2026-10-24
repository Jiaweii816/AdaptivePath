import type { CampaignDb } from "../store";
import { campaignTaskInclude } from "../store";

export async function rebuildCampaignTaskReceipt(
  tx: CampaignDb,
  taskId: string,
  options: Readonly<{ updateDailyTask?: boolean; now?: Date }> = {},
) {
  const task = await tx.campaignDailyTask.findUniqueOrThrow({
    where: { id: taskId },
    include: campaignTaskInclude,
  });
  const plannedCount = task.items.length;
  const settledCount = task.items.filter((item) => item.settlement).length;
  const status =
    task.status === "skipped"
      ? "skipped"
      : plannedCount > 0 && settledCount === plannedCount
        ? "completed"
        : "partial";
  const items = task.items.map((item) => ({
    taskItemId: item.id,
    problemSlug: item.problemSlug,
    nodeId: item.nodeId,
    slotRole: item.slotRole,
    outcome: item.settlement
      ? item.settlement.positiveForMastery
        ? "positive"
        : item.settlement.negativeOutcome
          ? "negative"
          : "neutral"
      : item.status === "skipped"
        ? "skipped"
        : "pending",
    selfRating: item.settlement?.selfRating ?? null,
    positiveForMastery: item.settlement?.positiveForMastery ?? false,
  }));
  const now = options.now ?? new Date();
  if (options.updateDailyTask !== false) {
    await tx.campaignDailyTask.update({
      where: { id: task.id },
      data: { status, updatedAt: now },
    });
  }
  return tx.campaignTaskReceipt.upsert({
    where: { taskId: task.id },
    create: {
      taskId: task.id,
      campaignId: task.campaignId,
      campaignDate: task.campaignDate,
      status,
      plannedCount,
      settledCount,
      itemsJson: JSON.stringify(items),
      createdAt: now,
      updatedAt: now,
    },
    update: {
      status,
      plannedCount,
      settledCount,
      itemsJson: JSON.stringify(items),
      updatedAt: now,
    },
  });
}
