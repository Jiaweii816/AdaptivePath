import { z } from "zod";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const TAVILY_SEARCH_TIMEOUT_MS = 8_000;
export const TAVILY_WINDOW_MONTHS = 24;
export const TAVILY_RETRIEVAL_RESULT_LIMIT = 15;

export type TavilySearchStatus =
  | "success"
  | "empty"
  | "disabled"
  | "timeout"
  | "rate_limited"
  | "quota_exceeded"
  | "provider_error";

const tavilySearchResponseSchema = z
  .object({
    results: z
      .array(
        z.object({
          title: z.string().optional().default(""),
          url: z.string().optional().default(""),
          content: z.string().optional().default(""),
          score: z.number().finite().optional(),
        }),
      )
      .default([]),
  })
  .passthrough();

export type TavilySearchResult = z.infer<
  typeof tavilySearchResponseSchema
>["results"][number];

export type TavilySearchResponse = {
  status: TavilySearchStatus;
  results: TavilySearchResult[];
};

export function recentSearchStartDate(now = new Date()): string {
  const start = new Date(Date.UTC(now.getUTCFullYear() - TAVILY_WINDOW_MONTHS / 12, now.getUTCMonth(), now.getUTCDate()));
  // Date.UTC normalizes 29 February two years earlier to 1 March. Use the
  // preceding day so the advertised window is never shorter than 24 months.
  if (start.getUTCMonth() !== now.getUTCMonth()) start.setUTCDate(0);
  return start.toISOString().slice(0, 10);
}

export async function searchTavilyRecentPages(input: {
  apiKey: string | undefined;
  query: string;
  startDate: string;
  maxResults?: number;
  fetcher?: typeof fetch;
}): Promise<TavilySearchResponse> {
  if (!input.apiKey?.trim()) return { status: "disabled", results: [] };

  try {
    const response = await (input.fetcher ?? fetch)(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: input.query,
        search_depth: "basic",
        topic: "general",
        max_results: Math.min(
          Math.max(input.maxResults ?? TAVILY_RETRIEVAL_RESULT_LIMIT, 1),
          TAVILY_RETRIEVAL_RESULT_LIMIT,
        ),
        chunks_per_source: 1,
        start_date: input.startDate,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        auto_parameters: false,
      }),
      signal: AbortSignal.timeout(TAVILY_SEARCH_TIMEOUT_MS),
    });

    if (response.status === 429) return { status: "rate_limited", results: [] };
    if (response.status === 432) return { status: "quota_exceeded", results: [] };
    if (!response.ok) return { status: "provider_error", results: [] };

    const parsed = tavilySearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) return { status: "provider_error", results: [] };
    return {
      status: parsed.data.results.length > 0 ? "success" : "empty",
      results: parsed.data.results,
    };
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return { status: "timeout", results: [] };
    }
    return { status: "provider_error", results: [] };
  }
}
