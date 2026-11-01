import { describe, expect, it } from "vitest";
import { planCitation } from "@/features/adaptivepath/practice/citation-plan";

describe("citation clicks", () => {
  it("review citations open the textbook without recording reference use for the current question", () => {
    expect(planCitation({ reviewing: true, referenceUsed: false })).toEqual({ recordReference: false });
  });
  it("current-question citations record reference use once", () => {
    expect(planCitation({ reviewing: false, referenceUsed: false })).toEqual({ recordReference: true });
    expect(planCitation({ reviewing: false, referenceUsed: true })).toEqual({ recordReference: false });
  });
});
