export type ModelCostPricing = {
  provider: string;
  modelIds: string[];
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  pricingBasis: string;
  sourceUrl: string;
};

export type EstimatedCost = {
  provider: string;
  modelId: string;
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
  pricingBasis: string;
  sourceUrl: string;
};

export type VersionedModelPricingEntry = {
  provider: string;
  modelIds: string[];
  mode: string;
  uncachedInputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  nonReasoningOutputUsdPerMillion?: number;
  reasoningOutputUsdPerMillion?: number;
  /** The mode contract guarantees that no reasoning tokens are produced. */
  assumesNoReasoningTokens?: boolean;
  assumptions: string;
};

export type VersionedLlmUsage = {
  provider: string;
  modelId: string;
  mode: string;
  providerInputTokens: number;
  providerOutputTokens: number;
  providerTotalTokens: number | null;
  providerCachedTokens?: number | null;
  providerReasoningTokens?: number | null;
};

export type VersionedLlmCost = {
  pricingVersion: string;
  pricingStatus: "priced" | "partial" | "unpriced";
  estimatedCostUsd: number | null;
  providerTotalTokens: number | null;
  breakdown: {
    uncachedInputTokens: number | null;
    cachedInputTokens: number | null;
    nonReasoningOutputTokens: number | null;
    reasoningOutputTokens: number | null;
    uncachedInputUsd: number | null;
    cachedInputUsd: number | null;
    nonReasoningOutputUsd: number | null;
    reasoningOutputUsd: number | null;
  };
  unpricedComponents: string[];
};

export const TRACE_PRICING_VERSION = "patterncoach-usd-2026-07-12-v1";

/**
 * Immutable production pricing snapshot used when an LLM event is captured.
 * A missing component rate is intentional: it yields partial/unpriced rather
 * than silently applying a price from another model mode.
 */
export const TRACE_MODEL_PRICING: readonly VersionedModelPricingEntry[] = [
  {
    provider: "deepseek",
    modelIds: ["deepseek-chat", "deepseek-v4-flash"],
    mode: "standard",
    uncachedInputUsdPerMillion: 0.14,
    nonReasoningOutputUsdPerMillion: 0.28,
    assumesNoReasoningTokens: true,
    assumptions:
      "Foreground DeepSeek V4 Flash non-thinking mode. Cached input is intentionally unpriced by this snapshot.",
  },
  {
    provider: "qwen",
    modelIds: ["qwen3-8b"],
    mode: "standard",
    uncachedInputUsdPerMillion: 0.18,
    cachedInputUsdPerMillion: 0.18,
    nonReasoningOutputUsdPerMillion: 0.7,
    assumesNoReasoningTokens: true,
    assumptions:
      "Memory non-thinking compatibility mode; this snapshot applies the same input rate to cached and uncached input.",
  },
] as const;

