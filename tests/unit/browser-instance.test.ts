import { describe, expect, it } from "vitest";
import {
  BROWSER_INSTANCE_STORAGE_KEY,
  getOrCreateBrowserInstanceId,
  type BrowserInstanceStorage,
} from "@/features/workbench/browser-instance";

describe("Workbench browser instance", () => {
  it("returns one stable id across same-tab reloads", () => {
    const storage = createSessionStorage();
    let calls = 0;
    const createId = () => `tab-stable-${++calls}`;

    const first = getOrCreateBrowserInstanceId({ storage, createId });
    const afterReload = getOrCreateBrowserInstanceId({ storage, createId });

    expect(first).toBe("tab-stable-1");
    expect(afterReload).toBe(first);
    expect(calls).toBe(1);
    expect(storage.getItem(BROWSER_INSTANCE_STORAGE_KEY)).toBe(first);
  });

  it("keeps separate tabs isolated through separate sessionStorage areas", () => {
    const tabA = createSessionStorage();
    const tabB = createSessionStorage();

    expect(
      getOrCreateBrowserInstanceId({
        storage: tabA,
        createId: () => "browser-tab-a",
      }),
    ).toBe("browser-tab-a");
    expect(
      getOrCreateBrowserInstanceId({
        storage: tabB,
        createId: () => "browser-tab-b",
      }),
    ).toBe("browser-tab-b");
    expect(tabA.getItem(BROWSER_INSTANCE_STORAGE_KEY)).not.toBe(
      tabB.getItem(BROWSER_INSTANCE_STORAGE_KEY),
    );
  });

  it("is SSR-safe and does not invent process-global tab state", () => {
    expect(getOrCreateBrowserInstanceId({ storage: null })).toBeUndefined();
  });

  it("fails open when sessionStorage is unavailable", () => {
    const deniedStorage: BrowserInstanceStorage = {
      getItem() {
        throw new Error("storage denied");
      },
      setItem() {
        throw new Error("storage denied");
      },
    };

    expect(
      getOrCreateBrowserInstanceId({ storage: deniedStorage }),
    ).toBeUndefined();
  });

  it("replaces an invalid persisted id", () => {
    const storage = createSessionStorage();
    storage.setItem(BROWSER_INSTANCE_STORAGE_KEY, "bad");

    expect(
      getOrCreateBrowserInstanceId({
        storage,
        createId: () => "replacement-tab-id",
      }),
    ).toBe("replacement-tab-id");
  });
});

function createSessionStorage(): BrowserInstanceStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}
