export type DraftSaveMode = "autosave" | "foreground";

export type DraftSaveAttemptOptions = {
  label?: string;
  mode: DraftSaveMode;
  timeoutMs: number;
};

type DraftSaveSuccess = {
  chainDetached: false;
  mode: DraftSaveMode;
  ok: true;
  saveStarted: true;
  status: "saved";
};

type DraftSaveTimedOut = {
  chainDetached: boolean;
  error: DraftSaveTimeoutError;
  mode: DraftSaveMode;
  ok: false;
  saveStarted: boolean;
  status: "timed_out";
};

type DraftSaveFailed = {
  chainDetached: false;
  error: Error;
  mode: DraftSaveMode;
  ok: false;
  saveStarted: boolean;
  status: "failed";
};

export type DraftSaveAttemptResult =
  | DraftSaveSuccess
  | DraftSaveTimedOut
  | DraftSaveFailed;

export class DraftSaveTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(options: { label?: string; timeoutMs: number }) {
    const label = options.label ?? "Draft save";
    super(`${label} timed out after ${options.timeoutMs}ms.`);
    this.name = "DraftSaveTimeoutError";
    this.label = label;
    this.timeoutMs = options.timeoutMs;
  }
}

export function isDraftSaveTimeoutError(
  error: unknown,
): error is DraftSaveTimeoutError {
  return error instanceof DraftSaveTimeoutError;
}

export async function withPromiseTimeout<T>(
  promise: PromiseLike<T>,
  options: { label?: string; timeoutMs: number },
): Promise<T> {
  assertPositiveTimeout(options.timeoutMs);

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new DraftSaveTimeoutError({
          label: options.label,
          timeoutMs: options.timeoutMs,
        }),
      );
    }, options.timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export class DraftSaveCoordinator<Input> {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly saveDraft: (input: Input) => Promise<unknown>) {}

  resetChain() {
    this.chain = Promise.resolve();
  }

  async save(
    input: Input,
    options: DraftSaveAttemptOptions,
  ): Promise<DraftSaveAttemptResult> {
    assertPositiveTimeout(options.timeoutMs);

    let cancelledBeforeStart = false;
    let saveStarted = false;
    const previous = this.chain.catch(() => undefined);
    const attempt = previous.then(async () => {
      if (cancelledBeforeStart) {
        return;
      }

      saveStarted = true;
      await this.saveDraft(input);
    });
    const trackedAttempt = attempt.catch(() => undefined);

    this.chain = trackedAttempt;

    try {
      await withPromiseTimeout(attempt, options);
      return {
        chainDetached: false,
        mode: options.mode,
        ok: true,
        saveStarted: true,
        status: "saved",
      };
    } catch (error) {
      if (isDraftSaveTimeoutError(error)) {
        cancelledBeforeStart = true;
        return {
          chainDetached: this.detachChainIfCurrent(trackedAttempt),
          error,
          mode: options.mode,
          ok: false,
          saveStarted,
          status: "timed_out",
        };
      }

      return {
        chainDetached: false,
        error: toError(error),
        mode: options.mode,
        ok: false,
        saveStarted,
        status: "failed",
      };
    }
  }

  private detachChainIfCurrent(trackedAttempt: Promise<void>) {
    if (this.chain !== trackedAttempt) {
      return false;
    }

    this.resetChain();
    return true;
  }
}

export function createDraftSaveCoordinator<Input>(
  saveDraft: (input: Input) => Promise<unknown>,
) {
  return new DraftSaveCoordinator(saveDraft);
}

function assertPositiveTimeout(timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Draft save timeoutMs must be a positive number.");
  }
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
