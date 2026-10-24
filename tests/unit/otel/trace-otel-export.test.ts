import { describe, expect, it } from "vitest";
import {
  assertHasExportableSpans,
  parseArgs,
  resolveReadOnlyDatabase,
} from "../../../scripts/trace-otel-export";

describe("trace-otel-export CLI", () => {
  it("parses an explicit database, endpoint, and dry-run", () => {
    expect(
      parseArgs([
        "--db",
        "/tmp/trace.sqlite",
        "--endpoint=http://localhost:6006",
        "--dry-run",
      ]),
    ).toEqual({
      dbInput: "/tmp/trace.sqlite",
      endpoint: "http://localhost:6006",
      dryRun: true,
    });
  });

  it("rejects a database path that does not exist", () => {
    expect(() =>
      resolveReadOnlyDatabase("/tmp/patterncoach-definitely-missing.sqlite"),
    ).toThrow(/does not exist/u);
  });

  it("fails closed when no spans can be exported", () => {
    expect(() =>
      assertHasExportableSpans({ rowCount: 12, spanCount: 0 }),
    ).toThrow(/No exportable spans/u);
    expect(() =>
      assertHasExportableSpans({ rowCount: 12, spanCount: 1 }),
    ).not.toThrow();
  });
});
