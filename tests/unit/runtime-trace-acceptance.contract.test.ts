import { describe, it } from "vitest";

describe("runtime trace v3 acceptance contracts reserved for later phases", () => {
  it.todo("scenario 16: simultaneous first actions share one Session and allocate two root Turns");
  it.todo("scenario 17: a different-tab action never closes another tab's Session");
  it.todo("scenario 18: session end is authenticated, idempotent, and identity-scoped");
  it.todo("scenario 19: replayed eventId does not duplicate rows or rollups");
  it.todo("scenario 20: seq polling has no gaps or repeats");
  it.todo("scenario 21: concurrent flush never exposes a cursor past uncommitted events");
  it.todo("scenario 22: legacy telemetry remains visible and unscoped");
  it.todo("scenario 23: missing legacy traceRunId maps idempotently");
  it.todo("scenario 24: Mock Interview stays unscoped and outside the workbench drawer");
  it.todo("scenario 25: Chat History and eval projections preserve baseline meaning");
  it.todo("scenario 43: pruned or summary-only exports are not replay eligible");
});
