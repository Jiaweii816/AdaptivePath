import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import HomePage from "../../../app/page";
import LegacyTodayPage from "../../../app/today/page";

describe("Campaign canonical entry routing", () => {
  beforeEach(() => redirectMock.mockClear());

  it("routes the application root to Campaign Today", async () => {
    await HomePage();
    expect(redirectMock).toHaveBeenCalledWith("/campaign/today");
  });

  it("keeps legacy Today as a compatibility redirect", async () => {
    await LegacyTodayPage();
    expect(redirectMock).toHaveBeenCalledWith("/campaign/today");
  });
});
