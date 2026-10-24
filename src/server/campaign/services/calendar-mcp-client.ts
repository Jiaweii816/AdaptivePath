import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { loadLocalEnv } from "@/lib/env";
import {
  calendarFreeBusyObservationSchema,
  calendarFreeBusyQuerySchema,
  canonicalStrategistJson,
  strategistDigest,
  type CalendarFreeBusyObservation,
  type CalendarFreeBusyQuery,
} from "../domain";

export const CALENDAR_MCP_TOOL_NAME = "calendar_freebusy";
export const CALENDAR_MCP_TIMEOUT_MS = 5_000;
export const CALENDAR_MCP_MAX_RESPONSE_CHARS = 64_000;
export const CALENDAR_MCP_MAX_RANGE_DAYS = 31;
export const CALENDAR_MCP_NEAR_TERM_WINDOW_MS = 48 * 60 * 60 * 1_000;
export const CALENDAR_MCP_NEAR_TERM_TTL_MS = 60 * 60 * 1_000;
export const CALENDAR_MCP_DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
export const CALENDAR_MCP_DAILY_CALL_LIMIT = 5;

const rawPayloadSchema = z.object({
  busyIntervals: z.array(z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) }).strict()).max(200),
  freeIntervals: z.array(z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) }).strict()).max(200),
  allDay: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(31),
  asOf: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).optional(),
  providerScope: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:/-]+$/),
}).strict();

export class CalendarMcpError extends Error {
  constructor(
    readonly code: "calendar_mcp_disabled" | "calendar_mcp_config_invalid" | "calendar_mcp_timeout" | "calendar_mcp_failed" | "calendar_mcp_invalid_response",
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "CalendarMcpError";
  }
}

export type CalendarMcpTransport = Readonly<{
  callTool(input: Readonly<{ name: string; arguments: Record<string, unknown>; signal: AbortSignal }>): Promise<unknown>;
}>;

export type CalendarFreeBusyTool = Readonly<{
  enabled: boolean;
  query(input: CalendarFreeBusyQuery): Promise<CalendarFreeBusyObservation>;
}>;

export type CalendarMcpConfig = Readonly<{
  enabled: boolean;
  endpoint: string | null;
  accessToken: string | null;
  toolName: string;
  timeoutMs: number;
}>;

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function readCalendarMcpConfig(env: NodeJS.ProcessEnv = process.env): CalendarMcpConfig {
  loadLocalEnv();
  const enabled = env.CALENDAR_MCP_ENABLED === "1";
  const endpoint = env.CALENDAR_MCP_ENDPOINT?.trim() || null;
  if (enabled) {
    try {
      if (!endpoint || !["http:", "https:"].includes(new URL(endpoint).protocol)) throw new Error("invalid endpoint");
    } catch (error) {
      throw new CalendarMcpError("calendar_mcp_config_invalid", "CALENDAR_MCP_ENDPOINT must be an absolute HTTP(S) URL when Calendar MCP is enabled.", { cause: error });
    }
  }
  return {
    enabled,
    endpoint,
    accessToken: env.CALENDAR_MCP_ACCESS_TOKEN?.trim() || null,
    toolName: env.CALENDAR_MCP_TOOL_NAME?.trim() || CALENDAR_MCP_TOOL_NAME,
    timeoutMs: boundedInteger(env.CALENDAR_MCP_TIMEOUT_MS, CALENDAR_MCP_TIMEOUT_MS, 250, 30_000),
  };
}

