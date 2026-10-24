import { describe, expect, it } from "vitest";
import fixture from "../fixtures/runtime-trace/pricing-v1.json";
import {
  calculateCurrentLlmCost,
  calculateVersionedLlmCost,
  TRACE_PRICING_VERSION,
} from "@/server/observability/cost-model";

describe("runtime trace versioned pricing", () => {
  it.each(fixture.cases)("prices $id honestly", ({ input, expected }) => {
    const result = calculateVersionedLlmCost({
      pricingVersion: fixture.pricingVersion,
      entries: fixture.entries,
      usage: input,
    });

    expect(result.pricingVersion).toBe(fixture.pricingVersion);
    expect(result.pricingStatus).toBe(expected.pricingStatus);
    expect(result.estimatedCostUsd).toBeCloseTo(expected.estimatedCostUsd ?? 0, 10);
    if (expected.estimatedCostUsd === null) {
      expect(result.estimatedCostUsd).toBeNull();
    }
    expect(result.providerTotalTokens).toBe(expected.providerTotalTokens);
    expect(result.unpricedComponents).toEqual(expected.unpricedComponents);

    if ("uncachedInputTokens" in expected) {
      expect(result.breakdown).toMatchObject({
        uncachedInputTokens: expected.uncachedInputTokens,
        cachedInputTokens: expected.cachedInputTokens,
        nonReasoningOutputTokens: expected.nonReasoningOutputTokens,
        reasoningOutputTokens: expected.reasoningOutputTokens,
      });
      const uncachedInputTokens = result.breakdown.uncachedInputTokens;
      const cachedInputTokens = result.breakdown.cachedInputTokens;
      const nonReasoningOutputTokens = result.breakdown.nonReasoningOutputTokens;
      const reasoningOutputTokens = result.breakdown.reasoningOutputTokens;
      expect(uncachedInputTokens).not.toBeNull();
      expect(cachedInputTokens).not.toBeNull();
      expect(nonReasoningOutputTokens).not.toBeNull();
      expect(reasoningOutputTokens).not.toBeNull();
      expect(uncachedInputTokens! + cachedInputTokens!).toBe(
        input.providerInputTokens,
      );
      expect(nonReasoningOutputTokens! + reasoningOutputTokens!).toBe(
        input.providerOutputTokens,
      );
    }
  });

  it("rejects subset counts that exceed their provider totals", () => {
    expect(() => calculateVersionedLlmCost({
      pricingVersion: fixture.pricingVersion,
      entries: fixture.entries,
      usage: {
        provider: "fixture",
        modelId: "fixture-priced",
        mode: "standard",
        providerInputTokens: 10,
        providerOutputTokens: 10,
        providerTotalTokens: 20,
        providerCachedTokens: 11,
        providerReasoningTokens: 0,
      },
    })).toThrow(/cached/i);
  });

  it.each([
    {
      label: "missing cached breakdown",
      usage: {
        providerCachedTokens: undefined,
        providerReasoningTokens: 0,
      },
      expectedStatus: "partial",
      expectedCost: 0.00004,
      expectedMissing: ["cached_token_breakdown"],
    },
    {
      label: "missing reasoning breakdown",
      usage: {
        providerCachedTokens: 0,
        providerReasoningTokens: null,
      },
      expectedStatus: "partial",
      expectedCost: 0.0001,
      expectedMissing: ["reasoning_token_breakdown"],
    },
    {
      label: "both breakdowns missing",
      usage: {
        providerCachedTokens: undefined,
        providerReasoningTokens: undefined,
      },
      expectedStatus: "unpriced",
      expectedCost: null,
      expectedMissing: [
        "cached_token_breakdown",
        "reasoning_token_breakdown",
      ],
    },
  ] as const)("does not treat $label as zero", ({
    usage,
    expectedStatus,
    expectedCost,
    expectedMissing,
  }) => {
    const result = calculateVersionedLlmCost({
      pricingVersion: fixture.pricingVersion,
      entries: fixture.entries,
      usage: {
        provider: "fixture",
        modelId: "fixture-priced",
        mode: "standard",
        providerInputTokens: 100,
        providerOutputTokens: 20,
        providerTotalTokens: 120,
        ...usage,
      },
    });

    expect(result.pricingStatus).toBe(expectedStatus);
    if (expectedCost === null) {
      expect(result.estimatedCostUsd).toBeNull();
    } else {
      expect(result.estimatedCostUsd).toBeCloseTo(expectedCost, 10);
    }
    expect(result.unpricedComponents).toEqual(expectedMissing);
    if (usage.providerCachedTokens == null) {
      expect(result.breakdown.cachedInputTokens).toBeNull();
      expect(result.breakdown.uncachedInputTokens).toBeNull();
    }
    if (usage.providerReasoningTokens == null) {
      expect(result.breakdown.reasoningOutputTokens).toBeNull();
      expect(result.breakdown.nonReasoningOutputTokens).toBeNull();
    }
  });

  it("keeps missing provider usage missing and unpriced", () => {
    const result = calculateCurrentLlmCost({
      provider: "deepseek",
      modelId: "deepseek-chat",
      mode: "standard",
      providerInputTokens: null,
      providerOutputTokens: null,
      providerTotalTokens: null,
    });

    expect(result).toMatchObject({
      pricingVersion: TRACE_PRICING_VERSION,
      pricingStatus: "unpriced",
      estimatedCostUsd: null,
      providerTotalTokens: null,
      unpricedComponents: ["provider_usage"],
    });
  });

  it("never reuses standard-mode prices for a thinking call", () => {
    const result = calculateCurrentLlmCost({
      provider: "deepseek",
      modelId: "deepseek-chat",
      mode: "thinking",
      providerInputTokens: 100,
      providerOutputTokens: 20,
      providerTotalTokens: 120,
      providerCachedTokens: 0,
      providerReasoningTokens: 10,
    });

    expect(result).toMatchObject({
      pricingStatus: "unpriced",
      estimatedCostUsd: null,
      providerTotalTokens: 120,
      unpricedComponents: ["pricing_entry"],
    });
  });
});