export const MODEL_COST_PRICING_USD_PER_1M: ModelCostPricing[] = [
  {
    provider: "deepseek",
    modelIds: ["deepseek-chat", "deepseek-v4-flash"],
    inputUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
    pricingBasis:
      "DeepSeek V4 Flash cache-miss input and output prices for foreground non-thinking calls.",
    sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  {
    provider: "qwen",
    modelIds: ["qwen3-8b"],
    inputUsdPerMillion: 0.18,
    outputUsdPerMillion: 0.7,
    pricingBasis:
      "Alibaba Cloud Model Studio Singapore / International qwen3-8b estimate using input price and non-thinking output price. Thinking mode output and other regions use different prices and must be configured separately.",
    sourceUrl: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
  },
];

export function findModelCostPricing(
  modelId: string | null | undefined,
): ModelCostPricing | null {
  if (!modelId) {
    return null;
  }

  const normalized = normalizeModelId(modelId);

  return (
    MODEL_COST_PRICING_USD_PER_1M.find((pricing) =>
      pricing.modelIds.some((candidate) => normalizeModelId(candidate) === normalized),
    ) ?? null
  );
}

export function estimateLlmCostUsd(args: {
  modelId: string | null | undefined;
  inputTokens: number | null;
  outputTokens: number | null;
}): EstimatedCost | null {
  const pricing = findModelCostPricing(args.modelId);
  if (!pricing || !args.modelId) {
    return null;
  }

  const inputUsd =
    ((args.inputTokens ?? 0) / 1_000_000) * pricing.inputUsdPerMillion;
  const outputUsd =
    ((args.outputTokens ?? 0) / 1_000_000) * pricing.outputUsdPerMillion;

  return {
    provider: pricing.provider,
    modelId: args.modelId,
    inputUsd,
    outputUsd,
    totalUsd: inputUsd + outputUsd,
    pricingBasis: pricing.pricingBasis,
    sourceUrl: pricing.sourceUrl,
  };
}

/**
 * Pure v3 pricing contract. Cached input and reasoning output are subsets of
 * provider input/output; this function decomposes those totals instead of
 * adding the subsets to providerTotalTokens.
 */
export function calculateVersionedLlmCost(args: {
  pricingVersion: string;
  entries: readonly VersionedModelPricingEntry[];
  usage: VersionedLlmUsage;
}): VersionedLlmCost {
  validateUsage(args.usage);
  const usage = args.usage;
  const hasCachedBreakdown = usage.providerCachedTokens != null;
  const entry = args.entries.find((candidate) =>
    normalizeModelId(candidate.provider) === normalizeModelId(usage.provider) &&
    normalizeModelId(candidate.mode) === normalizeModelId(usage.mode) &&
    candidate.modelIds.some((modelId) => normalizeModelId(modelId) === normalizeModelId(usage.modelId)),
  );
  const effectiveReasoningTokens =
    usage.providerReasoningTokens ??
    (entry?.assumesNoReasoningTokens ? 0 : null);
  const hasReasoningBreakdown = effectiveReasoningTokens != null;
  const breakdown = {
    uncachedInputTokens: hasCachedBreakdown
      ? usage.providerInputTokens - usage.providerCachedTokens!
      : null,
    cachedInputTokens: hasCachedBreakdown
      ? usage.providerCachedTokens!
      : null,
    nonReasoningOutputTokens: hasReasoningBreakdown
      ? usage.providerOutputTokens - effectiveReasoningTokens!
      : null,
    reasoningOutputTokens: hasReasoningBreakdown
      ? effectiveReasoningTokens!
      : null,
    uncachedInputUsd: null as number | null,
    cachedInputUsd: null as number | null,
    nonReasoningOutputUsd: null as number | null,
    reasoningOutputUsd: null as number | null,
  };
  if (!entry) {
    return {
      pricingVersion: args.pricingVersion,
      pricingStatus: "unpriced",
      estimatedCostUsd: null,
      providerTotalTokens: usage.providerTotalTokens,
      breakdown,
      unpricedComponents: ["pricing_entry"],
    };
  }

  const unpricedComponents: string[] = [];
  let knownCost = 0;
  let hasPricedBilledComponent = false;

  const price = (
    key: "uncachedInputUsd" | "cachedInputUsd" | "nonReasoningOutputUsd" | "reasoningOutputUsd",
    component: string,
    tokens: number,
    rate: number | undefined,
  ) => {
    if (tokens === 0) {
      breakdown[key] = rate === undefined ? null : 0;
      return;
    }
    if (rate === undefined) {
      unpricedComponents.push(component);
      return;
    }
    const cost = tokens / 1_000_000 * rate;
    breakdown[key] = cost;
    knownCost += cost;
    hasPricedBilledComponent = true;
  };

  if (hasCachedBreakdown) {
    price(
      "uncachedInputUsd",
      "uncached_input",
      breakdown.uncachedInputTokens!,
      entry.uncachedInputUsdPerMillion,
    );
    price(
      "cachedInputUsd",
      "cached_input",
      breakdown.cachedInputTokens!,
      entry.cachedInputUsdPerMillion,
    );
  } else if (usage.providerInputTokens > 0) {
    unpricedComponents.push("cached_token_breakdown");
  }

  if (hasReasoningBreakdown) {
    price(
      "nonReasoningOutputUsd",
      "non_reasoning_output",
      breakdown.nonReasoningOutputTokens!,
      entry.nonReasoningOutputUsdPerMillion,
    );
    price(
      "reasoningOutputUsd",
      "reasoning_output",
      breakdown.reasoningOutputTokens!,
      entry.reasoningOutputUsdPerMillion,
    );
  } else if (usage.providerOutputTokens > 0) {
    unpricedComponents.push("reasoning_token_breakdown");
  }

  return {
    pricingVersion: args.pricingVersion,
    pricingStatus:
      unpricedComponents.length === 0
        ? "priced"
        : hasPricedBilledComponent
          ? "partial"
          : "unpriced",
    estimatedCostUsd: hasPricedBilledComponent || unpricedComponents.length === 0 ? knownCost : null,
    providerTotalTokens: usage.providerTotalTokens,
    breakdown,
    unpricedComponents,
  };
}

export function calculateCurrentLlmCost(args: {
  provider: string;
  modelId: string;
  mode: string;
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  providerTotalTokens: number | null;
  providerCachedTokens?: number | null;
  providerReasoningTokens?: number | null;
}): VersionedLlmCost {
  if (args.providerInputTokens == null || args.providerOutputTokens == null) {
    return {
      pricingVersion: TRACE_PRICING_VERSION,
      pricingStatus: "unpriced",
      estimatedCostUsd: null,
      providerTotalTokens: args.providerTotalTokens,
      breakdown: {
        uncachedInputTokens: null,
        cachedInputTokens: args.providerCachedTokens ?? null,
        nonReasoningOutputTokens: null,
        reasoningOutputTokens: args.providerReasoningTokens ?? null,
        uncachedInputUsd: null,
        cachedInputUsd: null,
        nonReasoningOutputUsd: null,
        reasoningOutputUsd: null,
      },
      unpricedComponents: ["provider_usage"],
    };
  }
  return calculateVersionedLlmCost({
    pricingVersion: TRACE_PRICING_VERSION,
    entries: TRACE_MODEL_PRICING,
    usage: {
      provider: args.provider,
      modelId: args.modelId,
      mode: args.mode,
      providerInputTokens: args.providerInputTokens,
      providerOutputTokens: args.providerOutputTokens,
      providerTotalTokens: args.providerTotalTokens,
      providerCachedTokens: args.providerCachedTokens,
      providerReasoningTokens: args.providerReasoningTokens,
    },
  });
}

function validateUsage(usage: VersionedLlmUsage) {
  for (const [name, value] of Object.entries(usage)) {
    if (
      name.endsWith("Tokens") &&
      value != null &&
      (!Number.isInteger(value) || (value as number) < 0)
    ) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
  }
  if (
    usage.providerCachedTokens != null &&
    usage.providerCachedTokens > usage.providerInputTokens
  ) {
    throw new Error("providerCachedTokens cannot exceed providerInputTokens.");
  }
  if (
    usage.providerReasoningTokens != null &&
    usage.providerReasoningTokens > usage.providerOutputTokens
  ) {
    throw new Error("providerReasoningTokens cannot exceed providerOutputTokens.");
  }
}

function normalizeModelId(modelId: string) {
  return modelId.trim().toLowerCase();
}
