import { describe, expect, it } from "vitest";
import { englishSystemText } from "@/lib/system-copy";

describe("englishSystemText", () => {
  it("keeps English system copy", () => {
    expect(englishSystemText("Binary search boundary issue", "Fallback")).toBe(
      "Binary search boundary issue",
    );
  });

  it("replaces Han-script text outside localized content surfaces", () => {
    expect(englishSystemText("二分查找边界错误", "Binary Search Boundary")).toBe(
      "Binary Search Boundary",
    );
  });
});
