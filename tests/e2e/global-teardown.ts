import {
  assertWorkspaceDevDatabaseUnchanged,
  removeIsolatedTestDatabase,
  type FileChecksumSnapshot,
} from "../support/isolated-database";

export default function globalTeardown() {
  const before = process.env.PATTERNCOACH_E2E_DEV_DB_SNAPSHOT;
  const tempDirectory = process.env.PATTERNCOACH_E2E_DB_DIR;

  try {
    if (!before) {
      throw new Error("Missing PATTERNCOACH_E2E_DEV_DB_SNAPSHOT.");
    }
    assertWorkspaceDevDatabaseUnchanged(
      JSON.parse(before) as FileChecksumSnapshot,
    );
  } finally {
    if (tempDirectory) removeIsolatedTestDatabase(tempDirectory);
  }
}