export function createStreamableHttpCalendarMcpTransport(config: CalendarMcpConfig): CalendarMcpTransport {
  if (!config.enabled || !config.endpoint) {
    throw new CalendarMcpError("calendar_mcp_disabled", "Calendar MCP capability is not enabled.");
  }
  return {
    async callTool(input) {
      const client = new Client({ name: "patterncoach-calendar-client", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(config.endpoint!), {
        requestInit: config.accessToken ? { headers: { Authorization: `Bearer ${config.accessToken}` } } : undefined,
      });
      try {
        await client.connect(transport, { signal: input.signal });
        return await client.callTool({ name: input.name, arguments: input.arguments }, undefined, { signal: input.signal });
      } finally {
        await client.close().catch(() => undefined);
      }
    },
  };
}

function responsePayload(raw: unknown) {
  const serialized = JSON.stringify(raw);
  if (serialized.length > CALENDAR_MCP_MAX_RESPONSE_CHARS) {
    throw new CalendarMcpError("calendar_mcp_invalid_response", "Calendar MCP response exceeded the hard length limit.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if (record.structuredContent) return record.structuredContent;
  if (Array.isArray(record.content)) {
    const text = record.content.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
    if (typeof text?.text === "string") return JSON.parse(text.text);
  }
  return raw;
}

function ttlForQuery(query: CalendarFreeBusyQuery, now: Date) {
  return Date.parse(query.rangeStart) <= now.valueOf() + CALENDAR_MCP_NEAR_TERM_WINDOW_MS
    ? CALENDAR_MCP_NEAR_TERM_TTL_MS
    : CALENDAR_MCP_DEFAULT_TTL_MS;
}

function normalizeIntervals(
  intervals: readonly Readonly<{ start: string; end: string }>[],
  query: CalendarFreeBusyQuery,
) {
  const start = Date.parse(query.rangeStart);
  const end = Date.parse(query.rangeEnd);
  return intervals.map((interval) => {
    const parsedStart = Date.parse(interval.start);
    const parsedEnd = Date.parse(interval.end);
    if (parsedStart < start || parsedEnd > end || parsedEnd <= parsedStart) {
      throw new CalendarMcpError("calendar_mcp_invalid_response", "Calendar MCP returned an interval outside the authorized query range.");
    }
    return { start: new Date(parsedStart).toISOString(), end: new Date(parsedEnd).toISOString() };
  }).sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
}

export function createCalendarFreeBusyTool(options: {
  config?: CalendarMcpConfig;
  transport?: CalendarMcpTransport;
  now?: () => Date;
} = {}): CalendarFreeBusyTool {
  const config = options.config ?? readCalendarMcpConfig();
  const now = options.now ?? (() => new Date());
  return {
    enabled: config.enabled,
    async query(rawQuery) {
      if (!config.enabled) throw new CalendarMcpError("calendar_mcp_disabled", "Calendar MCP capability is not enabled.");
      const query = calendarFreeBusyQuerySchema.parse(rawQuery);
      if (Date.parse(query.rangeEnd) - Date.parse(query.rangeStart) > CALENDAR_MCP_MAX_RANGE_DAYS * 86_400_000) {
        throw new CalendarMcpError("calendar_mcp_invalid_response", "Calendar MCP query range exceeds the 31-day maximum.");
      }
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let raw: unknown;
      try {
        raw = await Promise.race([
          (options.transport ?? createStreamableHttpCalendarMcpTransport(config)).callTool({
            name: config.toolName,
            arguments: { rangeStart: query.rangeStart, rangeEnd: query.rangeEnd },
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new CalendarMcpError("calendar_mcp_timeout", "Calendar MCP request timed out."));
            }, config.timeoutMs);
          }),
        ]);
      } catch (error) {
        if (error instanceof CalendarMcpError) throw error;
        if (controller.signal.aborted) throw new CalendarMcpError("calendar_mcp_timeout", "Calendar MCP request timed out.", { cause: error });
        throw new CalendarMcpError("calendar_mcp_failed", "Calendar MCP request failed.", { cause: error });
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      let parsed: z.infer<typeof rawPayloadSchema>;
      try {
        parsed = rawPayloadSchema.parse(responsePayload(raw));
      } catch (error) {
        if (error instanceof CalendarMcpError) throw error;
        throw new CalendarMcpError("calendar_mcp_invalid_response", "Calendar MCP returned an invalid free/busy response.", { cause: error });
      }
      const observedAt = now();
      const asOf = new Date(parsed.asOf);
      if (asOf.valueOf() > observedAt.valueOf() + 5 * 60_000) {
        throw new CalendarMcpError("calendar_mcp_invalid_response", "Calendar MCP asOf timestamp is in the future.");
      }
      const localValidUntil = asOf.valueOf() + ttlForQuery(query, observedAt);
      const providerValidUntil = parsed.validUntil ? Date.parse(parsed.validUntil) : localValidUntil;
      if (providerValidUntil <= asOf.valueOf()) {
        throw new CalendarMcpError("calendar_mcp_invalid_response", "Calendar MCP validUntil must be after asOf.");
      }
      const firstDate = query.rangeStart.slice(0, 10);
      const endDate = query.rangeEnd.slice(0, 10);
      if (parsed.allDay.some((date) => date < firstDate || date >= endDate)) {
        throw new CalendarMcpError("calendar_mcp_invalid_response", "Calendar MCP returned all-day data outside the authorized query range.");
      }
      const normalized = {
        busyIntervals: normalizeIntervals(parsed.busyIntervals, query),
        freeIntervals: normalizeIntervals(parsed.freeIntervals, query),
        allDay: [...new Set(parsed.allDay)].sort(),
        asOf: asOf.toISOString(),
        validUntil: new Date(Math.min(localValidUntil, providerValidUntil)).toISOString(),
        providerScope: parsed.providerScope,
      };
      return calendarFreeBusyObservationSchema.parse({
        ...normalized,
        sourceDigest: strategistDigest({ query, observation: normalized }),
      });
    },
  };
}

export function summarizeCalendarObservation(observation: CalendarFreeBusyObservation) {
  return canonicalStrategistJson({
    busyIntervals: observation.busyIntervals,
    freeIntervals: observation.freeIntervals,
    allDay: observation.allDay,
    asOf: observation.asOf,
    validUntil: observation.validUntil,
    providerScope: observation.providerScope,
    sourceDigest: observation.sourceDigest,
  });
}
