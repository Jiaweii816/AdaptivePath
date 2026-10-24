import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCampaignTestDb } from "./campaign-test-db";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const M2_MIGRATION = "20260803190000_add_campaign_deterministic_core";
const M2R_MIGRATION = "20260803210000_align_campaign_curriculum_and_consolidation";
const M3A_MIGRATION = "20260803230000_bind_campaign_task_evidence";
const M3B_MIGRATION = "20260804010000_add_campaign_timezone";
const M4B_MIGRATION = "20260804050000_add_campaign_strategist_runs";
const M5A_MIGRATION = "20260804070000_add_campaign_onboarding_idempotency";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Campaign Prisma schema and migration", () => {
  it("upgrades an M4B database with nullable onboarding idempotency keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "patterncoach-campaign-final-migration-"));
    const db = new Database(join(dir, "m4b-upgrade.db"));
    const migrationRoot = join(process.cwd(), "prisma/migrations");
    const names = readdirSync(migrationRoot).sort();
    const apply = (name: string) => {
      const file = join(migrationRoot, name, "migration.sql");
      if (existsSync(file)) db.exec(readFileSync(file, "utf8"));
    };
    names.filter((name) => name <= M4B_MIGRATION).forEach(apply);
    db.exec(`
      INSERT INTO "User" ("id", "handle", "createdAt", "updatedAt")
      VALUES ('m4b-user', 'm4b-upgrade-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "Campaign" ("id", "userId", "updatedAt")
      VALUES ('m4b-campaign', 'm4b-user', CURRENT_TIMESTAMP);
    `);
    apply(M5A_MIGRATION);
    const columns = db.prepare("PRAGMA table_info('Campaign')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["activeOwnerKey", "creationKey"]));
    expect(db.prepare("SELECT id, activeOwnerKey, creationKey FROM Campaign WHERE id='m4b-campaign'").get())
      .toEqual({ id: "m4b-campaign", activeOwnerKey: null, creationKey: null });
    const indexes = db.prepare("PRAGMA index_list('Campaign')").all() as Array<{ name: string; unique: number }>;
    expect(indexes).toContainEqual(expect.objectContaining({ name: "Campaign_activeOwnerKey_key", unique: 1 }));
    expect(indexes).toContainEqual(expect.objectContaining({ name: "Campaign_creationKey_key", unique: 1 }));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies to both an empty database and an existing M2 schema", () => {
    for (const mode of ["all", "m2_then_current"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "patterncoach-campaign-final-migration-"));
      const db = new Database(join(dir, `${mode}.db`));
      const migrationRoot = join(process.cwd(), "prisma/migrations");
      const names = readdirSync(migrationRoot).sort();
      const apply = (name: string) => {
        const file = join(migrationRoot, name, "migration.sql");
        if (existsSync(file)) db.exec(readFileSync(file, "utf8"));
      };
      if (mode === "all") {
        names.forEach(apply);
      } else {
        names.filter((name) => name <= M2_MIGRATION).forEach(apply);
        const oldSkeletonColumns = db.prepare("PRAGMA table_info('CampaignSkeleton')").all() as Array<{ name: string }>;
        const oldTaskColumns = db.prepare("PRAGMA table_info('CampaignDailyTask')").all() as Array<{ name: string; notnull: number }>;
        expect(oldSkeletonColumns.map((column) => column.name)).toContain("phase");
        expect(oldTaskColumns.find((column) => column.name === "primaryNodeId")?.notnull).toBe(1);
        db.exec(`
          INSERT INTO "User" ("id", "handle", "createdAt", "updatedAt")
          VALUES ('m2-user', 'm2-upgrade-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          INSERT INTO "Campaign" ("id", "userId", "updatedAt")
          VALUES ('m2-campaign', 'm2-user', CURRENT_TIMESTAMP);
          INSERT INTO "CampaignSkeleton" ("id", "campaignId", "version", "phase")
          VALUES ('m2-skeleton', 'm2-campaign', 1, 'main');
          INSERT INTO "CampaignDailyTask" (
            "id", "campaignId", "campaignDate", "budget", "primaryNodeId", "updatedAt"
          ) VALUES ('m2-task', 'm2-campaign', '2026-08-03', 3, 'N1', CURRENT_TIMESTAMP);
        `);
        apply(M2R_MIGRATION);
        apply(M3A_MIGRATION);
        apply(M3B_MIGRATION);
        expect(db.prepare("SELECT mixedWindowDays FROM CampaignSkeleton WHERE id='m2-skeleton'").get()).toEqual({ mixedWindowDays: 7 });
        expect(db.prepare("SELECT primaryNodeId FROM CampaignDailyTask WHERE id='m2-task'").get()).toEqual({ primaryNodeId: "N1" });
      }
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Campaign%'")
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toContain("CampaignTaskItemSettlement");
      const skeletonColumns = db.prepare("PRAGMA table_info('CampaignSkeleton')").all() as Array<{ name: string }>;
      const taskColumns = db.prepare("PRAGMA table_info('CampaignDailyTask')").all() as Array<{ name: string; notnull: number }>;
      expect(skeletonColumns.map((column) => column.name)).not.toContain("phase");
      expect(skeletonColumns.map((column) => column.name)).toContain("mixedWindowDays");
      expect(taskColumns.find((column) => column.name === "primaryNodeId")?.notnull).toBe(0);
      const attemptColumns = db.prepare("PRAGMA table_info('CampaignTaskItemAttempt')").all() as Array<{ name: string }>;
      expect(attemptColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "executionFingerprint",
        "selectedSuiteFingerprint",
        "evidenceProblemSlug",
        "evidenceSubject",
        "evidenceScope",
        "evidenceCanVerdict",
      ]));
      const attemptIndexes = db.prepare("PRAGMA index_list('CampaignTaskItemAttempt')").all() as Array<{ name: string; unique: number }>;
      expect(attemptIndexes).toContainEqual(expect.objectContaining({
        name: "CampaignTaskItemAttempt_taskItemId_workspaceSessionId_key",
        unique: 1,
      }));
      const goalColumns = db.prepare("PRAGMA table_info('CampaignGoal')").all() as Array<{ name: string; dflt_value: string | null }>;
      expect(goalColumns).toContainEqual(expect.objectContaining({ name: "timezone", dflt_value: "'UTC'" }));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports CRUD, skeleton versions, state separation, and unique constraints", async () => {
    const testDb = await createCampaignTestDb();
    cleanups.push(testDb.cleanup);
    const user = await testDb.prisma.user.create({ data: { handle: "campaign-schema-user" } });
    const campaign = await testDb.prisma.campaign.create({
      data: {
        userId: user.id,
        goal: {
          create: {
            endDate: new Date("2026-12-01T00:00:00.000Z"),
            dailyQuestionBudget: 3,
            timezone: "America/Chicago",
            language: "Python",
          },
        },
        skeletons: {
          create: [
            { version: 1, mixedWindowDays: 7 },
            { version: 2, mixedWindowDays: 10 },
          ],
        },
        learnerNodeStates: {
          create: { nodeId: "N1" },
        },
      },
      include: { skeletons: true, learnerNodeStates: true },
    });
    expect(campaign.skeletons).toHaveLength(2);
    expect(campaign.learnerNodeStates[0]).not.toHaveProperty("phase");
    await expect(
      testDb.prisma.campaignSkeleton.create({
        data: { campaignId: campaign.id, version: 1, mixedWindowDays: 7 },
      }),
    ).rejects.toThrow();

    const task = await testDb.prisma.campaignDailyTask.create({
      data: {
        campaignId: campaign.id,
        campaignDate: "2026-08-03",
        budget: 3,
        primaryNodeId: "N1",
        items: {
          create: {
            problemSlug: "remove-element",
            nodeId: "N1",
            slotRole: "target",
            exposureType: "never_seen",
            sortOrder: 1,
          },
        },
      },
      include: { items: true },
    });
    await expect(
      testDb.prisma.campaignDailyTask.create({
        data: {
          campaignId: campaign.id,
          campaignDate: "2026-08-03",
          budget: 3,
          primaryNodeId: "N1",
        },
      }),
    ).rejects.toThrow();

    const mixedTask = await testDb.prisma.campaignDailyTask.create({
      data: {
        campaignId: campaign.id,
        campaignDate: "2026-08-04",
        budget: 3,
        primaryNodeId: null,
        items: {
          create: {
            problemSlug: "roman-to-integer",
            nodeId: "N3",
            slotRole: "mixed",
            exposureType: "never_seen",
            sortOrder: 1,
          },
        },
      },
      include: { items: true },
    });
    expect(mixedTask).toMatchObject({ primaryNodeId: null });
    expect(mixedTask.items[0].slotRole).toBe("mixed");

    const attempt = await testDb.prisma.campaignTaskItemAttempt.create({
      data: { taskItemId: task.items[0].id, startedAt: new Date() },
    });
    await testDb.prisma.campaignTaskItemSettlement.create({
      data: {
        taskItemId: task.items[0].id,
        attemptId: attempt.id,
        reviewCompleted: true,
        passed: true,
        selfRating: "easy",
        positiveForMastery: true,
        negativeOutcome: false,
        settledAt: new Date(),
      },
    });
    await expect(
      testDb.prisma.campaignTaskItemSettlement.create({
        data: {
          taskItemId: task.items[0].id,
          attemptId: attempt.id,
          reviewCompleted: true,
          passed: true,
          positiveForMastery: true,
          negativeOutcome: false,
          settledAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
