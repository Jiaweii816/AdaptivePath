import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type SqliteDatabase = {
  exec: (source: string) => void;
};

export function applyPrismaMigrations(db: SqliteDatabase) {
  const migrationsDir = join(process.cwd(), "prisma/migrations");
  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const migrationPath = join(migrationsDir, migrationName, "migration.sql");

    if (!existsSync(migrationPath)) {
      continue;
    }

    db.exec(readFileSync(migrationPath, "utf8"));
  }
}
