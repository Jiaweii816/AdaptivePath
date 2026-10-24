import { describe, expect, it } from "vitest";
import {
  campaignTimeZoneSchema,
  deriveCampaignCalendar,
  formatCampaignDate,
} from "@/server/campaign";

describe("Campaign calendar", () => {
  it("uses the persisted IANA timezone around a UTC boundary", () => {
    const instant = new Date("2026-08-04T00:30:00.000Z");
    expect(formatCampaignDate(instant, "America/Chicago")).toBe("2026-08-03");
    expect(formatCampaignDate(instant, "Asia/Tokyo")).toBe("2026-08-04");
  });

  it("derives stable remaining days without the server host timezone", () => {
    expect(deriveCampaignCalendar({
      now: new Date("2026-08-04T00:30:00.000Z"),
      timezone: "America/Chicago",
      endDate: "2026-08-10",
    })).toEqual({ campaignDate: "2026-08-03", remainingDays: 7, ended: false });
  });

  it("rejects invalid IANA timezone values", () => {
    expect(campaignTimeZoneSchema.safeParse("Houston/Local").success).toBe(false);
    expect(campaignTimeZoneSchema.safeParse("America/Chicago").success).toBe(true);
  });
});
