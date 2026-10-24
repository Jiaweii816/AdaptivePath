import {
  assertWorkspaceDevDatabaseUnchanged,
  removeIsolatedTestDatabase,
  type FileChecksumSnapshot,
} from "../support/isolated-database";

export default function globalSetup() {
  return function globalTeardown() {
    const before = process.env.PATTERNCOACH_UNIT_DEV_DB_SNAPSHOT;
    const tempDirectory = process.env.PATTERNCOACH_UNIT_DB_DIR;

    try {
      if (!before) throw new Error("Missing PATTERNCOACH_UNIT_DEV_DB_SNAPSHOT.");
      assertWorkspaceDevDatabaseUnchanged(
        JSON.parse(before) as FileChecksumSnapshot,
      );
    } finally {
      if (tempDirectory) removeIsolatedTestDatabase(tempDirectory);
    }
  };
}
