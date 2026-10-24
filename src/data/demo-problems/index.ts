import { longestSubstringAdapter } from "./longest-substring/adapter";
import { searchInsertAdapter } from "./search-insert/adapter";
import { twoSumAdapter } from "./two-sum/adapter";
import type { DemoProblemAdapter } from "./adapter.types";

const adapters = [
  twoSumAdapter,
  searchInsertAdapter,
  longestSubstringAdapter,
] satisfies DemoProblemAdapter[];

export function getDemoProblemAdapter(slug: string) {
  return adapters.find((adapter) => adapter.slug === slug);
}

export { adapters as demoProblemAdapters };
export type { DemoProblemAdapter };
