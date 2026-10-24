import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertNotLearnerDatabase } from "@/mcp/database-safety";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pc-mcp-db-safety-"));
  directories.push(root);
  const learner = join(root, "dev.db");
  writeFileSync(learner, "learner");
  return { root, learner };
}

describe("assertNotLearnerDatabase", () => {
  it("rejects dot-segment aliases of the learner database", () => {
    const { root } = fixture();
    mkdirSync(join(root, "nested"));

    expect(() =>
      assertNotLearnerDatabase(
        `file:${join(root, "nested", "..", "dev.db")}`,
        root,
      ),
    ).toThrow(/learner dev\.db/);
  });

  it("rejects symlink and hardlink aliases", () => {
    const { root, learner } = fixture();
    const symlink = join(root, "learner-symlink.sqlite");
    const hardlink = join(root, "learner-hardlink.sqlite");
    symlinkSync(learner, symlink);
    linkSync(learner, hardlink);

    expect(() =>
      assertNotLearnerDatabase(`file:${symlink}`, root),
    ).toThrow(/learner dev\.db/);
    expect(() =>
      assertNotLearnerDatabase(`file:${hardlink}`, root),
    ).toThrow(/learner dev\.db/);
  });

  it("allows a distinct isolated database path", () => {
    const { root } = fixture();
    expect(() =>
      assertNotLearnerDatabase(`file:${join(root, "isolated.db")}`, root),
    ).not.toThrow();
  });
});
