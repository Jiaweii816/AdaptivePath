export const BROWSER_INSTANCE_STORAGE_KEY =
  "patterncoach.runtime-trace.browser-instance.v1";

export type BrowserInstanceStorage = Pick<
  Storage,
  "getItem" | "setItem"
>;

export type BrowserInstanceOptions = {
  storage?: BrowserInstanceStorage | null;
  createId?: () => string;
};

/**
 * Returns one stable identifier for the current browser tab. `sessionStorage`
 * survives a same-tab reload but remains isolated from other tabs. On the
 * server it returns `undefined` and never creates process-global tab state.
 */
export function getOrCreateBrowserInstanceId(
  options: BrowserInstanceOptions = {},
): string | undefined {
  const storage =
    options.storage === undefined
      ? readBrowserSessionStorage()
      : options.storage;
  if (!storage) {
    return undefined;
  }

  try {
    const existing = normalizeBrowserInstanceId(
      storage.getItem(BROWSER_INSTANCE_STORAGE_KEY),
    );
    if (existing) {
      return existing;
    }

    const created = normalizeBrowserInstanceId(
      (options.createId ?? createBrowserInstanceId)(),
    );
    if (!created) {
      throw new Error("browserInstanceId factory returned an invalid id.");
    }
    storage.setItem(BROWSER_INSTANCE_STORAGE_KEY, created);
    return created;
  } catch {
    // Privacy modes may deny sessionStorage. Trace correlation is optional in
    // the disabled-cutover path, so storage failure must not break Workbench.
    return undefined;
  }
}

function readBrowserSessionStorage(): BrowserInstanceStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function createBrowserInstanceId() {
  const browserCrypto = globalThis.crypto;
  if (browserCrypto && typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }

  // randomUUID is available in supported browsers; this fallback exists only
  // for restricted test/webview environments and stays scoped to one tab's
  // sessionStorage.
  return `trace-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeBrowserInstanceId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length >= 8 && normalized.length <= 200
    ? normalized
    : undefined;
}
