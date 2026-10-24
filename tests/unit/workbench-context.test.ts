import { describe, expect, it } from "vitest";
import {
  WORKBENCH_LAST_CONTEXT_STORAGE_KEY,
  buildWorkbenchHref,
  parseWorkbenchContextRecord,
  readLastWorkbenchContext,
  writeLastWorkbenchContext,
} from "@/features/workbench/workbench-context";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("workbench context", () => {
  it("builds canonical Workbench hrefs", () => {
    expect(
      buildWorkbenchHref({
        language: "C++",
        planItemId: "plan-1",
        problemSlug: "evaluate-division",
      }),
    ).toBe("/workbench?problem=evaluate-division&language=C%2B%2B&planItemId=plan-1");
  });

  it("round-trips the last active Workbench context in storage", () => {
    const storage = new MemoryStorage();
    const written = writeLastWorkbenchContext(
      {
        language: "Python",
        planItemId: "plan-35",
        problemSlug: "search-insert-position",
      },
      storage,
    );

    expect(written?.href).toBe(
      "/workbench?problem=search-insert-position&language=Python&planItemId=plan-35",
    );
    expect(readLastWorkbenchContext(storage)).toMatchObject({
      href: "/workbench?problem=search-insert-position&language=Python&planItemId=plan-35",
      language: "Python",
      planItemId: "plan-35",
      problemSlug: "search-insert-position",
    });
  });

  it("rejects invalid stored contexts so callers can fall back to /workbench", () => {
    const storage = new MemoryStorage();

    expect(readLastWorkbenchContext(storage)).toBeNull();

    storage.setItem(WORKBENCH_LAST_CONTEXT_STORAGE_KEY, "{bad json");
    expect(readLastWorkbenchContext(storage)).toBeNull();

    storage.setItem(
      WORKBENCH_LAST_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        href: "/handbook",
        language: "Python",
        problemSlug: "two-sum",
        savedAt: Date.now(),
      }),
    );
    expect(readLastWorkbenchContext(storage)).toBeNull();

    expect(
      parseWorkbenchContextRecord(
        JSON.stringify({
          href: "/workbench?language=JavaScript&problem=two-sum",
          language: "JavaScript",
          problemSlug: "two-sum",
          savedAt: Date.now(),
        }),
      ),
    ).toBeNull();
  });
});
