import { campaignDateSchema, campaignTimeZoneSchema } from "../domain";

function dayNumber(value: string) {
  campaignDateSchema.parse(value);
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

export function formatCampaignDate(now: Date, timezone: string): string {
  campaignTimeZoneSchema.parse(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return campaignDateSchema.parse(
    `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
  );
}

export function deriveCampaignCalendar(input: {
  now: Date;
  timezone: string;
  endDate: string;
}) {
  const campaignDate = formatCampaignDate(input.now, input.timezone);
  const remainingDays = dayNumber(input.endDate) - dayNumber(campaignDate);
  return { campaignDate, remainingDays, ended: remainingDays < 0 };
}
