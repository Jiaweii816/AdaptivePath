import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";

export const MCP_PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Refuse every path alias for the workspace learner database. String equality
 * is insufficient here: dot segments, symlinks, and hardlinks can all name the
 * same SQLite file.
 */
export function assertNotLearnerDatabase(
  databaseUrl: string,
  projectRoot = MCP_PROJECT_ROOT,
): void {
  const selectedPath = resolveSqliteFilePath(databaseUrl, projectRoot);
  const learnerPath = resolve(projectRoot, "dev.db");

  if (sameFileIdentity(selectedPath, learnerPath)) {
    throw new Error("MCP write denied: refuse to write workspace learner dev.db");
  }
}

export function sameFileIdentity(leftPath: string, rightPath: string): boolean {
  const left = canonicalizePath(leftPath);
  const right = canonicalizePath(rightPath);
  if (left === right) return true;

  if (!existsSync(left) || !existsSync(right)) return false;
  const leftStat = statSync(left);
  const rightStat = statSync(right);
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

function canonicalizePath(path: string): string {
  const normalized = resolve(path);
  if (existsSync(normalized)) return realpathSync.native(normalized);

  const parent = dirname(normalized);
  return existsSync(parent)
    ? resolve(realpathSync.native(parent), normalized.slice(parent.length + 1))
    : normalized;
}
