import { copyFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import {
  buildStrategistReadModel,
  decideCampaignPatch,
  loadCampaignPlanningReviewView,
  loadCampaignRoadmapView,
  loadCampaignStrategistProductView,
  loadCampaignTodayView,
} from "../src/server/campaign/services";
import { formatCampaignDate } from "../src/server/campaign/core";
import { isTrustedL2FactForConsumption } from "../src/server/memory/integrity/memory-integrity-policy";
import { resolveLocalDatabaseProfile } from "../src/server/db/sqlite-path";

const require = createRequire(import.meta.url);
type ReadonlyStatement = {
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Array<Record<string, unknown>>;
};
type ReadonlyDatabase = {
  prepare: (sql: string) => ReadonlyStatement;
  close: () => void;
};
type DatabaseConstructor = new (
  path: string,
  options: { readonly: true; fileMustExist: true },
) => ReadonlyDatabase;
const Database = require("better-sqlite3") as DatabaseConstructor;

const databasePaths = {
  iris: resolveLocalDatabaseProfile("iris").databasePath,
  guest: resolveLocalDatabaseProfile("guest").databasePath,
  try: resolveLocalDatabaseProfile("try").databasePath,
} as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function count(db: ReadonlyDatabase, sql: string, ...args: unknown[]) {
  const row = db.prepare(sql).get(...args);
  return Number(row?.count ?? 0);
}

async function expectedMigrations() {
  return (await readdir(resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function verifySchema(path: string, expected: readonly string[]) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const applied = db.prepare(`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name
    `).all().map((row) => String(row.migration_name));
    assert(
      JSON.stringify(applied) === JSON.stringify(expected),
      `${path} does not have the complete current migration set.`,
    );
    return applied.length;
  } finally {
    db.close();
  }
}

function smokeIrisReadOnly() {
  const db = new Database(databasePaths.iris, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const user = db.prepare("SELECT id FROM User WHERE handle = ?").get("Iris904");
    assert(typeof user?.id === "string", "Iris904 was not found.");
    const userId = String(user.id);
    const problems = count(db, "SELECT count(*) AS count FROM Problem");
    const reviews = count(db, "SELECT count(*) AS count FROM ReviewAttempt WHERE userId = ?", userId);
    const memories = count(db, "SELECT count(*) AS count FROM MemoryEpisode WHERE userId = ?", userId);
    const facts = count(db, "SELECT count(*) AS count FROM L2MemoryFact WHERE userId = ?", userId);
    const campaigns = count(db, "SELECT count(*) AS count FROM Campaign WHERE userId = ? AND status = 'active'", userId);
    const dailyTasks = count(db, `
      SELECT count(*) AS count
      FROM CampaignDailyTask d JOIN Campaign c ON c.id = d.campaignId
      WHERE c.userId = ?
    `, userId);
    assert(problems >= 150, "Iris Workbench problem catalog is incomplete.");
    assert(reviews > 0, "Iris Review history is empty.");
    assert(memories > 0 && facts > 0, "Iris Memory surface is empty.");
    assert(campaigns === 1 && dailyTasks > 0, "Iris Campaign/Today data is unavailable.");
    return { problems, reviews, memories, facts, campaigns, dailyTasks };
  } finally {
    db.close();
  }
}

function prismaFor(path: string) {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${path}` }),
  });
}

async function smokeGuest() {
  const prisma = prismaFor(databasePaths.guest);
  try {
    const guest = await prisma.user.findUniqueOrThrow({ where: { handle: "guest" } });
    assert(!(await prisma.user.findUnique({ where: { handle: "Iris904" } })), "Guest DB contains Iris904.");
    const now = new Date();
    const [today, roadmap, campaign, reviewCount, chatCount, episodeCount, facts, repairCount] = await Promise.all([
      loadCampaignTodayView({ db: prisma, userId: guest.id, now, materialize: false }),
      loadCampaignRoadmapView({ db: prisma, userId: guest.id, now }),
      prisma.campaign.findFirstOrThrow({ where: { userId: guest.id, status: "active" } }),
      prisma.reviewAttempt.count({ where: { userId: guest.id } }),
      prisma.chatSession.count({ where: { userId: guest.id } }),
      prisma.memoryEpisode.count({ where: { userId: guest.id, memoryOrigin: "learner" } }),
      prisma.l2MemoryFact.findMany({ where: { userId: guest.id, memoryOrigin: "learner" } }),
      prisma.campaignRepairQueueItem.count({
        where: {
          campaign: { userId: guest.id },
          status: { in: ["pending", "scheduled"] },
        },
      }),
    ]);
    assert(today.kind === "campaign" && today.items.length > 0, "Guest Today task is not materialized.");
    assert(roadmap.kind === "campaign", "Guest Growth Map is unavailable.");
    assert(roadmap.nodes.length === 17, "Guest Growth Map does not contain the 17-node route.");
    assert(roadmap.nodes.some((node) => node.masteryState === "mastered"), "Guest route has no mastered node.");
    assert(roadmap.nodes.some((node) => node.available), "Guest route has no available node.");
    assert(roadmap.nodes.some((node) => node.locked), "Guest route has no locked node.");
    assert(reviewCount >= 2 && chatCount >= 2, "Guest Review/Chat examples are incomplete.");
    const factCount = facts.length;
    assert(episodeCount >= 2 && factCount >= 2, "Guest Memory examples are incomplete.");
    assert(
      facts.every(isTrustedL2FactForConsumption),
      "Guest Memory facts are not consumable by the normal learner read path.",
    );
    assert(repairCount >= 1, "Guest active Repair is missing.");

    const campaignDate = formatCampaignDate(now, "America/Chicago");
    const [planning, strategist, readModel] = await Promise.all([
      loadCampaignPlanningReviewView({ db: prisma, userId: guest.id, campaignId: campaign.id }),
      loadCampaignStrategistProductView({ db: prisma, userId: guest.id, campaignId: campaign.id, now }),
      buildStrategistReadModel({ db: prisma, campaignId: campaign.id, campaignDate }),
    ]);
    assert(planning.status === "pending_review" && planning.pendingPatch, "Guest proposal approval fixture is unavailable.");
    assert(strategist.status !== "unavailable", "Guest Strategist read model is unavailable.");
    assert(
      readModel.readModel.activeSkeleton.nodePlans.length === 17,
      "Guest Strategist cannot see the full future route.",
    );

    return {
      todayItems: today.items.length,
      roadmapNodes: roadmap.nodes.length,
      reviewCount,
      chatCount,
      episodeCount,
      factCount,
      repairCount,
      pendingPatchId: planning.pendingPatch.patchId,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function smokeGuestApprovalOnTemporaryCopy() {
  const temporaryPath = `/tmp/patterncoach-guest-approval-smoke-${process.pid}.db`;
  await copyFile(databasePaths.guest, temporaryPath);
  const prisma = prismaFor(temporaryPath);
  try {
    const guest = await prisma.user.findUniqueOrThrow({ where: { handle: "guest" } });
    const campaign = await prisma.campaign.findFirstOrThrow({ where: { userId: guest.id, status: "active" } });
    const planning = await loadCampaignPlanningReviewView({ db: prisma, userId: guest.id, campaignId: campaign.id });
    assert(planning.status === "pending_review" && planning.pendingPatch, "Temporary approval smoke has no pending patch.");
    const decision = await decideCampaignPatch({
      db: prisma,
      userId: guest.id,
      patchId: planning.pendingPatch.patchId,
      decision: { action: "accept_all", acceptDailyBudgetSuggestion: false },
    });
    assert(decision.kind === "applied", "Guest proposal approval did not apply on the temporary copy.");
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    assert(after.activeSkeletonVersion === 2, "Guest approval did not produce the next Skeleton version.");
    return { decision: decision.kind, activeSkeletonVersion: after.activeSkeletonVersion };
  } finally {
    await prisma.$disconnect();
    await rm(temporaryPath, { force: true });
    await rm(`${temporaryPath}-wal`, { force: true });
    await rm(`${temporaryPath}-shm`, { force: true });
  }
}

async function smokeTry() {
  const prisma = prismaFor(databasePaths.try);
  try {
    const tryUser = await prisma.user.findUniqueOrThrow({
      where: { handle: "try" },
      include: { profile: true },
    });
    assert(tryUser.profile, "Try onboarding profile is missing.");
    assert(!(await prisma.user.findUnique({ where: { handle: "Iris904" } })), "Try DB contains Iris904.");
    const [problemCount, visibleTestCount] = await Promise.all([
      prisma.problem.count(),
      prisma.problemTestCase.count({ where: { isVisible: true } }),
    ]);
    assert(problemCount >= 150 && visibleTestCount > 0, "Test basic Workbench flow is unavailable.");
    return { user: tryUser.handle, problemCount, visibleTestCount };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const expected = await expectedMigrations();
  const schema = Object.fromEntries(
    await Promise.all(
      Object.entries(databasePaths).map(async ([name, path]) => [name, await verifySchema(path, expected)]),
    ),
  );
  const iris = smokeIrisReadOnly();
  const guest = await smokeGuest();
  const guestApproval = await smokeGuestApprovalOnTemporaryCopy();
  const scratch = await smokeTry();
  console.log(JSON.stringify({ schema, iris, guest, guestApproval, try: scratch }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
