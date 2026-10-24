import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DraftSaveTimeoutError,
  createDraftSaveCoordinator,
  isDraftSaveTimeoutError,
  withPromiseTimeout,
} from "@/features/workbench/draft-save-liveness";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe("draft save liveness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects pending promises with a labelled timeout error", async () => {
    vi.useFakeTimers();

    const pending = new Promise<void>(() => undefined);
    const result = withPromiseTimeout(pending, {
      label: "Coach chat draft save",
      timeoutMs: 250,
    });
    const rejection = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(250);

    const error = await rejection;
    expect(error).toMatchObject({
      label: "Coach chat draft save",
      name: "DraftSaveTimeoutError",
      timeoutMs: 250,
    });
    expect(error).toBeInstanceOf(DraftSaveTimeoutError);
  });

  it("serializes saves while the previous attempt is healthy", async () => {
    const first = deferred();
    const calls: string[] = [];
    const coordinator = createDraftSaveCoordinator(async (input: string) => {
      calls.push(input);
      if (input === "first") {
        await first.promise;
      }
    });

    const firstResult = coordinator.save("first", {
      mode: "autosave",
      timeoutMs: 10_000,
    });
    await Promise.resolve();

    const secondResult = coordinator.save("second", {
      mode: "foreground",
      timeoutMs: 10_000,
    });
    await Promise.resolve();

    expect(calls).toEqual(["first"]);

    first.resolve();

    await expect(firstResult).resolves.toMatchObject({
      mode: "autosave",
      ok: true,
      status: "saved",
    });
    await expect(secondResult).resolves.toMatchObject({
      mode: "foreground",
      ok: true,
      status: "saved",
    });
    expect(calls).toEqual(["first", "second"]);
  });

  it("detaches a timed-out foreground save so future saves can run", async () => {
    vi.useFakeTimers();

    const stuck = deferred();
    const calls: string[] = [];
    const coordinator = createDraftSaveCoordinator(async (input: string) => {
      calls.push(input);
      if (input === "stuck autosave") {
        await stuck.promise;
      }
    });

    void coordinator.save("stuck autosave", {
      mode: "autosave",
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["stuck autosave"]);

    const blockedChatSave = coordinator.save("chat snapshot", {
      label: "Coach chat draft save",
      mode: "foreground",
      timeoutMs: 50,
    });

    await vi.advanceTimersByTimeAsync(50);

    await expect(blockedChatSave).resolves.toMatchObject({
      chainDetached: true,
      mode: "foreground",
      ok: false,
      saveStarted: false,
      status: "timed_out",
    });

    const futureSave = coordinator.save("future snapshot", {
      mode: "foreground",
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect(futureSave).resolves.toMatchObject({
      chainDetached: false,
      ok: true,
      status: "saved",
    });
    expect(calls).toEqual(["stuck autosave", "future snapshot"]);

    stuck.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual(["stuck autosave", "future snapshot"]);
  });

  it("returns best-effort autosave failures without detaching the chain", async () => {
    const coordinator = createDraftSaveCoordinator(async () => {
      throw new Error("database is busy");
    });

    const result = await coordinator.save("draft", {
      mode: "autosave",
      timeoutMs: 10_000,
    });

    expect(result).toMatchObject({
      chainDetached: false,
      mode: "autosave",
      ok: false,
      status: "failed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isDraftSaveTimeoutError(result.error)).toBe(false);
      expect(result.error.message).toBe("database is busy");
    }
  });
});
