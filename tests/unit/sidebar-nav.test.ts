import { describe, expect, it } from "vitest";
import { SIDEBAR_NAV } from "@/components/layout/sidebar-nav";

describe("sidebar nav", () => {
  it("links the real pages with Today as the default planning entry", () => {
    expect(SIDEBAR_NAV.map((item) => item.href)).toEqual([
      "/campaign/today",
      "/workbench",
      "/mock-interview",
      "/history/problems",
      "/profile",
      "/notebook",
      "/handbook",
      "/history/chats",
    ]);
  });

  it("gives every item a label and icon", () => {
    for (const item of SIDEBAR_NAV) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon).toBeTruthy();
    }
  });
});
